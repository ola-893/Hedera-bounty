import { createHash, randomUUID } from "node:crypto";
import type { TradeQuoteRequest } from "../../shared/src/schemas";
import { parseUnits } from "./amounts";
import type {
  PolicyVerdict,
  ResolvedQuoteRequest,
  TokenConfig,
  TradeProposal,
  TradeQuote,
  TradingPolicyConfig
} from "./types";
import { fetchLatestHcsMessage } from "../../hedera/src/hcs";

export function createDefaultPolicyConfig(env: NodeJS.ProcessEnv = process.env): TradingPolicyConfig {
  const network = readNetwork(env.HEDERA_NETWORK);
  const whbarTokenId = env.WHBAR_TOKEN_ID ?? "0.0.15058";

  return {
    network,
    enableMainnet: env.ENABLE_MAINNET === "true",
    maxSlippageBps: parseInteger(env.MAX_SLIPPAGE_BPS, 100),
    quoteTtlMs: parseInteger(env.QUOTE_TTL_SECONDS, 60) * 1000,
    allowedTokens: [
      {
        symbol: "HBAR",
        tokenId: "HBAR",
        saucerPathTokenId: whbarTokenId,
        decimals: 8,
        aliases: ["WHBAR"],
        maxAmount: env.MAX_DEMO_TRADE_HBAR ?? "50",
        isNativeHbar: true
      },
      {
        symbol: "SAUCE",
        tokenId: env.SAUCE_TOKEN_ID ?? "0.0.1183558",
        decimals: 6,
        aliases: ["SAUCEINU"],
        maxAmount: env.MAX_DEMO_TRADE_SAUCE ?? "100000"
      },
      {
        symbol: "XSAUCE",
        tokenId: env.XSAUCE_TOKEN_ID ?? "0.0.1418651",
        decimals: 6,
        aliases: ["XSAUCE"],
        maxAmount: env.MAX_DEMO_TRADE_XSAUCE ?? "100000"
      }
    ]
  };
}

export async function loadPolicyConfig(env: NodeJS.ProcessEnv = process.env): Promise<TradingPolicyConfig> {
  const defaults = createDefaultPolicyConfig(env);
  const topicId = env.HCS_POLICY_TOPIC_ID;
  
  if (!topicId) {
    return defaults;
  }
  
  console.log(`[Policies] Attempting to load policies from HCS Topic ${topicId}...`);
  try {
    const message = await fetchLatestHcsMessage(topicId, defaults.network);
    if (message) {
      const parsed = JSON.parse(message) as Partial<TradingPolicyConfig>;
      console.log(`[Policies] Successfully loaded overrides from HCS.`);
      
      // Merge defaults with HCS overrides (basic shallow merge, tokens are replaced completely if provided)
      return {
        ...defaults,
        ...parsed,
        allowedTokens: parsed.allowedTokens ?? defaults.allowedTokens
      };
    } else {
      console.log(`[Policies] HCS Topic ${topicId} is empty. Using defaults.`);
    }
  } catch (error) {
    console.warn(`[Policies] Failed to load from HCS Topic ${topicId}:`, error);
  }
  
  return defaults;
}

export class TradingPolicyEngine {
  constructor(private readonly config: TradingPolicyConfig) {}

  getConfig(): TradingPolicyConfig {
    return this.config;
  }

  resolveToken(tokenRef: string): TokenConfig | undefined {
    const normalized = normalizeTokenRef(tokenRef);
    return this.config.allowedTokens.find((token) => {
      const refs = [token.symbol, token.tokenId, token.saucerPathTokenId, ...(token.aliases ?? [])].filter(
        (ref): ref is string => typeof ref === "string"
      );
      return refs.some((ref) => normalizeTokenRef(ref) === normalized);
    });
  }

  evaluateQuoteRequest(request: TradeQuoteRequest): { verdict: PolicyVerdict; resolved?: ResolvedQuoteRequest } {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const tokenInConfig = this.resolveToken(request.tokenIn);
    const tokenOutConfig = this.resolveToken(request.tokenOut);

    if (this.config.network === "mainnet" && !this.config.enableMainnet) {
      reasons.push("Mainnet trading is disabled. Set ENABLE_MAINNET=true only after review.");
    }

    if (!tokenInConfig) {
      reasons.push(`Token ${request.tokenIn} is not on the allowed-token list.`);
    }

    if (!tokenOutConfig) {
      reasons.push(`Token ${request.tokenOut} is not on the allowed-token list.`);
    }

    if (tokenInConfig && tokenOutConfig && tokenInConfig.symbol === tokenOutConfig.symbol) {
      reasons.push("Input and output token must be different.");
    }

    if (request.slippageBps > this.config.maxSlippageBps) {
      reasons.push(`Requested slippage ${request.slippageBps} bps exceeds max ${this.config.maxSlippageBps} bps.`);
    }

    if (tokenInConfig) {
      try {
        const amount = parseUnits(request.amountIn, tokenInConfig.decimals);
        if (amount <= 0n) {
          reasons.push("Trade amount must be greater than zero.");
        }

        if (tokenInConfig.maxAmount) {
          const max = parseUnits(tokenInConfig.maxAmount, tokenInConfig.decimals);
          if (amount > max) {
            reasons.push(`Trade amount exceeds ${tokenInConfig.symbol} demo cap of ${tokenInConfig.maxAmount}.`);
          }
        }
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : "Invalid trade amount.");
      }
    }

    if (this.config.network !== "testnet") {
      warnings.push("This backend is optimized for testnet bounty demos. Re-check limits before production use.");
    }

    const verdict = makeVerdict(reasons, warnings);
    if (!verdict.allowed || !tokenInConfig || !tokenOutConfig) {
      return { verdict };
    }

    return {
      verdict,
      resolved: {
        ...request,
        tokenInConfig,
        tokenOutConfig
      }
    };
  }

  evaluateProposal(quote: TradeQuote, accountId: string, recipientAccountId: string, now = new Date()): PolicyVerdict {
    const reasons: string[] = [];
    const warnings: string[] = [];

    if (quote.status !== "quoted") {
      reasons.push(`Quote is ${quote.status}; only quoted trades can be proposed.`);
    }

    if (!quote.policy.allowed) {
      reasons.push(...quote.policy.reasons);
    }

    if (new Date(quote.expiresAt).getTime() <= now.getTime()) {
      reasons.push("Quote expired before proposal creation.");
    }

    if (quote.accountId !== accountId) {
      reasons.push("Proposal account must match the quote account.");
    }

    if (recipientAccountId !== accountId) {
      reasons.push("Recipient account must match the connected wallet account.");
    }

    return makeVerdict(reasons, warnings);
  }

  evaluateToolInvocation(toolName: string, input: Record<string, unknown>): PolicyVerdict {
    const allowedTools = new Set(["account_query", "token_query", "saucerswap_quote", "saucerswap_swap"]);
    const deniedTools = new Set([
      "account_delete",
      "transfer",
      "token_mint",
      "token_freeze",
      "contract_execute",
      "evm_call"
    ]);

    const reasons: string[] = [];
    if (deniedTools.has(toolName)) {
      reasons.push(`Tool ${toolName} is denied for this bounty MVP.`);
    }

    if (!allowedTools.has(toolName)) {
      reasons.push(`Tool ${toolName} is not on the agent allowlist.`);
    }

    if (toolName === "saucerswap_swap" && typeof input.proposalId !== "string") {
      reasons.push("Swap tool requires an explicit proposalId created by the wallet approval flow.");
    }

    return makeVerdict(reasons, []);
  }
}

export function hashQuotePayload(payload: {
  accountId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  route: string[];
  slippageBps: number;
  expiresAt: string;
  source: string;
}): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export function makeQuoteId(): string {
  return `quote_${randomUUID()}`;
}

export function makeProposalId(): string {
  return `proposal_${randomUUID()}`;
}

export function makeAuditId(): string {
  return `audit_${randomUUID()}`;
}

export function normalizeTokenRef(value: string): string {
  return value.trim().toUpperCase();
}

function makeVerdict(reasons: string[], warnings: string[]): PolicyVerdict {
  return {
    allowed: reasons.length === 0,
    reasons,
    warnings
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readNetwork(value: string | undefined): TradingPolicyConfig["network"] {
  if (value === "mainnet" || value === "previewnet" || value === "testnet") {
    return value;
  }
  return "testnet";
}

import type { TradeQuoteRequest } from "../../shared/src/schemas";
import { formatUnits, parseUnits } from "./amounts";
import {
  hashQuotePayload,
  makeQuoteId,
  normalizeTokenRef,
  TradingPolicyEngine
} from "./policies";
import type { ResolvedQuoteRequest, TradeQuote } from "./types";

export interface QuoteProviderQuote {
  amountOutSmallest: string;
  route: string[];
  priceImpactBps?: number;
  source: string;
}

export interface QuoteProvider {
  getQuote(request: ResolvedQuoteRequest): Promise<QuoteProviderQuote>;
}

export class DemoSaucerSwapQuoteProvider implements QuoteProvider {
  async getQuote(request: ResolvedQuoteRequest): Promise<QuoteProviderQuote> {
    const amountInSmallest = parseUnits(request.amountIn, request.tokenInConfig.decimals);
    const rateBps = demoRateBps(request.tokenInConfig.symbol, request.tokenOutConfig.symbol);
    const amountOutSmallest =
      (amountInSmallest * BigInt(rateBps) * 10n ** BigInt(request.tokenOutConfig.decimals)) /
      (10000n * 10n ** BigInt(request.tokenInConfig.decimals));

    return {
      amountOutSmallest: amountOutSmallest.toString(),
      route: [
        request.tokenInConfig.saucerPathTokenId ?? request.tokenInConfig.tokenId,
        request.tokenOutConfig.saucerPathTokenId ?? request.tokenOutConfig.tokenId
      ],
      priceImpactBps: 12,
      source: "saucerswap-plugin-demo"
    };
  }
}

export class QuoteService {
  constructor(
    private readonly policyEngine: TradingPolicyEngine,
    private readonly quoteProvider: QuoteProvider,
    private readonly now: () => Date = () => new Date()
  ) {}

  async createQuote(request: TradeQuoteRequest): Promise<TradeQuote> {
    const policyResult = this.policyEngine.evaluateQuoteRequest(request);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.policyEngine.getConfig().quoteTtlMs).toISOString();

    if (!policyResult.verdict.allowed || !policyResult.resolved) {
      const quote: TradeQuote = {
        id: makeQuoteId(),
        accountId: request.accountId,
        tokenIn: normalizeTokenRef(request.tokenIn),
        tokenOut: normalizeTokenRef(request.tokenOut),
        amountIn: request.amountIn,
        amountOut: "0",
        amountInSmallest: "0",
        amountOutSmallest: "0",
        route: [],
        slippageBps: request.slippageBps,
        quoteHash: "",
        expiresAt,
        createdAt: createdAt.toISOString(),
        source: "policy",
        status: "blocked",
        policy: policyResult.verdict
      };
      quote.quoteHash = hashQuotePayload(quote);
      return quote;
    }

    const providerQuote = await this.quoteProvider.getQuote(policyResult.resolved);
    const amountOut = formatUnits(BigInt(providerQuote.amountOutSmallest), policyResult.resolved.tokenOutConfig.decimals);
    const amountInSmallest = parseUnits(request.amountIn, policyResult.resolved.tokenInConfig.decimals).toString();

    const quote: TradeQuote = {
      id: makeQuoteId(),
      accountId: request.accountId,
      tokenIn: policyResult.resolved.tokenInConfig.symbol,
      tokenOut: policyResult.resolved.tokenOutConfig.symbol,
      amountIn: request.amountIn,
      amountOut,
      amountInSmallest,
      amountOutSmallest: providerQuote.amountOutSmallest,
      route: providerQuote.route,
      slippageBps: request.slippageBps,
      quoteHash: "",
      expiresAt,
      createdAt: createdAt.toISOString(),
      source: providerQuote.source,
      status: "quoted",
      policy: policyResult.verdict
    };

    if (providerQuote.priceImpactBps !== undefined) {
      quote.priceImpactBps = providerQuote.priceImpactBps;
    }

    quote.quoteHash = hashQuotePayload(quote);
    return quote;
  }
}

function demoRateBps(tokenIn: string, tokenOut: string): number {
  const pair = `${normalizeTokenRef(tokenIn)}:${normalizeTokenRef(tokenOut)}`;
  const rates: Record<string, number> = {
    "HBAR:SAUCE": 185000,
    "SAUCE:HBAR": 54,
    "HBAR:XSAUCE": 126000,
    "XSAUCE:HBAR": 78,
    "SAUCE:XSAUCE": 6800,
    "XSAUCE:SAUCE": 14700
  };
  return rates[pair] ?? 10000;
}

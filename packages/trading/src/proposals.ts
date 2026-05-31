import { makeProposalId, TradingPolicyEngine } from "./policies";
import type { TradeProposal, TradeQuote } from "./types";

export interface SwapTransactionBuilder {
  buildSwapTransactionBytes(quote: TradeQuote, recipientAccountId: string): Promise<string>;
}

export class SourceAwareSwapTransactionBuilder implements SwapTransactionBuilder {
  constructor(
    private readonly demoBuilder: SwapTransactionBuilder,
    private readonly liveBuilder: SwapTransactionBuilder,
    private readonly forceDemo = false
  ) {}

  async buildSwapTransactionBytes(quote: TradeQuote, recipientAccountId: string): Promise<string> {
    if (this.forceDemo || !isLiveSaucerSwapQuote(quote)) {
      return this.demoBuilder.buildSwapTransactionBytes(quote, recipientAccountId);
    }

    return this.liveBuilder.buildSwapTransactionBytes(quote, recipientAccountId);
  }
}

export class DemoSwapTransactionBuilder implements SwapTransactionBuilder {
  constructor(
    private readonly network: "mainnet" | "testnet" | "previewnet" = "testnet",
    private readonly demoTopicId?: string
  ) {}

  async buildSwapTransactionBytes(quote: TradeQuote, recipientAccountId: string): Promise<string> {
    const sdk = await import("@hiero-ledger/sdk") as Record<string, any>;
    const client = this.network === "mainnet"
      ? sdk.Client.forMainnet()
      : this.network === "previewnet"
        ? sdk.Client.forPreviewnet()
        : sdk.Client.forTestnet();
    try {
      const payerAccountId = sdk.AccountId.fromString(quote.accountId);
      const tx = this.demoTopicId
        ? new sdk.TopicMessageSubmitTransaction()
          .setTopicId(this.demoTopicId)
          .setMessage(JSON.stringify({
            kind: "demo_trade_approval",
            quoteId: quote.id,
            quoteHash: quote.quoteHash,
            accountId: quote.accountId,
            recipientAccountId,
            tokenIn: quote.tokenIn,
            tokenOut: quote.tokenOut,
            amountIn: quote.amountIn,
            minimumAmountOut: minimumOutHuman(quote)
          }))
          .setTransactionMemo(`Demo approval for ${quote.id}`)
          .setTransactionId(sdk.TransactionId.generate(payerAccountId))
        : new sdk.TransferTransaction()
          .setTransactionMemo(`Demo wallet approval for ${quote.id} to ${recipientAccountId}`)
          .setTransactionId(sdk.TransactionId.generate(payerAccountId));

      tx.freezeWith(client);

      return Buffer.from(tx.toBytes()).toString("base64");
    } finally {
      if (typeof client.close === "function") {
        client.close();
      }
    }
  }
}

export function isLiveSaucerSwapQuote(quote: TradeQuote): boolean {
  return quote.source === "saucerswap-v2-quoter";
}

export class ProposalBuilder {
  constructor(
    private readonly policyEngine: TradingPolicyEngine,
    private readonly transactionBuilder: SwapTransactionBuilder,
    private readonly now: () => Date = () => new Date()
  ) {}

  async createProposal(quote: TradeQuote, accountId: string, recipientAccountId = accountId): Promise<{
    proposal?: TradeProposal;
    verdict: ReturnType<TradingPolicyEngine["evaluateProposal"]>;
  }> {
    const verdict = this.policyEngine.evaluateProposal(quote, accountId, recipientAccountId, this.now());
    if (!verdict.allowed) {
      return { verdict };
    }

    const transactionBytes = await this.transactionBuilder.buildSwapTransactionBytes(quote, recipientAccountId);
    const proposal: TradeProposal = {
      id: makeProposalId(),
      quoteId: quote.id,
      accountId,
      recipientAccountId,
      transactionBytes,
      approvalSummary: buildApprovalSummary(quote),
      status: "proposed",
      createdAt: this.now().toISOString(),
      expiresAt: quote.expiresAt,
      quoteHash: quote.quoteHash
    };

    return { proposal, verdict };
  }
}

export function calculateMinimumOut(amountOutSmallest: string, slippageBps: number): string {
  const amount = BigInt(amountOutSmallest);
  return ((amount * BigInt(10000 - slippageBps)) / 10000n).toString();
}

function minimumOutHuman(quote: TradeQuote): string {
  const min = calculateMinimumOut(quote.amountOutSmallest, quote.slippageBps);
  if (quote.amountOutSmallest === "0") return "0";
  const ratio = Number(min) / Number(quote.amountOutSmallest);
  const expected = Number(quote.amountOut) * ratio;
  return Number.isFinite(expected) ? expected.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : quote.amountOut;
}

function buildApprovalSummary(quote: TradeQuote): string {
  const liveSummary = [
    `Approve swap of ${quote.amountIn} ${quote.tokenIn} to at least ${minimumOutHuman(quote)} ${quote.tokenOut}.`,
    `Slippage limit: ${quote.slippageBps} bps.`,
    `Quote expires: ${quote.expiresAt}.`
  ];

  if (isLiveSaucerSwapQuote(quote)) {
    return liveSummary.join(" ");
  }

  return [
    `Demo approval for ${quote.amountIn} ${quote.tokenIn} to at least ${minimumOutHuman(quote)} ${quote.tokenOut}.`,
    "This proposal signs a safe Hedera demo transaction because the quote came from demo/fallback mode.",
    `Quote source: ${quote.source}.`
  ].join(" ");
}

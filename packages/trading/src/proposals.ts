import { makeProposalId, TradingPolicyEngine } from "./policies";
import type { TradeProposal, TradeQuote } from "./types";

export interface SwapTransactionBuilder {
  buildSwapTransactionBytes(quote: TradeQuote, recipientAccountId: string): Promise<string>;
}

export class DemoSwapTransactionBuilder implements SwapTransactionBuilder {
  async buildSwapTransactionBytes(quote: TradeQuote, recipientAccountId: string): Promise<string> {
    const sdk = await import("@hiero-ledger/sdk") as Record<string, any>;
    const client = sdk.Client.forTestnet();
    try {
      const tx = new sdk.TransferTransaction()
        .setTransactionMemo(`Demo wallet approval for ${quote.id} to ${recipientAccountId}`)
        .setTransactionId(sdk.TransactionId.generate(sdk.AccountId.fromString(quote.accountId)))
        .freezeWith(client);

      return Buffer.from(tx.toBytes()).toString("base64");
    } finally {
      if (typeof client.close === "function") {
        client.close();
      }
    }
  }
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
      approvalSummary: [
        `Approve swap of ${quote.amountIn} ${quote.tokenIn} to at least ${minimumOutHuman(quote)} ${quote.tokenOut}.`,
        `Slippage limit: ${quote.slippageBps} bps.`,
        `Quote expires: ${quote.expiresAt}.`
      ].join(" "),
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

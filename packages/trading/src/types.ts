import type { TradeQuoteRequest, TradeStatus } from "../../shared/src/schemas";

export type NetworkName = "testnet" | "mainnet" | "previewnet";

export interface TokenConfig {
  symbol: string;
  tokenId: string;
  decimals: number;
  aliases?: string[];
  maxAmount?: string;
  saucerPathTokenId?: string;
  isNativeHbar?: boolean;
}

export interface TradingPolicyConfig {
  network: NetworkName;
  enableMainnet: boolean;
  allowedTokens: TokenConfig[];
  maxSlippageBps: number;
  quoteTtlMs: number;
}

export interface PolicyVerdict {
  allowed: boolean;
  reasons: string[];
  warnings: string[];
}

export interface ResolvedQuoteRequest extends TradeQuoteRequest {
  tokenInConfig: TokenConfig;
  tokenOutConfig: TokenConfig;
}

export interface TradeQuote {
  id: string;
  accountId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  amountInSmallest: string;
  amountOutSmallest: string;
  route: string[];
  slippageBps: number;
  priceImpactBps?: number;
  quoteHash: string;
  expiresAt: string;
  createdAt: string;
  source: string;
  status: TradeStatus;
  policy: PolicyVerdict;
}

export interface TradeProposal {
  id: string;
  quoteId: string;
  accountId: string;
  recipientAccountId: string;
  transactionBytes: string;
  approvalSummary: string;
  status: TradeStatus;
  createdAt: string;
  expiresAt: string;
  quoteHash: string;
  transactionId?: string;
  failureReason?: string;
}

export interface AuditEventRecord {
  id: string;
  type: string;
  accountId?: string;
  proposalId?: string;
  quoteId?: string;
  message: string;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface TradeHistoryRecord {
  proposal: TradeProposal;
  quote?: TradeQuote;
}

export interface TradingStore {
  saveQuote(quote: TradeQuote): Promise<void>;
  getQuote(id: string): Promise<TradeQuote | undefined>;
  saveProposal(proposal: TradeProposal): Promise<void>;
  getProposal(id: string): Promise<TradeProposal | undefined>;
  updateProposal(id: string, patch: Partial<TradeProposal>): Promise<TradeProposal | undefined>;
  listTradeHistory(accountId: string | undefined, limit: number): Promise<TradeHistoryRecord[]>;
  addAuditEvent(event: AuditEventRecord): Promise<void>;
  listAuditEvents(limit: number): Promise<AuditEventRecord[]>;
}

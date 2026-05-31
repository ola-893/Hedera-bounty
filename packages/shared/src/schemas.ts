import { z } from "zod";

export const accountIdSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "Expected Hedera account id like 0.0.1234");
export const tokenIdSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "Expected Hedera token id like 0.0.1234");
export const tokenRefSchema = z.string().trim().min(2).max(64);
export const decimalStringSchema = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/, "Expected a positive decimal string");

export const tradeStatusValues = [
  "quoted",
  "blocked",
  "proposed",
  "expired",
  "wallet_rejected",
  "submitted",
  "confirmed",
  "failed"
] as const;

export const tradeStatusSchema = z.enum(tradeStatusValues);

export const policyVerdictSchema = z.object({
  allowed: z.boolean(),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()).default([])
});

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  network: z.enum(["testnet", "mainnet", "previewnet"]),
  mainnetEnabled: z.boolean(),
  liveQuotes: z.boolean()
});

export const portfolioTokenSchema = z.object({
  tokenId: tokenIdSchema,
  symbol: z.string(),
  name: z.string().optional(),
  balance: z.string(),
  decimals: z.number().int().min(0).max(18)
});

export const portfolioResponseSchema = z.object({
  accountId: accountIdSchema,
  hbarBalance: z.string(),
  tokens: z.array(portfolioTokenSchema),
  recentTransactions: z.array(z.object({
    transactionId: z.string(),
    consensusTimestamp: z.string().optional(),
    result: z.string().optional(),
    type: z.string().optional()
  }))
});

export const agentChatRequestSchema = z.object({
  accountId: accountIdSchema.optional(),
  message: z.string().trim().min(1).max(4000)
});

export const agentChatResponseSchema = z.object({
  response: z.string(),
  action: z.object({
    type: z.literal("quote_request"),
    tokenIn: tokenRefSchema,
    tokenOut: tokenRefSchema,
    amountIn: decimalStringSchema,
    confidence: z.number().min(0).max(1)
  }).optional(),
  safetyNotes: z.array(z.string())
});

export const tradeQuoteRequestSchema = z.object({
  accountId: accountIdSchema,
  tokenIn: tokenRefSchema,
  tokenOut: tokenRefSchema,
  amountIn: decimalStringSchema,
  slippageBps: z.union([z.number().int().min(1).max(10000), z.undefined()]).transform((value) => value ?? 100)
});

export const tradeQuoteResponseSchema = z.object({
  id: z.string(),
  accountId: accountIdSchema,
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: decimalStringSchema,
  amountOut: decimalStringSchema,
  route: z.array(z.string()),
  slippageBps: z.number().int(),
  priceImpactBps: z.number().int().optional(),
  quoteHash: z.string(),
  expiresAt: z.string(),
  source: z.string(),
  status: tradeStatusSchema,
  policy: policyVerdictSchema
});

export const tradeProposeRequestSchema = z.object({
  quoteId: z.string().min(8),
  accountId: accountIdSchema,
  recipientAccountId: accountIdSchema.optional()
});

export const tradeProposeResponseSchema = z.object({
  proposalId: z.string(),
  quoteId: z.string(),
  status: tradeStatusSchema,
  transactionBytes: z.string(),
  approvalSummary: z.string(),
  expiresAt: z.string(),
  quoteHash: z.string()
});

export const tradeCompleteRequestSchema = z.object({
  transactionId: z.string().min(3).optional(),
  status: z.enum(["submitted", "wallet_rejected", "failed"]).default("submitted"),
  failureReason: z.string().max(1000).optional()
});

export const strategyEvaluateRequestSchema = tradeQuoteRequestSchema.extend({
  condition: z.discriminatedUnion("type", [
    z.object({ type: z.literal("always") }),
    z.object({ type: z.literal("minAmountOut"), minAmountOut: decimalStringSchema })
  ])
});

export const auditEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  accountId: accountIdSchema.optional(),
  proposalId: z.string().optional(),
  quoteId: z.string().optional(),
  message: z.string(),
  createdAt: z.string(),
  data: z.record(z.unknown()).default({})
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type PortfolioResponse = z.infer<typeof portfolioResponseSchema>;
export type AgentChatRequest = z.infer<typeof agentChatRequestSchema>;
export type AgentChatResponse = z.infer<typeof agentChatResponseSchema>;
export type TradeQuoteRequest = z.infer<typeof tradeQuoteRequestSchema>;
export type TradeQuoteResponse = z.infer<typeof tradeQuoteResponseSchema>;
export type TradeProposeRequest = z.infer<typeof tradeProposeRequestSchema>;
export type TradeProposeResponse = z.infer<typeof tradeProposeResponseSchema>;
export type StrategyEvaluateRequest = z.infer<typeof strategyEvaluateRequestSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type TradeStatus = z.infer<typeof tradeStatusSchema>;

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { ZodError, type ZodSchema } from "zod";
import {
  accountIdSchema,
  agentChatRequestSchema,
  strategyEvaluateRequestSchema,
  tradeCompleteRequestSchema,
  tradeProposeRequestSchema,
  tradeQuoteRequestSchema
} from "../../../packages/shared/src/schemas";
import { handleAgentChat } from "../../../packages/agent/src/tradingAgent";
import { MirrorNodeClient } from "../../../packages/hedera/src/mirrorNode";
import { SaucerSwapQuoteProvider } from "../../../packages/hedera/src/saucerswapQuoteProvider";
import { HederaSwapTransactionBuilder } from "../../../packages/hedera/src/swapTransactionBuilder";
import { createApiConfig } from "./config";
import { DemoSwapTransactionBuilder, ProposalBuilder } from "../../../packages/trading/src/proposals";
import { QuoteService } from "../../../packages/trading/src/quoteService";
import { TradingPolicyEngine, makeAuditId } from "../../../packages/trading/src/policies";
import { SqliteTradingStore } from "../../../packages/trading/src/sqliteStore";
import type { AuditEventRecord, TradeProposal, TradingStore } from "../../../packages/trading/src/types";

export interface ApiDependencies {
  store: TradingStore;
  policyEngine: TradingPolicyEngine;
  quoteService: QuoteService;
  proposalBuilder: ProposalBuilder;
  mirrorNode: MirrorNodeClient;
  config: Awaited<ReturnType<typeof createApiConfig>>;
}

export async function buildApp(overrides: Partial<ApiDependencies> = {}): Promise<FastifyInstance> {
  const config = overrides.config ?? (await createApiConfig());
  const policyEngine = overrides.policyEngine ?? new TradingPolicyEngine(config.policy);
  const storeOptions = config.client && config.hcsAuditTopicId
    ? { client: config.client, hcsAuditTopicId: config.hcsAuditTopicId }
    : {};
  const store = overrides.store ?? new SqliteTradingStore(config.databaseUrl, storeOptions);
  const mirrorNode = overrides.mirrorNode ?? new MirrorNodeClient(config.hedera.mirrorNodeBaseUrl);
  const quoteProvider = new SaucerSwapQuoteProvider(config.hedera, mirrorNode, {
    liveQuotes: config.liveQuotes,
    allowDemoFallback: config.allowDemoFallback,
    poolFee: config.poolFee
  });
  const quoteService = overrides.quoteService ?? new QuoteService(policyEngine, quoteProvider);
  const transactionBuilder = config.demoTransactionBytes
    ? new DemoSwapTransactionBuilder()
    : new HederaSwapTransactionBuilder(config.hedera);
  const proposalBuilder = overrides.proposalBuilder ?? new ProposalBuilder(policyEngine, transactionBuilder);

  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin: buildAllowedOrigins(config.frontendOrigin),
    methods: ["GET", "POST", "OPTIONS"]
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Hedera Trading Wallet Agent API",
        version: "0.1.0"
      }
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: "validation_error",
        issues: error.issues
      });
      return;
    }

    reply.status(500).send({
      error: "internal_error",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "hedera-trading-wallet-agent",
    network: config.policy.network,
    mainnetEnabled: config.policy.enableMainnet,
    liveQuotes: config.liveQuotes
  }));

  app.get("/api/docs/openapi.json", async () => app.swagger());

  app.get("/api/portfolio/:accountId", async (request) => {
    const params = parse({ parse: (value: unknown) => ({ accountId: accountIdSchema.parse((value as { accountId: unknown }).accountId) }) }, request.params);
    return await mirrorNode.getPortfolio(params.accountId);
  });

  app.post("/api/agent/chat", async (request) => {
    const body = parse(agentChatRequestSchema, request.body);
    const response = await handleAgentChat(body);
    const auditData: Record<string, unknown> = { message: body.message };
    if (response.action) {
      auditData.action = response.action;
    }
    await addAudit(store, {
      type: "agent_intent",
      message: response.action ? "Agent parsed a trade intent." : "Agent responded without trade intent.",
      data: auditData,
      ...(body.accountId ? { accountId: body.accountId } : {})
    });
    return response;
  });

  app.post("/api/trades/quote", async (request) => {
    const parsedBody = parse(tradeQuoteRequestSchema, request.body);
    const body = { ...parsedBody, slippageBps: parsedBody.slippageBps ?? config.policy.maxSlippageBps };
    const quote = await quoteService.createQuote(body);
    await store.saveQuote(quote);
    await addAudit(store, {
      type: quote.status === "blocked" ? "quote_blocked" : "quote_created",
      accountId: quote.accountId,
      quoteId: quote.id,
      message: quote.status === "blocked" ? "Quote request blocked by policy." : "Quote created.",
      data: { policy: quote.policy, quoteHash: quote.quoteHash }
    });
    return quote;
  });

  app.post("/api/trades/propose", async (request, reply) => {
    const body = parse(tradeProposeRequestSchema, request.body);
    const quote = await store.getQuote(body.quoteId);
    if (!quote) {
      reply.status(404);
      return { error: "quote_not_found" };
    }

    const result = await proposalBuilder.createProposal(quote, body.accountId, body.recipientAccountId ?? body.accountId);
    if (!result.proposal) {
      await addAudit(store, {
        type: "proposal_blocked",
        accountId: body.accountId,
        quoteId: quote.id,
        message: "Proposal blocked by policy.",
        data: { policy: result.verdict }
      });
      reply.status(422);
      return { error: "proposal_blocked", policy: result.verdict };
    }

    await store.saveProposal(result.proposal);
    await addAudit(store, {
      type: "proposal_created",
      accountId: result.proposal.accountId,
      quoteId: quote.id,
      proposalId: result.proposal.id,
      message: "Proposal created for wallet approval.",
      data: { quoteHash: result.proposal.quoteHash }
    });

    return {
      proposalId: result.proposal.id,
      quoteId: result.proposal.quoteId,
      status: result.proposal.status,
      transactionBytes: result.proposal.transactionBytes,
      approvalSummary: result.proposal.approvalSummary,
      expiresAt: result.proposal.expiresAt,
      quoteHash: result.proposal.quoteHash
    };
  });

  app.post("/api/trades/:proposalId/complete", async (request, reply) => {
    const params = request.params as { proposalId: string };
    const body = parse(tradeCompleteRequestSchema, request.body);
    const proposal = await store.getProposal(params.proposalId);
    if (!proposal) {
      reply.status(404);
      return { error: "proposal_not_found" };
    }

    const status = body.status === "wallet_rejected" ? "wallet_rejected" : "submitted";
    const patch: Partial<TradeProposal> = { status };
    if (body.transactionId) {
      patch.transactionId = body.transactionId;
    }
    const updated = await store.updateProposal(proposal.id, patch);

    await addAudit(store, {
      type: status === "wallet_rejected" ? "wallet_rejected" : "transaction_submitted",
      accountId: proposal.accountId,
      quoteId: proposal.quoteId,
      proposalId: proposal.id,
      message: status === "wallet_rejected" ? "Wallet rejected proposal." : "Wallet submitted transaction.",
      data: { transactionId: body.transactionId }
    });

    return updated;
  });

  app.get("/api/trades/:proposalId/status", async (request, reply) => {
    const params = request.params as { proposalId: string };
    const proposal = await store.getProposal(params.proposalId);
    if (!proposal) {
      reply.status(404);
      return { error: "proposal_not_found" };
    }

    if (proposal.status === "proposed" && new Date(proposal.expiresAt).getTime() <= Date.now()) {
      return await store.updateProposal(proposal.id, { status: "expired" });
    }

    if (proposal.status === "submitted" && proposal.transactionId) {
      const lookup = await mirrorNode.getTransactionStatus(proposal.transactionId);
      if (lookup.status === "confirmed" || lookup.status === "failed") {
        const patch: Partial<TradeProposal> = { status: lookup.status };
        if (lookup.status === "failed" && lookup.result) {
          patch.failureReason = lookup.result;
        }
        const updated = await store.updateProposal(proposal.id, patch);
        await addAudit(store, {
          type: lookup.status === "confirmed" ? "transaction_confirmed" : "transaction_failed",
          accountId: proposal.accountId,
          quoteId: proposal.quoteId,
          proposalId: proposal.id,
          message: lookup.status === "confirmed" ? "Transaction confirmed." : "Transaction failed.",
          data: { result: lookup.result, transactionId: proposal.transactionId }
        });
        return updated;
      }
    }

    return proposal;
  });

  app.post("/api/strategies/evaluate", async (request) => {
    const parsedBody = parse(strategyEvaluateRequestSchema, request.body);
    const body = { ...parsedBody, slippageBps: parsedBody.slippageBps ?? config.policy.maxSlippageBps };
    const quote = await quoteService.createQuote(body);
    await store.saveQuote(quote);

    const triggered = quote.status === "quoted" && (
      body.condition.type === "always" ||
      Number(quote.amountOut) >= Number(body.condition.minAmountOut)
    );

    let proposal = null;
    if (triggered) {
      const result = await proposalBuilder.createProposal(quote, body.accountId, body.accountId);
      if (result.proposal) {
        proposal = result.proposal;
        await store.saveProposal(result.proposal);
      }
    }

    await addAudit(store, {
      type: triggered ? "strategy_triggered" : "strategy_not_triggered",
      accountId: body.accountId,
      quoteId: quote.id,
      message: triggered ? "Strategy generated a wallet-approval proposal." : "Strategy evaluated without triggering.",
      data: { condition: body.condition },
      ...(proposal ? { proposalId: proposal.id } : {})
    });

    return {
      triggered,
      quote,
      proposal
    };
  });

  app.get("/api/audit/events", async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(Number.parseInt(query.limit ?? "50", 10) || 50, 200);
    return {
      events: await store.listAuditEvents(limit)
    };
  });

  return app;
}

function buildAllowedOrigins(frontendOrigin: string | undefined): string[] {
  return [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(frontendOrigin ? [frontendOrigin] : [])
  ];
}

function parse<T>(schema: ZodSchema<T> | { parse(value: unknown): T }, value: unknown): T {
  return schema.parse(value);
}

async function addAudit(
  store: TradingStore,
  event: Omit<AuditEventRecord, "id" | "createdAt" | "data"> & { data?: Record<string, unknown> }
): Promise<void> {
  await store.addAuditEvent({
    id: makeAuditId(),
    createdAt: new Date().toISOString(),
    type: event.type,
    message: event.message,
    data: event.data ?? {},
    ...(event.accountId ? { accountId: event.accountId } : {}),
    ...(event.quoteId ? { quoteId: event.quoteId } : {}),
    ...(event.proposalId ? { proposalId: event.proposalId } : {})
  });
}

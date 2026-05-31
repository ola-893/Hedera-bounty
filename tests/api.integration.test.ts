import test from "node:test";
import assert from "node:assert/strict";
import { ContractExecuteTransaction, Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import { buildApp } from "../apps/api/src/app";
import { createApiConfig } from "../apps/api/src/config";
import { MirrorNodeClient } from "../packages/hedera/src/mirrorNode";
import { DemoSwapTransactionBuilder, ProposalBuilder } from "../packages/trading/src/proposals";
import { QuoteService, DemoSaucerSwapQuoteProvider } from "../packages/trading/src/quoteService";
import { TradingPolicyEngine } from "../packages/trading/src/policies";
import { InMemoryTradingStore } from "../packages/trading/src/store";

test("quote and proposal flow returns signable transaction bytes", async () => {
  const config = await createApiConfig({
    HEDERA_NETWORK: "testnet",
    ENABLE_MAINNET: "false",
    DEMO_TRANSACTION_BYTES: "true"
  } as NodeJS.ProcessEnv);
  const policyEngine = new TradingPolicyEngine(config.policy);
  const quoteService = new QuoteService(policyEngine, new DemoSaucerSwapQuoteProvider());
  const proposalBuilder = new ProposalBuilder(policyEngine, new DemoSwapTransactionBuilder());
  const store = new InMemoryTradingStore();
  const app = await buildApp({
    config,
    policyEngine,
    quoteService,
    proposalBuilder,
    store,
    mirrorNode: new FakeMirrorNodeClient()
  });

  const quoteResponse = await app.inject({
    method: "POST",
    url: "/api/trades/quote",
    payload: {
      accountId: "0.0.1234",
      tokenIn: "HBAR",
      tokenOut: "SAUCE",
      amountIn: "1",
      slippageBps: 100
    }
  });

  assert.equal(quoteResponse.statusCode, 200);
  const quote = quoteResponse.json();
  assert.equal(quote.status, "quoted");
  assert.equal(quote.policy.allowed, true);

  const proposalResponse = await app.inject({
    method: "POST",
    url: "/api/trades/propose",
    payload: {
      quoteId: quote.id,
      accountId: "0.0.1234"
    }
  });

  assert.equal(proposalResponse.statusCode, 200);
  const proposal = proposalResponse.json();
  assert.ok(proposal.transactionBytes.length > 0);
  assert.equal(proposal.status, "proposed");
  assert.ok(Transaction.fromBytes(Buffer.from(proposal.transactionBytes, "base64")));

  await app.close();
});

test("api accepts browser preflight from the frontend dev server", async () => {
  const config = await createApiConfig({
    HEDERA_NETWORK: "testnet",
    ENABLE_MAINNET: "false",
    DEMO_TRANSACTION_BYTES: "true"
  } as NodeJS.ProcessEnv);
  const app = await buildApp({
    config,
    store: new InMemoryTradingStore(),
    mirrorNode: new FakeMirrorNodeClient()
  });

  const response = await app.inject({
    method: "OPTIONS",
    url: "/api/health",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "GET"
    }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5173");

  await app.close();
});

test("demo quote proposals use wallet-safe memo bytes instead of router contract execution", async () => {
  const config = await createApiConfig({
    HEDERA_NETWORK: "testnet",
    ENABLE_MAINNET: "false",
    SAUCERSWAP_LIVE_QUOTES: "false"
  } as NodeJS.ProcessEnv);
  const policyEngine = new TradingPolicyEngine(config.policy);
  const quoteService = new QuoteService(policyEngine, new DemoSaucerSwapQuoteProvider());
  const app = await buildApp({
    config,
    policyEngine,
    quoteService,
    store: new InMemoryTradingStore(),
    mirrorNode: new FakeMirrorNodeClient()
  });

  const quote = (await app.inject({
    method: "POST",
    url: "/api/trades/quote",
    payload: {
      accountId: "0.0.1234",
      tokenIn: "HBAR",
      tokenOut: "SAUCE",
      amountIn: "10",
      slippageBps: 100
    }
  })).json();

  const proposal = (await app.inject({
    method: "POST",
    url: "/api/trades/propose",
    payload: { quoteId: quote.id, accountId: "0.0.1234" }
  })).json();

  const transaction = Transaction.fromBytes(Buffer.from(proposal.transactionBytes, "base64"));
  assert.equal(transaction instanceof TransferTransaction, true);
  assert.equal(transaction instanceof ContractExecuteTransaction, false);
  assert.match(proposal.approvalSummary, /Demo approval/);

  await app.close();
});

test("submitted proposal status can move to confirmed through transaction lookup", async () => {
  const config = await createApiConfig({
    HEDERA_NETWORK: "testnet",
    ENABLE_MAINNET: "false",
    DEMO_TRANSACTION_BYTES: "true"
  } as NodeJS.ProcessEnv);
  const policyEngine = new TradingPolicyEngine(config.policy);
  const quoteService = new QuoteService(policyEngine, new DemoSaucerSwapQuoteProvider());
  const proposalBuilder = new ProposalBuilder(policyEngine, new DemoSwapTransactionBuilder());
  const app = await buildApp({
    config,
    policyEngine,
    quoteService,
    proposalBuilder,
    store: new InMemoryTradingStore(),
    mirrorNode: new FakeMirrorNodeClient()
  });

  const quote = (await app.inject({
    method: "POST",
    url: "/api/trades/quote",
    payload: {
      accountId: "0.0.1234",
      tokenIn: "HBAR",
      tokenOut: "SAUCE",
      amountIn: "1",
      slippageBps: 100
    }
  })).json();

  const proposal = (await app.inject({
    method: "POST",
    url: "/api/trades/propose",
    payload: { quoteId: quote.id, accountId: "0.0.1234" }
  })).json();

  const completeResponse = await app.inject({
    method: "POST",
    url: `/api/trades/${proposal.proposalId}/complete`,
    payload: {
      status: "submitted",
      transactionId: "0.0.1234@1770000000.000000001"
    }
  });
  assert.equal(completeResponse.statusCode, 200);

  const statusResponse = await app.inject({
    method: "GET",
    url: `/api/trades/${proposal.proposalId}/status`
  });
  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.json().status, "confirmed");

  await app.close();
});

test("trade history returns the submitted swap with quote details", async () => {
  const config = await createApiConfig({
    HEDERA_NETWORK: "testnet",
    ENABLE_MAINNET: "false",
    DEMO_TRANSACTION_BYTES: "true"
  } as NodeJS.ProcessEnv);
  const policyEngine = new TradingPolicyEngine(config.policy);
  const quoteService = new QuoteService(policyEngine, new DemoSaucerSwapQuoteProvider());
  const proposalBuilder = new ProposalBuilder(policyEngine, new DemoSwapTransactionBuilder());
  const app = await buildApp({
    config,
    policyEngine,
    quoteService,
    proposalBuilder,
    store: new InMemoryTradingStore(),
    mirrorNode: new FakeMirrorNodeClient()
  });

  const quote = (await app.inject({
    method: "POST",
    url: "/api/trades/quote",
    payload: {
      accountId: "0.0.1234",
      tokenIn: "HBAR",
      tokenOut: "SAUCE",
      amountIn: "2",
      slippageBps: 100
    }
  })).json();

  const proposal = (await app.inject({
    method: "POST",
    url: "/api/trades/propose",
    payload: { quoteId: quote.id, accountId: "0.0.1234" }
  })).json();

  await app.inject({
    method: "POST",
    url: `/api/trades/${proposal.proposalId}/complete`,
    payload: {
      status: "submitted",
      transactionId: "0.0.1234@1770000000.000000001"
    }
  });

  const historyResponse = await app.inject({
    method: "GET",
    url: "/api/trades/history?accountId=0.0.1234"
  });

  assert.equal(historyResponse.statusCode, 200);
  const [historyItem] = historyResponse.json().history;
  assert.equal(historyItem.proposalId, proposal.proposalId);
  assert.equal(historyItem.tokenIn, "HBAR");
  assert.equal(historyItem.tokenOut, "SAUCE");
  assert.equal(historyItem.amountIn, "2");
  assert.equal(historyItem.transactionId, "0.0.1234@1770000000.000000001");
  assert.equal(historyItem.status, "confirmed");

  await app.close();
});

test("portfolio includes agent-tracked output tokens when mirror balances are not present yet", async () => {
  const config = await createApiConfig({
    HEDERA_NETWORK: "testnet",
    ENABLE_MAINNET: "false",
    DEMO_TRANSACTION_BYTES: "true"
  } as NodeJS.ProcessEnv);
  const policyEngine = new TradingPolicyEngine(config.policy);
  const quoteService = new QuoteService(policyEngine, new DemoSaucerSwapQuoteProvider());
  const proposalBuilder = new ProposalBuilder(policyEngine, new DemoSwapTransactionBuilder());
  const app = await buildApp({
    config,
    policyEngine,
    quoteService,
    proposalBuilder,
    store: new InMemoryTradingStore(),
    mirrorNode: new FakeMirrorNodeClient()
  });

  const quote = (await app.inject({
    method: "POST",
    url: "/api/trades/quote",
    payload: {
      accountId: "0.0.1234",
      tokenIn: "HBAR",
      tokenOut: "XSAUCE",
      amountIn: "5",
      slippageBps: 100
    }
  })).json();

  const proposal = (await app.inject({
    method: "POST",
    url: "/api/trades/propose",
    payload: { quoteId: quote.id, accountId: "0.0.1234" }
  })).json();

  await app.inject({
    method: "POST",
    url: `/api/trades/${proposal.proposalId}/complete`,
    payload: {
      status: "submitted",
      transactionId: "0.0.1234@1770000000.000000001"
    }
  });

  const portfolioResponse = await app.inject({
    method: "GET",
    url: "/api/portfolio/0.0.1234"
  });

  assert.equal(portfolioResponse.statusCode, 200);
  const xsauce = portfolioResponse.json().tokens.find((token: { symbol: string }) => token.symbol === "XSAUCE");
  assert.ok(xsauce);
  assert.equal(xsauce.balance, "63");
  assert.equal(xsauce.balanceSource, "agent");

  await app.close();
});

class FakeMirrorNodeClient extends MirrorNodeClient {
  constructor() {
    super("http://mirror.test");
  }

  override async getPortfolio(accountId: string) {
    return {
      accountId,
      hbarBalance: "10",
      tokens: [],
      recentTransactions: []
    };
  }

  override async getTransactionStatus() {
    return { status: "confirmed" as const, result: "SUCCESS" };
  }
}

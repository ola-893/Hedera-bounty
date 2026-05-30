import test from "node:test";
import assert from "node:assert/strict";
import { TradingPolicyEngine, createDefaultPolicyConfig } from "../packages/trading/src/policies";
import type { TradeQuote } from "../packages/trading/src/types";

test("policy engine blocks unsafe quote requests", () => {
  const engine = new TradingPolicyEngine(createDefaultPolicyConfig());

  assert.equal(engine.evaluateQuoteRequest({
    accountId: "0.0.1234",
    tokenIn: "DOGE",
    tokenOut: "SAUCE",
    amountIn: "1",
    slippageBps: 100
  }).verdict.allowed, false);

  assert.equal(engine.evaluateQuoteRequest({
    accountId: "0.0.1234",
    tokenIn: "HBAR",
    tokenOut: "SAUCE",
    amountIn: "1",
    slippageBps: 500
  }).verdict.allowed, false);

  assert.equal(engine.evaluateQuoteRequest({
    accountId: "0.0.1234",
    tokenIn: "HBAR",
    tokenOut: "SAUCE",
    amountIn: "5000",
    slippageBps: 100
  }).verdict.allowed, false);
});

test("policy engine blocks mainnet unless explicitly enabled", () => {
  const engine = new TradingPolicyEngine(createDefaultPolicyConfig({
    HEDERA_NETWORK: "mainnet",
    ENABLE_MAINNET: "false"
  } as NodeJS.ProcessEnv));

  const result = engine.evaluateQuoteRequest({
    accountId: "0.0.1234",
    tokenIn: "HBAR",
    tokenOut: "SAUCE",
    amountIn: "1",
    slippageBps: 100
  });

  assert.equal(result.verdict.allowed, false);
  assert.match(result.verdict.reasons.join(" "), /Mainnet trading is disabled/);
});

test("policy engine blocks stale quotes and recipient mismatch", () => {
  const engine = new TradingPolicyEngine(createDefaultPolicyConfig());
  const quote = makeQuote({
    expiresAt: new Date("2026-01-01T00:00:00.000Z").toISOString()
  });

  const stale = engine.evaluateProposal(
    quote,
    "0.0.1234",
    "0.0.1234",
    new Date("2026-01-01T00:01:00.000Z")
  );
  assert.equal(stale.allowed, false);
  assert.match(stale.reasons.join(" "), /expired/);

  const mismatch = engine.evaluateProposal(
    makeQuote({ expiresAt: new Date("2026-01-01T00:10:00.000Z").toISOString() }),
    "0.0.1234",
    "0.0.9999",
    new Date("2026-01-01T00:01:00.000Z")
  );
  assert.equal(mismatch.allowed, false);
  assert.match(mismatch.reasons.join(" "), /Recipient account/);
});

function makeQuote(patch: Partial<TradeQuote> = {}): TradeQuote {
  return {
    id: "quote_test",
    accountId: "0.0.1234",
    tokenIn: "HBAR",
    tokenOut: "SAUCE",
    amountIn: "1",
    amountOut: "100",
    amountInSmallest: "100000000",
    amountOutSmallest: "100000000",
    route: ["0.0.15058", "0.0.1183558"],
    slippageBps: 100,
    quoteHash: "hash",
    expiresAt: new Date("2026-01-01T00:10:00.000Z").toISOString(),
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    source: "test",
    status: "quoted",
    policy: { allowed: true, reasons: [], warnings: [] },
    ...patch
  };
}

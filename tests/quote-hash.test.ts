import test from "node:test";
import assert from "node:assert/strict";
import { hashQuotePayload } from "../packages/trading/src/policies";

test("quote hash changes when economically important fields change", () => {
  const base = {
    accountId: "0.0.1234",
    tokenIn: "HBAR",
    tokenOut: "SAUCE",
    amountIn: "1",
    amountOut: "100",
    route: ["0.0.15058", "0.0.1183558"],
    slippageBps: 100,
    expiresAt: "2026-01-01T00:01:00.000Z",
    source: "test"
  };

  const original = hashQuotePayload(base);
  assert.notEqual(hashQuotePayload({ ...base, amountOut: "99" }), original);
  assert.notEqual(hashQuotePayload({ ...base, route: [...base.route].reverse() }), original);
  assert.notEqual(hashQuotePayload({ ...base, slippageBps: 50 }), original);
  assert.notEqual(hashQuotePayload({ ...base, expiresAt: "2026-01-01T00:02:00.000Z" }), original);
});

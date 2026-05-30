import test from "node:test";
import assert from "node:assert/strict";
import { parseTradingIntent } from "../packages/trading/src/intentParser";

test("intent parser maps swap command into structured quote request", () => {
  const intent = parseTradingIntent("swap 10 HBAR to USDC");

  assert.deepEqual(intent, {
    type: "quote_request",
    tokenIn: "HBAR",
    tokenOut: "USDC",
    amountIn: "10",
    confidence: 0.92
  });
});

test("intent parser supports buy phrasing", () => {
  const intent = parseTradingIntent("buy SAUCE with 5 HBAR");

  assert.equal(intent?.tokenIn, "HBAR");
  assert.equal(intent?.tokenOut, "SAUCE");
  assert.equal(intent?.amountIn, "5");
});

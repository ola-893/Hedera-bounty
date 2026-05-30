import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { MirrorNodeClient } from "../packages/hedera/src/mirrorNode";
import { createHederaNetworkConfig } from "../packages/hedera/src/network";
import { SaucerSwapQuoteProvider } from "../packages/hedera/src/saucerswapQuoteProvider";
import { QuoteService } from "../packages/trading/src/quoteService";
import { TradingPolicyEngine, createDefaultPolicyConfig } from "../packages/trading/src/policies";

const QUOTER_ABI = [
  "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)"
];

test("live SaucerSwap quote path does not depend on importing the broken official plugin", async () => {
  const env = { HEDERA_NETWORK: "testnet" } as NodeJS.ProcessEnv;
  const policyEngine = new TradingPolicyEngine(createDefaultPolicyConfig(env));
  const provider = new SaucerSwapQuoteProvider(
    createHederaNetworkConfig(env),
    new FakeContractCallMirrorNodeClient(),
    {
      liveQuotes: true,
      allowDemoFallback: false,
      poolFee: 3000
    }
  );

  const quote = await new QuoteService(policyEngine, provider).createQuote({
    accountId: "0.0.1234",
    tokenIn: "HBAR",
    tokenOut: "SAUCE",
    amountIn: "1",
    slippageBps: 100
  });

  assert.equal(quote.status, "quoted");
  assert.equal(quote.source, "saucerswap-v2-quoter");
  assert.equal(quote.amountOutSmallest, "25000000");
});

class FakeContractCallMirrorNodeClient extends MirrorNodeClient {
  private readonly iface = new Interface(QUOTER_ABI);

  constructor() {
    super("http://mirror.test");
  }

  override async postContractCall<T>(): Promise<T> {
    return {
      result: this.iface.encodeFunctionResult("quoteExactInput", [
        25000000n,
        [],
        [],
        125000n
      ])
    } as T;
  }
}

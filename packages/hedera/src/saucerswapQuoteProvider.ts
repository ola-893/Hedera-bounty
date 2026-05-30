import { Interface } from "ethers";
import type { QuoteProvider, QuoteProviderQuote } from "../../trading/src/quoteService";
import { DemoSaucerSwapQuoteProvider } from "../../trading/src/quoteService";
import { parseUnits } from "../../trading/src/amounts";
import type { ResolvedQuoteRequest } from "../../trading/src/types";
import { encodeV2Path, entityIdToSolidityAddress } from "./id";
import type { HederaNetworkConfig } from "./network";
import { MirrorNodeClient } from "./mirrorNode";

const QUOTER_ABI = [
  "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)"
];

interface MirrorContractCallResponse {
  result?: string;
  error_message?: string;
}

export interface SaucerSwapQuoteProviderOptions {
  liveQuotes: boolean;
  allowDemoFallback: boolean;
  poolFee: number;
}

export class SaucerSwapQuoteProvider implements QuoteProvider {
  private readonly iface = new Interface(QUOTER_ABI);
  private readonly demoProvider = new DemoSaucerSwapQuoteProvider();

  constructor(
    private readonly networkConfig: HederaNetworkConfig,
    private readonly mirrorNode: MirrorNodeClient,
    private readonly options: SaucerSwapQuoteProviderOptions
  ) {}

  async getQuote(request: ResolvedQuoteRequest): Promise<QuoteProviderQuote> {
    if (!this.options.liveQuotes) {
      return this.demoProvider.getQuote(request);
    }

    try {
      return await this.getLiveQuote(request);
    } catch (error) {
      if (this.options.allowDemoFallback) {
        const demo = await this.demoProvider.getQuote(request);
        return {
          ...demo,
          source: `saucerswap-live-fallback:${error instanceof Error ? error.message : "unknown"}`
        };
      }
      throw error;
    }
  }

  private async getLiveQuote(request: ResolvedQuoteRequest): Promise<QuoteProviderQuote> {
    const tokenInPathId = request.tokenInConfig.saucerPathTokenId ?? request.tokenInConfig.tokenId;
    const tokenOutPathId = request.tokenOutConfig.saucerPathTokenId ?? request.tokenOutConfig.tokenId;
    const path = encodeV2Path([tokenInPathId, tokenOutPathId], [this.options.poolFee]);
    const amountInSmallest = parseUnits(request.amountIn, request.tokenInConfig.decimals).toString();
    const data = this.iface.encodeFunctionData("quoteExactInput", [path, amountInSmallest]);

    const result = await this.mirrorNode.postContractCall<MirrorContractCallResponse>({
      block: "latest",
      data,
      to: entityIdToSolidityAddress(this.networkConfig.saucerSwapV2QuoterContractId)
    });

    if (!result.result) {
      throw new Error(result.error_message ?? "SaucerSwap quoter returned no result.");
    }

    const decoded = this.iface.decodeFunctionResult("quoteExactInput", result.result);
    return {
      amountOutSmallest: decoded[0].toString(),
      route: [tokenInPathId, tokenOutPathId],
      source: "saucerswap-v2-quoter"
    };
  }

}

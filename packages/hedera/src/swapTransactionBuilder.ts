import { Interface } from "ethers";
import { calculateMinimumOut } from "../../trading/src/proposals";
import type { SwapTransactionBuilder } from "../../trading/src/proposals";
import type { TradeQuote } from "../../trading/src/types";
import { encodeV2Path, entityIdToSolidityAddress, hexToBytes } from "./id";
import type { HederaNetworkConfig } from "./network";

const ROUTER_ABI = [
  "function exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)"
];

export class HederaSwapTransactionBuilder implements SwapTransactionBuilder {
  private readonly iface = new Interface(ROUTER_ABI);

  constructor(
    private readonly networkConfig: HederaNetworkConfig,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly now: () => Date = () => new Date()
  ) {}

  async buildSwapTransactionBytes(quote: TradeQuote, recipientAccountId: string): Promise<string> {
    const sdk = await import("@hiero-ledger/sdk") as Record<string, any>;
    const client = this.createClient(sdk);
    const deadline = Math.floor(this.now().getTime() / 1000) + 60;
    const path = encodeV2Path(quote.route, new Array(Math.max(quote.route.length - 1, 1)).fill(3000));
    const functionData = this.iface.encodeFunctionData("exactInput", [{
      path,
      recipient: entityIdToSolidityAddress(recipientAccountId),
      deadline,
      amountIn: quote.amountInSmallest,
      amountOutMinimum: calculateMinimumOut(quote.amountOutSmallest, quote.slippageBps)
    }]);

    const tx = new sdk.ContractExecuteTransaction()
      .setContractId(sdk.ContractId.fromString(this.networkConfig.saucerSwapV2RouterContractId))
      .setGas(450000)
      .setTransactionId(sdk.TransactionId.generate(sdk.AccountId.fromString(quote.accountId)));

    if (quote.tokenIn === "HBAR") {
      tx.setPayableAmount(sdk.Hbar.fromTinybars(quote.amountInSmallest));
    }

    if (typeof tx.setFunctionParameters !== "function") {
      throw new Error("Hedera SDK ContractExecuteTransaction.setFunctionParameters is unavailable.");
    }

    tx.setFunctionParameters(hexToBytes(functionData));
    try {
      const frozen = tx.freezeWith(client);
      return Buffer.from(frozen.toBytes()).toString("base64");
    } finally {
      if (typeof client.close === "function") {
        client.close();
      }
    }
  }

  private createClient(sdk: Record<string, any>): any {
    const client = this.networkConfig.network === "mainnet"
      ? sdk.Client.forMainnet()
      : this.networkConfig.network === "previewnet"
        ? sdk.Client.forPreviewnet()
        : sdk.Client.forTestnet();

    const accountId = this.env.HEDERA_OPERATOR_ACCOUNT_ID;
    const privateKey = this.env.HEDERA_OPERATOR_PRIVATE_KEY;
    if (accountId && privateKey) {
      client.setOperator(accountId, privateKey);
    }

    return client;
  }
}

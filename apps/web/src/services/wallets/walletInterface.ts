/* eslint-disable @typescript-eslint/no-explicit-any */
import { AccountId, ContractId, TokenId, TransactionId } from "@hashgraph/sdk";
import { ContractFunctionParameterBuilder } from "./contractFunctionParameterBuilder";

export interface WalletInterface {
  executeContractFunction: (
    contractId: ContractId,
    functionName: string,
    functionParameters: ContractFunctionParameterBuilder,
    gasLimit: number
  ) => Promise<TransactionId | string | null>;
  disconnect: () => void;
  transferHBAR: (
    toAddress: AccountId,
    amount: number
  ) => Promise<TransactionId | string | null>;
  transferFungibleToken: (
    toAddress: AccountId,
    tokenId: TokenId,
    amount: number
  ) => Promise<TransactionId | string | null>;
  transferNonFungibleToken: (
    toAddress: AccountId,
    tokenId: TokenId,
    serialNumber: number
  ) => Promise<TransactionId | string | null>;
  associateToken: (tokenId: TokenId) => Promise<TransactionId | string | null>;
  signMessage(message: Uint8Array): Promise<{
    signature: string;
  }>;
  sendTransaction(
    transaction: any // any Hedera SDK Transaction that implements freezeWithSigner/executeWithSigner
  ): Promise<string | null>;
}

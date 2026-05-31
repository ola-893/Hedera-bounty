/* eslint-disable @typescript-eslint/no-explicit-any */
import { WalletConnectContext } from "../../../contexts/WalletConnectContext";
import { useCallback, useContext, useEffect } from "react";
import type { WalletInterface } from "../walletInterface";
import {
  AccountId,
  ContractExecuteTransaction,
  ContractId,
  LedgerId,
  TokenAssociateTransaction,
  TokenId,
  TransactionId,
  TransferTransaction,
  Client,
} from "@hiero-ledger/sdk";
import { ContractFunctionParameterBuilder } from "../contractFunctionParameterBuilder";
import { appConfig } from "../../../config";
import {
  DAppConnector,
  HederaJsonRpcMethod,
  HederaSessionEvent,
  HederaChainId,
  DAppSigner,
} from "@hashgraph/hedera-wallet-connect";
import EventEmitter from "events";

// Create refresh event for syncing wallet state
const refreshEvent = new EventEmitter();

// WalletConnect Project ID
const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ||
  import.meta.env.WALLETCONNECT_PROJECT_ID ||
  "";

const currentNetworkConfig = appConfig.networks.testnet;
const hederaNetwork = currentNetworkConfig.network;

// Create a client for freezing transactions
const hederaClient = Client.forName(hederaNetwork);

// Metadata for Ajo.Save DApp
const metadata = {
  name: "Ajo.Save",
  description: "Decentralized Savings Platform on Hedera",
  url: window.location.origin,
  icons: [window.location.origin + "/logo192.png"],
};

// Initialize DAppConnector with better storage handling
const dappConnector = new DAppConnector(
  metadata,
  LedgerId.fromString(hederaNetwork),
  walletConnectProjectId,
  Object.values(HederaJsonRpcMethod),
  [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
  [HederaChainId.Testnet]
);

/**
 * Helper: Convert SignerSignature to hex string
 * Handles various signature formats from different wallets
 */
function signatureToHex(signature: any): string {
  // Case 1: Uint8Array (most common)
  if (signature instanceof Uint8Array) {
    return (
      "0x" +
      Array.from(signature)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  }

  // Case 2: Already a hex string
  if (typeof signature === "string") {
    return signature.startsWith("0x") ? signature : "0x" + signature;
  }

  // Case 3: Object with signature property
  if (signature && typeof signature === "object") {
    const sigBytes = signature.signature || signature;
    if (sigBytes instanceof Uint8Array) {
      return (
        "0x" +
        Array.from(sigBytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      );
    }
  }

  throw new Error(`Unable to convert signature to hex: ${typeof signature}`);
}

// Ensure WalletConnect initializes only once
let walletConnectInitPromise: Promise<void> | undefined = undefined;

export const initializeWalletConnect = async () => {
  if (!walletConnectProjectId) {
    throw new Error(
      "Missing VITE_WALLETCONNECT_PROJECT_ID. Add your WalletConnect/Reown project ID to the root .env file and restart the frontend."
    );
  }

  if (walletConnectInitPromise === undefined) {
    walletConnectInitPromise = dappConnector.init({
      logger: "error",
    });
  }

  try {
    await walletConnectInitPromise;
    if (!dappConnector.walletConnectClient) {
      walletConnectInitPromise = undefined;
      throw new Error("WalletConnect could not initialize. Check your Project ID and try again.");
    }
    console.log("✅ WalletConnect initialized successfully");
  } catch (error) {
    console.error("❌ WalletConnect initialization failed:", error);
    // Reset the promise so it can be retried
    walletConnectInitPromise = undefined;
    throw error;
  }
};

export const getWalletConnectSigner = () => dappConnector.signers[0] ?? null;

const getWalletConnectErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes("Failed to publish custom payload") ||
    message.includes("WebSocket") ||
    message.includes("relay.walletconnect.com")
  ) {
    return (
      "WalletConnect could not reach the relay, so the pairing modal could not be created. " +
      "Check your internet connection, VPN/ad blocker, and that relay.walletconnect.com is allowed, then try again."
    );
  }

  return message;
};

// Open WalletConnect modal for pairing
export const openWalletConnectModal = async () => {
  try {
    await initializeWalletConnect();

    if (getWalletConnectSigner()) {
      refreshEvent.emit("sync");
      return;
    }

    await dappConnector.openModal(undefined, true);

    if (!getWalletConnectSigner()) {
      throw new Error(
        "HashPack did not return a Hedera testnet account. Make sure HashPack is set to testnet and approve the WalletConnect request."
      );
    }

    refreshEvent.emit("sync");
  } catch (error) {
    console.error("Failed to open WalletConnect modal:", error);
    throw new Error(getWalletConnectErrorMessage(error));
  }
};

// Export dAppConnector for use in other components (like Header for minting)
export { dappConnector };

class WalletConnectWallet implements WalletInterface {
  private getSigner(): DAppSigner | null {
    if (!dappConnector.signers || dappConnector.signers.length === 0) {
      console.warn("⚠️ No signer available");
      return null;
    }
    return dappConnector.signers[0];
  }

  private accountId(): AccountId {
    const signer = this.getSigner();
    if (!signer) {
      throw new Error("No signer available");
    }
    return AccountId.fromString(signer.getAccountId().toString());
  }

  /**
   * Sign a message using WalletConnect/HashPack
   * This is needed for HCS voting signatures
   */
  async signMessage(message: Uint8Array): Promise<{ signature: string }> {
    const signer = this.getSigner();
    if (!signer) {
      throw new Error("No signer available");
    }

    try {
      console.log("📝 Requesting signature from wallet...");

      // Sign the message using DAppSigner
      const signatureResponse = await signer.sign([message]);

      // Convert the first signature to hex string
      const signatureHex = signatureToHex(signatureResponse[0]);

      console.log("✅ Signature received:", signatureHex.slice(0, 20) + "...");
      console.log("   Signature length:", signatureHex.length, "chars");

      return {
        signature: signatureHex,
      };
    } catch (error: any) {
      console.error("❌ Message signing failed:", error);

      if (error.message?.includes("User rejected")) {
        throw new Error("Signature request was rejected in wallet");
      }

      throw new Error(`Failed to sign message: ${error.message}`);
    }
  }

  async transferHBAR(toAddress: AccountId, amount: number) {
    const signer = this.getSigner();
    if (!signer) {
      throw new Error("No signer available");
    }

    const accountId = this.accountId();

    const transferTransaction = new TransferTransaction()
      .addHbarTransfer(accountId, -amount)
      .addHbarTransfer(toAddress, amount)
      .setTransactionId(TransactionId.generate(accountId))
      .setNodeAccountIds([AccountId.fromString("0.0.3")]);

    try {
      await transferTransaction.freezeWith(hederaClient);
      const txResponse = await transferTransaction.executeWithSigner(signer as any);
      return txResponse.transactionId.toString();
    } catch (error) {
      console.error("Transfer HBAR failed:", error);
      return null;
    }
  }

  async transferFungibleToken(
    toAddress: AccountId,
    tokenId: TokenId,
    amount: number
  ) {
    const signer = this.getSigner();
    if (!signer) {
      throw new Error("No signer available");
    }

    const accountId = this.accountId();

    const transferTransaction = new TransferTransaction()
      .addTokenTransfer(tokenId, accountId, -amount)
      .addTokenTransfer(tokenId, toAddress, amount)
      .setTransactionId(TransactionId.generate(accountId))
      .setNodeAccountIds([AccountId.fromString("0.0.3")]);

    try {
      await transferTransaction.freezeWith(hederaClient);
      const txResponse = await transferTransaction.executeWithSigner(signer as any);
      return txResponse.transactionId.toString();
    } catch (error) {
      console.error("Transfer fungible token failed:", error);
      return null;
    }
  }

  async transferNonFungibleToken(
    toAddress: AccountId,
    tokenId: TokenId,
    serialNumber: number
  ) {
    const signer = this.getSigner();
    if (!signer) {
      throw new Error("No signer available");
    }

    const accountId = this.accountId();

    const transferTransaction = new TransferTransaction()
      .addNftTransfer(tokenId, serialNumber, accountId, toAddress)
      .setTransactionId(TransactionId.generate(accountId))
      .setNodeAccountIds([AccountId.fromString("0.0.3")]);

    try {
      await transferTransaction.freezeWith(hederaClient);
      const txResponse = await transferTransaction.executeWithSigner(signer as any);
      return txResponse.transactionId.toString();
    } catch (error) {
      console.error("Transfer NFT failed:", error);
      return null;
    }
  }

  async associateToken(tokenId: TokenId) {
    const signer = this.getSigner();
    if (!signer) {
      throw new Error("No signer available");
    }

    const accountId = this.accountId();

    const associateTransaction = new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([tokenId])
      .setTransactionId(TransactionId.generate(accountId))
      .setNodeAccountIds([AccountId.fromString("0.0.3")]);

    try {
      await associateTransaction.freezeWith(hederaClient);
      const txResponse = await associateTransaction.executeWithSigner(signer as any);
      return txResponse.transactionId.toString();
    } catch (error) {
      console.error("Token association failed:", error);
      return null;
    }
  }

  async sendTransaction(
    transaction: any // Hedera SDK Transaction (e.g. TransferTransaction, ContractExecuteTransaction, …)
  ): Promise<string | null> {
    const signer = this.getSigner();
    if (!signer) {
      throw new Error("No signer available");
    }

    try {
      console.log("Sending transaction with WalletConnect signer...");

      let txResponse: any;

      try {
        // ---- Standard Execution Path ---------------------------------
        // This internally calls freezeWithSigner, which might try to 
        // populateTransaction and crash if the backend already froze it.
        console.log("Attempting standard executeWithSigner...");
        const execPromise = transaction.executeWithSigner(signer as any);
        const execTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Execution timeout after 90s")), 90000)
        );
        txResponse = await Promise.race([execPromise, execTimeout]);
      } catch (error: any) {
        if (
          error.message?.includes("immutable") ||
          error.message?.includes("frozen")
        ) {
          console.log("Transaction is immutable (already frozen). Proceeding to sign directly...");
          
          // ---- Pre-Frozen Execution Path -----------------------------
          // Sign directly, bypassing freezeWithSigner
          const signPromise = signer.signTransaction(transaction);
          const signTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Sign timeout after 60s")), 60000)
          );
          const signedTx = await Promise.race([signPromise, signTimeout]);
          
          console.log("Signed successfully. Calling network...");
          const callPromise = signer.call(signedTx as any);
          const callTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Call timeout after 60s")), 60000)
          );
          txResponse = await Promise.race([callPromise, callTimeout]);
        } else {
          throw error;
        }
      }

      const txId = txResponse.transactionId.toString();
      if (typeof txResponse.getReceiptWithSigner === "function") {
        const receipt = await txResponse.getReceiptWithSigner(signer as any);
        const receiptStatus = receipt?.status?.toString?.() ?? "";
        if (receiptStatus && receiptStatus !== "SUCCESS") {
          throw new Error(`Wallet submitted transaction ${txId}, but network receipt status was ${receiptStatus}.`);
        }
      }

      console.log("Transaction executed:", txId);
      return txId;
    } catch (error: any) {
      console.error("sendTransaction failed:", error);

      if (error.message?.includes("timeout")) {
        throw new Error("Transaction timed out. Please try again.");
      }
      if (error.message?.includes("User rejected")) {
        throw new Error("Transaction rejected in wallet.");
      }
      if (error.message?.includes("insufficient")) {
        throw new Error("Insufficient balance for transaction.");
      }

      throw error; // re-throw for caller handling
    }
  }

  async executeContractFunction(
    contractId: ContractId,
    functionName: string,
    functionParameters: ContractFunctionParameterBuilder,
    gasLimit: number
  ) {
    const signer = this.getSigner();
    if (!signer) {
      throw new Error("No signer available");
    }

    console.log("🔧 Executing contract function:", {
      contractId: contractId.toString(),
      functionName,
      gasLimit,
      accountId: signer.getAccountId().toString(),
    });

    const params = functionParameters.buildHAPIParams();

    // ✅ Don't set transactionId or nodeAccountIds manually
    // freezeWithSigner will handle these automatically
    const tx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gasLimit)
      .setFunction(functionName, params);

    try {
      console.log("🔄 Freezing transaction with signer...");

      // ✅ Add timeout to prevent hanging
      const freezePromise = tx.freezeWithSigner(signer as any);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Transaction freeze timeout after 60s")),
          60000
        )
      );

      const frozenTx = (await Promise.race([
        freezePromise,
        timeoutPromise,
      ])) as any;
      console.log("✅ Transaction frozen successfully");

      console.log("📤 Executing transaction...");
      const executePromise = frozenTx.executeWithSigner(signer as any);
      const execTimeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Transaction execution timeout after 90s")),
          90000
        )
      );

      const txResponse = (await Promise.race([
        executePromise,
        execTimeoutPromise,
      ])) as any;
      console.log(
        "✅ Transaction executed:",
        txResponse.transactionId.toString()
      );

      return txResponse.transactionId.toString();
    } catch (error: any) {
      console.error("❌ Contract execution failed:", error);

      // ✅ Provide more detailed error messages
      if (error.message?.includes("timeout")) {
        throw new Error(
          "Transaction timed out. Please check your wallet and try again."
        );
      } else if (error.message?.includes("User rejected")) {
        throw new Error("Transaction was rejected in wallet");
      } else if (error.message?.includes("insufficient")) {
        throw new Error("Insufficient balance for transaction");
      }

      throw error;
    }
  }

  disconnect() {
    console.log("🔌 Disconnecting wallet...");
    dappConnector
      .disconnectAll()
      .then(() => {
        // ✅ Clear any cached state
        console.log("✅ Wallet disconnected");
        refreshEvent.emit("sync");
      })
      .catch((error) => {
        console.error("❌ Disconnect failed:", error);
        // Force sync anyway
        refreshEvent.emit("sync");
      });
  }
}

export const walletConnectWallet = new WalletConnectWallet();

// Component to sync WalletConnect state with React context
export const WalletConnectClient = () => {
  const { setAccountId, setIsConnected } = useContext(WalletConnectContext);

  const syncWithWalletConnectContext = useCallback(() => {
    const accountId = dappConnector.signers[0]?.getAccountId()?.toString();
    console.log("🔄 Syncing wallet state:", {
      accountId,
      hasSigners: !!dappConnector.signers[0],
    });

    if (accountId) {
      setAccountId(accountId);
      setIsConnected(true);
      console.log("✅ Wallet connected:", accountId);
    } else {
      setAccountId("");
      setIsConnected(false);
      console.log("ℹ️ Wallet disconnected");
    }
  }, [setAccountId, setIsConnected]);

  useEffect(() => {
    // Listen for wallet connection changes
    refreshEvent.addListener("sync", syncWithWalletConnectContext);

    // Initialize WalletConnect on mount
    initializeWalletConnect()
      .then(() => {
        console.log("🎉 WalletConnect ready");
        syncWithWalletConnectContext();
      })
      .catch((error) => {
        console.error("💥 WalletConnect initialization failed:", error);
      });

    // Cleanup
    return () => {
      refreshEvent.removeListener("sync", syncWithWalletConnectContext);
    };
  }, [syncWithWalletConnectContext]);

  return null;
};

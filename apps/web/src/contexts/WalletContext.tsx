import { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { AccountId, TokenId } from "@hiero-ledger/sdk";
import {
  dappConnector,
  getWalletConnectSigner,
  initializeWalletConnect,
  openWalletConnectModal,
} from "../services/wallets/walletconnect/walletConnectClient";
import { MirrorNodeClient } from "../services/wallets/mirrorNodeClient";
import { appConfig } from "../config";

interface WalletContextType {
  connected: boolean;
  address: string | null;
  balance: string | null;
  network: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dAppSigner: any; // The DAppSigner from WalletConnect
  connect: () => Promise<void>;
  disconnect: () => void;
  getBalance: () => Promise<string>;
  associateToken: (tokenAddress: string) => Promise<void>;
  getTokenBalance: (tokenId: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [network] = useState("testnet");

  const mirrorNodeClient = useMemo(
    () => new MirrorNodeClient(appConfig.networks.testnet),
    []
  );

  const syncConnectedSigner = useCallback(async () => {
    const signer = getWalletConnectSigner();
    if (!signer) return false;

    const accountId = signer.getAccountId().toString();
    setAddress(accountId);
    setConnected(true);

    const accountInfo = await mirrorNodeClient.getAccountInfo(
      AccountId.fromString(accountId)
    );
    const hbarBalance = (accountInfo.balance.balance / 100000000).toFixed(2);
    setBalance(hbarBalance);

    return true;
  }, [mirrorNodeClient]);

  useEffect(() => {
    let cancelled = false;

    initializeWalletConnect()
      .then(async () => {
        if (cancelled) return;
        await syncConnectedSigner();
      })
      .catch((error) => {
        console.error("Failed to restore WalletConnect session:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [syncConnectedSigner]);

  const connect = useCallback(async () => {
    try {
      await openWalletConnectModal();

      const synced = await syncConnectedSigner();
      if (!synced) {
        throw new Error(
          "No HashPack testnet signer was returned. Check that HashPack is on testnet and approve the WalletConnect session."
        );
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      setConnected(false);
      setAddress(null);
      setBalance(null);
      throw error;
    }
  }, [syncConnectedSigner]);

  const disconnect = useCallback(() => {
    dappConnector.disconnectAll();
    setConnected(false);
    setAddress(null);
    setBalance(null);
  }, []);

  const getBalance = useCallback(async (): Promise<string> => {
    if (!address) return "0";

    try {
      const accountInfo = await mirrorNodeClient.getAccountInfo(
        AccountId.fromString(address)
      );
      const hbarBalance = (accountInfo.balance.balance / 100000000).toFixed(2);
      setBalance(hbarBalance);
      return hbarBalance;
    } catch (error) {
      console.error("Failed to fetch balance:", error);
      return "0";
    }
  }, [address]);

  const associateToken = useCallback(
    async (tokenAddress: string) => {
      if (!address) {
        throw new Error("Wallet not connected");
      }

      const signer = dappConnector.signers[0];
      if (!signer) {
        throw new Error("No signer available");
      }

      // Convert EVM address to Hedera token ID if needed
      const tokenId = tokenAddress.startsWith("0x")
        ? convertEvmToHederaAddress(tokenAddress)
        : tokenAddress;

      const { TokenAssociateTransaction } = await import("@hiero-ledger/sdk");

      const associateTransaction = new TokenAssociateTransaction()
        .setAccountId(AccountId.fromString(address))
        .setTokenIds([TokenId.fromString(tokenId)]);

      await associateTransaction.executeWithSigner(signer as any);
    },
    [address]
  );

  const getTokenBalance = useCallback(
    async (tokenId: string): Promise<string> => {
      if (!address) return "0";

      try {
        const balances =
          await mirrorNodeClient.getAccountTokenBalancesWithTokenInfo(
            AccountId.fromString(address)
          );

        const tokenBalance = balances.find((b) => b.token_id === tokenId);
        if (!tokenBalance) return "0";

        const decimals = parseInt(tokenBalance.info.decimals);
        const balance = tokenBalance.balance / Math.pow(10, decimals);

        return balance.toFixed(decimals);
      } catch (error) {
        console.error("Failed to fetch token balance:", error);
        return "0";
      }
    },
    [address]
  );

  // Get the DAppSigner for direct use in components
  const dAppSigner = dappConnector.signers[0] || null;

  return (
    <WalletContext.Provider
      value={{
        connected,
        address,
        balance,
        network,
        dAppSigner,
        connect,
        disconnect,
        getBalance,
        associateToken,
        getTokenBalance,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
};

// Helper function to convert EVM address to Hedera format
const convertEvmToHederaAddress = (evmAddress: string): string => {
  if (!evmAddress.startsWith("0x")) {
    return evmAddress;
  }

  try {
    const accountNum = parseInt(evmAddress.slice(2), 16);
    return `0.0.${accountNum}`;
  } catch (error) {
    console.error("Failed to convert EVM address to Hedera format:", error);
    return evmAddress;
  }
};

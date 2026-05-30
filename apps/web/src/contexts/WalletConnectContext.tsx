import { createContext, useState } from "react";
import type { ReactNode } from "react";

const defaultValue = {
  accountId: "",
  setAccountId: (_newValue: string) => {},
  isConnected: false,
  setIsConnected: (_newValue: boolean) => {},
};

export const WalletConnectContext = createContext(defaultValue);

export const WalletConnectContextProvider = (props: {
  children: ReactNode | undefined;
}) => {
  const [accountId, setAccountId] = useState(defaultValue.accountId);
  const [isConnected, setIsConnected] = useState(defaultValue.isConnected);

  return (
    <WalletConnectContext.Provider
      value={{
        accountId,
        setAccountId,
        isConnected,
        setIsConnected,
      }}
    >
      {props.children}
    </WalletConnectContext.Provider>
  );
};

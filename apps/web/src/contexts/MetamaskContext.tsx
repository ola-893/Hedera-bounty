import { createContext, useState } from "react";
import type { ReactNode } from "react";

const defaultValue = {
  metamaskAccountAddress: "",
  setMetamaskAccountAddress: (_newValue: string) => {},
};

export const MetamaskContext = createContext(defaultValue);

export const MetamaskContextProvider = (props: {
  children: ReactNode | undefined;
}) => {
  const [metamaskAccountAddress, setMetamaskAccountAddress] = useState("");

  return (
    <MetamaskContext.Provider
      value={{
        metamaskAccountAddress,
        setMetamaskAccountAddress,
      }}
    >
      {props.children}
    </MetamaskContext.Provider>
  );
};

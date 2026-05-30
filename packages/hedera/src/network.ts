import type { NetworkName } from "../../trading/src/types";

export interface HederaNetworkConfig {
  network: NetworkName;
  mirrorNodeBaseUrl: string;
  saucerSwapV2QuoterContractId: string;
  saucerSwapV2RouterContractId: string;
  whbarTokenId: string;
}

export function createHederaNetworkConfig(env: NodeJS.ProcessEnv = process.env): HederaNetworkConfig {
  const network = readNetwork(env.HEDERA_NETWORK);
  const defaults = defaultContracts(network);

  return {
    network,
    mirrorNodeBaseUrl: env.MIRROR_NODE_BASE_URL ?? defaultMirrorNode(network),
    saucerSwapV2QuoterContractId: env.SAUCERSWAP_V2_QUOTER_CONTRACT_ID ?? defaults.quoter,
    saucerSwapV2RouterContractId: env.SAUCERSWAP_V2_ROUTER_CONTRACT_ID ?? defaults.router,
    whbarTokenId: env.WHBAR_TOKEN_ID ?? defaults.whbar
  };
}

function readNetwork(value: string | undefined): NetworkName {
  if (value === "mainnet" || value === "previewnet" || value === "testnet") {
    return value;
  }
  return "testnet";
}

function defaultMirrorNode(network: NetworkName): string {
  if (network === "mainnet") return "https://mainnet-public.mirrornode.hedera.com";
  if (network === "previewnet") return "https://previewnet.mirrornode.hedera.com";
  return "https://testnet.mirrornode.hedera.com";
}

function defaultContracts(network: NetworkName): { quoter: string; router: string; whbar: string } {
  if (network === "mainnet") {
    return {
      quoter: "0.0.3949424",
      router: "0.0.3949434",
      whbar: "0.0.1456985"
    };
  }

  return {
    quoter: "0.0.1390002",
    router: "0.0.1414040",
    whbar: "0.0.15058"
  };
}

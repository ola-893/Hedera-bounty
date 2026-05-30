import { Client, PrivateKey } from "@hiero-ledger/sdk";
import { AgentMode, type Plugin } from "@hashgraph/hedera-agent-kit";
import { HederaLangchainToolkit } from "@hashgraph/hedera-agent-kit-langchain";
import {
  coreAccountQueryPlugin,
  coreConsensusQueryPlugin,
  coreEVMQueryPlugin,
  coreMiscQueriesPlugin,
  coreTokenQueryPlugin,
  coreTransactionQueryPlugin
} from "@hashgraph/hedera-agent-kit/plugins";
import {
  saucerswapPlugin as hakSaucerswapPlugin,
  saucerswapPluginToolNames
} from "hak-saucerswap-plugin";
import { pythPlugin } from "hak-pyth-plugin";
import coincapPlugin from "coincap-hedera-plugin";
import chainlinkPlugin from "chainlink-pricefeed-plugin";

const CoinCapHederaPlugin = coincapPlugin as any;
const { ChainlinkPriceFeedPlugin } = chainlinkPlugin as any;

import type { TradingPolicyEngine } from "../../trading/src/policies";

export interface AgentRuntimeInfo {
  mode: "return_bytes";
  agentKitAvailable: boolean;
  langchainAvailable: boolean;
  enabledPlugins: string[];
  disabledPlugins: Array<{ name: string; reason: string }>;
  note: string;
}

const SAFE_SAUCERSWAP_TOOL_METHODS = [
  saucerswapPluginToolNames.SAUCERSWAP_GET_SWAP_QUOTE_TOOL,
  saucerswapPluginToolNames.SAUCERSWAP_SWAP_TOKENS_TOOL
] as const;

const DISABLED_PLUGIN_NOTES = [
  {
    name: "saucer-swap-plugin",
    reason: "Installed for bounty visibility, but v0.2.0 currently fails to import in Node ESM because published dist files reference missing extensionless paths."
  },
  {
    name: "@bonzofinancelabs/hak-bonzo-plugin",
    reason: "v3-compatible plugin; excluded from the v4 Agent Kit runtime until hooks/policies support is validated."
  },
  {
    name: "hak-mppx-hedera-plugin",
    reason: "USDC payment tooling is side-effectful and remains disabled by default for this non-custodial trading MVP."
  },
  {
    name: "@buidlerlabs/hak-memejob-plugin",
    reason: "Meme-token creation/trading is outside the safe default trading wallet scope."
  }
] as const;

export function createSafeAgentPlugins(): Plugin[] {
  return [
    coreAccountQueryPlugin,
    coreConsensusQueryPlugin,
    coreEVMQueryPlugin,
    coreMiscQueriesPlugin,
    coreTokenQueryPlugin,
    coreTransactionQueryPlugin,
    filterPluginTools(hakSaucerswapPlugin, SAFE_SAUCERSWAP_TOOL_METHODS),
    pythPlugin,
    CoinCapHederaPlugin,
    ChainlinkPriceFeedPlugin
  ];
}

export async function createHederaAgentToolkit(
  accountId: string,
  privateKey: string,
  network: "mainnet" | "testnet" | "previewnet"
): Promise<HederaLangchainToolkit> {
  const client = network === "mainnet" 
    ? Client.forMainnet() 
    : network === "previewnet" 
      ? Client.forPreviewnet() 
      : Client.forTestnet();

  client.setOperator(accountId, PrivateKey.fromString(privateKey));

  return new HederaLangchainToolkit({
    client,
    configuration: {
      context: { mode: AgentMode.RETURN_BYTES, accountId },
      plugins: createSafeAgentPlugins()
    }
  });
}

export async function inspectHederaAgentRuntime(_policyEngine: TradingPolicyEngine): Promise<AgentRuntimeInfo> {
  const [agentKit, langchain] = await Promise.all([
    import("@hashgraph/hedera-agent-kit").then(() => true).catch(() => false),
    import("@hashgraph/hedera-agent-kit-langchain").then(() => true).catch(() => false)
  ]);

  return {
    mode: "return_bytes",
    agentKitAvailable: agentKit,
    langchainAvailable: langchain,
    enabledPlugins: createSafeAgentPlugins().map((plugin) => plugin.name),
    disabledPlugins: DISABLED_PLUGIN_NOTES.map((plugin) => ({ ...plugin })),
    note: "Trading execution is constrained to RETURN_BYTES-style wallet approval. The API never signs user trades."
  };
}

function filterPluginTools(plugin: Plugin, allowedMethods: readonly string[]): Plugin {
  const allowed = new Set<string>(allowedMethods);
  return {
    ...plugin,
    tools: (context) => plugin.tools(context).filter((tool) => allowed.has(tool.method))
  };
}


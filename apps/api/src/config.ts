import "dotenv/config";
import { loadPolicyConfig } from "../../../packages/trading/src/policies";
import { createHederaNetworkConfig } from "../../../packages/hedera/src/network";
import { Client, PrivateKey } from "@hiero-ledger/sdk";

export async function createApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const policy = await loadPolicyConfig(env);
  const hedera = createHederaNetworkConfig(env);

  let client: Client | undefined;
  if (env.HEDERA_OPERATOR_ACCOUNT_ID && env.HEDERA_OPERATOR_PRIVATE_KEY) {
    client = hedera.network === "mainnet" 
      ? Client.forMainnet() 
      : hedera.network === "previewnet" 
        ? Client.forPreviewnet() 
        : Client.forTestnet();
    client.setOperator(env.HEDERA_OPERATOR_ACCOUNT_ID, PrivateKey.fromString(env.HEDERA_OPERATOR_PRIVATE_KEY));
  }

  return {
    port: Number.parseInt(env.PORT ?? "3001", 10),
    databaseUrl: env.DATABASE_URL ?? ".data/trading-agent.sqlite",
    policy,
    hedera,
    client,
    hcsAuditTopicId: env.HCS_AUDIT_TOPIC_ID,
    frontendOrigin: env.FRONTEND_ORIGIN,
    liveQuotes: env.SAUCERSWAP_LIVE_QUOTES === "true",
    allowDemoFallback: env.SAUCERSWAP_ALLOW_DEMO_FALLBACK !== "false",
    poolFee: Number.parseInt(env.SAUCERSWAP_POOL_FEE ?? "3000", 10),
    demoTransactionBytes: env.DEMO_TRANSACTION_BYTES === "true"
  };
}

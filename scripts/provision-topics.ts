import "dotenv/config";
import { Client, PrivateKey } from "@hiero-ledger/sdk";
import { createHcsTopic, submitHcsMessage } from "../packages/hedera/src/hcs";
import { createDefaultPolicyConfig } from "../packages/trading/src/policies";

async function main() {
  const accountId = process.env.HEDERA_OPERATOR_ACCOUNT_ID;
  const privateKeyStr = process.env.HEDERA_OPERATOR_PRIVATE_KEY;
  const network = process.env.HEDERA_NETWORK ?? "testnet";

  if (!accountId || !privateKeyStr) {
    console.error("Missing HEDERA_OPERATOR_ACCOUNT_ID or HEDERA_OPERATOR_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const privateKey = PrivateKey.fromString(privateKeyStr);
  const client = network === "mainnet" 
    ? Client.forMainnet() 
    : network === "previewnet" 
      ? Client.forPreviewnet() 
      : Client.forTestnet();

  client.setOperator(accountId, privateKey);

  console.log(`Connected to Hedera ${network} with operator ${accountId}`);
  console.log("Creating HCS topics...");

  try {
    const auditTopicId = await createHcsTopic(client, privateKey, undefined, "Hedera Trading Wallet Agent - Audit Log");
    console.log(`✅ Audit Log Topic created: ${auditTopicId}`);

    const policyTopicId = await createHcsTopic(client, privateKey, privateKey, "Hedera Trading Wallet Agent - Policies");
    console.log(`✅ Policy Topic created: ${policyTopicId}`);

    console.log("Publishing initial default policies to Policy Topic...");
    const defaultPolicy = createDefaultPolicyConfig();
    // Exclude network and enableMainnet from being overridden easily via topic payload
    const { network: _net, enableMainnet: _main, ...policyPayload } = defaultPolicy;
    
    await submitHcsMessage(policyTopicId, policyPayload, client);
    console.log(`✅ Initial policies published to ${policyTopicId}`);

    console.log("\n============================================");
    console.log("Add the following to your .env file:");
    console.log("============================================");
    console.log(`HCS_AUDIT_TOPIC_ID=${auditTopicId}`);
    console.log(`HCS_POLICY_TOPIC_ID=${policyTopicId}`);
    console.log("============================================");
    
  } catch (error) {
    console.error("Failed to provision topics:", error);
    process.exit(1);
  }
}

main().catch(console.error);

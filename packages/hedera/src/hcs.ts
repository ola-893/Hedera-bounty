import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Client,
  PrivateKey
} from "@hiero-ledger/sdk";

export async function submitHcsMessage(topicId: string, payload: unknown, client: Client): Promise<string> {
  const message = typeof payload === "string" ? payload : JSON.stringify(payload);
  
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .execute(client);
    
  const receipt = await tx.getReceipt(client);
  return receipt.topicSequenceNumber!.toString();
}

export async function createHcsTopic(
  client: Client,
  adminKey?: PrivateKey,
  submitKey?: PrivateKey,
  memo?: string
): Promise<string> {
  let tx = new TopicCreateTransaction();
  
  if (adminKey) {
    tx = tx.setAdminKey(adminKey.publicKey);
  }
  
  if (submitKey) {
    tx = tx.setSubmitKey(submitKey.publicKey);
  }
  
  if (memo) {
    tx = tx.setTopicMemo(memo);
  }
  
  // If we set an admin key, we need to sign the transaction with it (in addition to the operator)
  if (adminKey) {
    tx.freezeWith(client);
    tx = await tx.sign(adminKey);
  }
  
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  
  return receipt.topicId!.toString();
}

/**
 * Helper to fetch the latest message from an HCS topic via Mirror Node REST API.
 * This is synchronous-like (one REST call) compared to subscribing via SDK.
 */
export async function fetchLatestHcsMessage(topicId: string, network: "mainnet" | "testnet" | "previewnet"): Promise<string | undefined> {
  const mirrorNodeUrl = `https://${network}.mirrornode.hedera.com`;
  
  try {
    const response = await fetch(`${mirrorNodeUrl}/api/v1/topics/${topicId}/messages?limit=1&order=desc`);
    if (!response.ok) {
      if (response.status === 404) return undefined;
      throw new Error(`Mirror Node returned ${response.status}`);
    }
    
    const data = await response.json() as { messages?: Array<{ message: string }> };
    const firstMessage = data.messages?.[0];
    if (firstMessage) {
      // Decode base64 message
      return Buffer.from(firstMessage.message, "base64").toString("utf8");
    }
    
    return undefined;
  } catch (err) {
    console.error(`Failed to fetch HCS topic ${topicId}:`, err);
    return undefined;
  }
}

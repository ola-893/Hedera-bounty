# Frontend Integration Guide: Hedera Trading Wallet Agent

This guide outlines how to integrate the frontend with the Trading Wallet Agent backend. The architecture is designed for **non-custodial safety**: the agent formulates trades, but the user's wallet (e.g., HashPack, WalletConnect) always signs the final transaction.

---

## 🏗️ High-Level Flow

1. **Connect Wallet:** The user connects their Hedera wallet to the frontend.
2. **Chat Input:** The user types an intent (e.g., *"Swap 10 HBAR for SAUCE"*).
3. **Parse Intent:** The frontend sends the chat to the Agent API, which parses it into structured trade parameters.
4. **Get Quote:** The frontend requests a trade quote from the API (via SaucerSwap).
5. **Confirm:** The frontend displays the quote to the user.
6. **Propose:** The frontend asks the API to build the final Hedera transaction bytes.
7. **Sign & Submit:** The frontend passes the bytes to the user's wallet to sign and submit to the network.
8. **Record:** The frontend notifies the API of the resulting Transaction ID.

---

## 📡 API Endpoints & Implementation Guide

Base URL: `http://localhost:3001` (or your deployed backend URL).

### 1. Fetching Portfolio (Optional but recommended)
Retrieve the user's current token balances to display in the UI.

**`GET /api/portfolio/:accountId`**

```javascript
const res = await fetch(`/api/portfolio/0.0.1234`);
const portfolio = await res.json();
// Returns: { accountId, hbarBalance, tokens: [...], recentTransactions: [...] }
```

### 2. Processing Chat Input
Send the user's natural language input to the agent.

**`POST /api/agent/chat`**
```json
// Request Body
{
  "accountId": "0.0.1234",
  "message": "swap 50 HBAR to SAUCE"
}
```
**Response:**
```json
{
  "response": "I can help with that. Are you ready to proceed with the swap?",
  "action": "trade",
  "params": {
    "tokenIn": "HBAR",
    "tokenOut": "SAUCE",
    "amountIn": "50"
  }
}
```
*Frontend Action:* If `action === "trade"`, proceed immediately to step 3 using the returned `params`.

### 3. Requesting a Quote
Fetch a price quote for the parsed trade. This applies backend safety policies (like max slippage and allowed tokens).

**`POST /api/trades/quote`**
```json
// Request Body
{
  "accountId": "0.0.1234",
  "tokenIn": "HBAR",       // From agent params
  "tokenOut": "SAUCE",     // From agent params
  "amountIn": "50",        // From agent params
  "slippageBps": 100       // Optional: Defaults to backend config if omitted
}
```
**Response:**
```json
{
  "id": "quote_123456...", // Save this ID
  "status": "quoted",      // Or "blocked" if it violates safety policies
  "amountOut": "4500.5",
  "priceImpact": 0.05,
  "policy": { "allowed": true }
}
```
*Frontend Action:* Display the `amountOut` and `priceImpact` to the user and ask for confirmation.

### 4. Creating a Proposal (Building the Transaction)
Once the user clicks "Confirm", ask the backend to build the raw Hedera transaction.

**`POST /api/trades/propose`**
```json
// Request Body
{
  "accountId": "0.0.1234",
  "quoteId": "quote_123456..." // Passed from step 3
}
```
**Response:**
```json
{
  "proposalId": "proposal_789...", // Save this ID
  "status": "proposed",
  "transactionBytes": "ChYKFAoMCIDv5rEGEICy..." // Base64 encoded Hedera transaction
}
```

### 5. Signing via Wallet (Crucial Step)
The frontend must decode the `transactionBytes` and pass it to the user's wallet provider.

**Example using `@hashgraph/sdk` and `HashConnect`:**
```javascript
import { Transaction } from "@hashgraph/sdk";

// 1. Decode the base64 string from the backend
const txBytes = Buffer.from(proposal.transactionBytes, 'base64');

// 2. Deserialize into a Hedera Transaction object
const transaction = Transaction.fromBytes(txBytes);

// 3. Send to wallet for signing and execution
const result = await hashConnect.sendTransaction(
  topic, 
  {
    topic: topic,
    byteArray: transaction.toBytes(),
    metadata: {
      accountToSign: "0.0.1234",
      returnTransaction: false // Set true if you want to submit it yourself
    }
  }
);

// Get the resulting transaction ID
const transactionId = result.response.transactionId;
```

### 6. Recording Completion
Inform the backend that the user signed the transaction. This updates the backend's database and pushes the final state to the immutable **Hedera Consensus Service (HCS)** audit log.

**`POST /api/trades/:proposalId/complete`**
```json
// Request Body
{
  "status": "submitted",
  "transactionId": "0.0.1234@1770000000.000000001"
}
```
*(Note: If the user rejects the wallet popup, send `"status": "wallet_rejected"` instead).*

### 7. Checking Final Status
You can optionally poll this endpoint while waiting for the network to reach consensus.

**`GET /api/trades/:proposalId/status`**
Returns the proposal object. If the status is `confirmed` or `failed`, the backend has successfully verified the transaction on the Hedera mirror node.

### 8. Displaying the Audit Trail (Optional)
To display a "Recent Agent Activity" feed in the UI, fetch the audit events.

**`GET /api/audit/events?limit=20`**
Returns an array of events (quotes, blocks, approvals, submissions) that correspond directly to the messages stored on the Hedera Consensus Service.

---

## 🛡️ Error Handling & Edge Cases

- **Blocked Quotes:** If a user tries to trade a token not allowed by the policy, or exceeds demo limits, the Quote endpoint will return `status: "blocked"`. The frontend should display a polite error message to the user.
- **Expired Quotes:** Quotes have a TTL (default 60 seconds). If the user takes too long to sign, the backend may reject the completion.
- **Demo Mode:** If the `.env` has `DEMO_TRANSACTION_BYTES=true`, the backend will return a dummy `CryptoTransfer` transaction for safe UI testing without interacting with the real SaucerSwap contracts.

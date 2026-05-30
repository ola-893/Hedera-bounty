# Hedera Trading Wallet Agent

Welcome to the **Hedera Trading Wallet Agent**! This project is a fully-featured, guarded trading agent built for the Hedera ecosystem. It features an AI chat interface that understands trading intents, enforces strict safety policies, securely fetches swap quotes (via SaucerSwap), and prepares transactions for your wallet to sign.

**Crucial Safety Feature:** The backend *never* stores user private keys and *never* autonomously moves funds. It reads wallet state, parses trading intent, fetches quotes, enforces safety policies, and then sends signable transaction bytes back to the frontend for the user's explicit wallet approval.

---

## 🚀 Quick Start

Getting everything up and running is incredibly easy. You do **not** need a separate SQL database server or Docker to test this application—it uses an embedded, lightning-fast SQLite database (`.sqlite` file) natively.

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   ```bash
   cp .env.example .env
   ```
   *(Fill in your Hedera credentials and WalletConnect Project ID inside the `.env` file.)*

3. **Initialize the Database**
   ```bash
   npm run db:init
   ```

4. **Start the Application**
   Use the provided start script to launch both the backend API and the frontend UI concurrently:
   ```bash
   ./start.sh
   ```
   * The Frontend will be available at: `http://localhost:5173`
   * The Backend API will be available at: `http://localhost:3001`

*(Optional)* **Provision HCS Topics for On-Chain Logging**
If you want to use the Hedera Consensus Service (HCS) for on-chain audit trails, run:
```bash
npx tsx scripts/provision-topics.ts
```
Then copy the generated topic IDs into your `.env` file and restart the server.

---

## 🛠 Project Architecture

The architecture consists of a React/Vite frontend and a Node.js Fastify backend.

### Frontend
- Located in `apps/web`.
- Features a chat interface to interact with the AI agent.
- Connects directly to HashPack and MetaMask wallets.
- Receives encoded transaction bytes from the backend and securely prompts your wallet to sign them.

### Backend
- Located in `apps/api` and `packages/`.
- Uses an embedded `SQLite` database (via `better-sqlite3`) to store quotes, proposals, and audit logs.
- Uses AI to parse your trading intent from chat.
- Communicates with the Hedera Mirror Node.
- Pulls live quotes from SaucerSwap.
- Validates trades against safety policies (e.g., maximum slippage limits).

---

## 🛡 Safety Defaults & Policies

To ensure safety during testing, the following rules are strictly enforced by the backend policy engine:

- **Network**: Testnet is the default network. Mainnet is actively blocked unless `ENABLE_MAINNET=true` is set.
- **Allowed Assets**: Only specifically whitelisted tokens can be traded.
- **Slippage limit**: Slippage defaults to `100` basis points (1%). Trades exceeding this are blocked.
- **Quote Expiry**: Quotes expire strictly after `60` seconds.
- **Strict Recipient Matching**: Proposal recipients *must* mathematically match the connected wallet account asking for the trade.
- **Zero Signing**: The backend literally cannot sign. Swap bytes are passed to the frontend and verified natively by the wallet.

---

## 📡 API Reference

If you want to test the backend API directly via `curl` or Postman, the base URL is `http://localhost:3001`. 
*Note: A full OpenAPI spec is available at `GET /api/docs/openapi.json`.*

### 1. Health & Portfolio
- **`GET /api/health`**
  Returns service status, Hedera network, mainnet toggle, and live quote mode.
- **`GET /api/portfolio/:accountId`**
  Reads HBAR balance, token balances, token metadata, and recent transactions.

### 2. Trading Flow
- **`POST /api/agent/chat`**
  Send a message (e.g., `"swap 10 HBAR to SAUCE"`). Returns a structured trading intent.
- **`POST /api/trades/quote`**
  Get a quote from SaucerSwap. Returns route, expiry, policy verdict, and `quoteId`.
- **`POST /api/trades/propose`**
  Convert a `quoteId` into a `proposalId` containing signable transaction bytes.
- **`POST /api/trades/:proposalId/complete`**
  Update the proposal status after the user signs (or rejects) the transaction in their wallet.
- **`GET /api/trades/:proposalId/status`**
  Verify the final transaction status against the Hedera Mirror Node.

### 3. Auditing & Strategies
- **`POST /api/strategies/evaluate`**
  Evaluate a background strategy. Triggered strategies create proposals but do not execute them.
- **`GET /api/audit/events?limit=50`**
  Retrieve a log of audit events for intents, blocks, proposals, and executions.

---

## 💡 Tester Workflow (How to Test)

1. Boot up the app via `./start.sh`.
2. Open `http://localhost:5173` in your browser.
3. Click **"Connect HashPack"** and approve the connection in your wallet.
4. In the chat box, type a command like:
   > *"I want to swap 10 HBAR for SAUCE"*
5. The agent will read your intent, fetch a quote, and present an **"Active Quote"**.
6. Click **"Create Proposal"**. The backend will verify safety policies and return Hedera transaction bytes.
7. Click **"Sign & Submit"**. This triggers your HashPack wallet extension to pop up asking for approval.
8. Approve the transaction in HashPack.
9. Click **"Check Status"** to verify the on-chain execution, or check the **"Audit Log"** button in the top right to view the trail of events!

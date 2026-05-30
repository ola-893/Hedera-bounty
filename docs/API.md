# Backend API Contract

Base URL: `http://localhost:3001`

## Health

`GET /api/health`

Returns service status, Hedera network, mainnet toggle, and live quote mode.

## Portfolio

`GET /api/portfolio/:accountId`

Reads HBAR balance, token balances, token metadata, and recent transactions through Hedera Mirror Node.

## Agent Chat

`POST /api/agent/chat`

```json
{
  "accountId": "0.0.1234",
  "message": "swap 10 HBAR to SAUCE"
}
```

Returns a deterministic trading intent when one is detected. Chat never executes a trade.

## Quote

`POST /api/trades/quote`

```json
{
  "accountId": "0.0.1234",
  "tokenIn": "HBAR",
  "tokenOut": "SAUCE",
  "amountIn": "1",
  "slippageBps": 100
}
```

Returns quote details, route, expiry, quote hash, and policy verdict. Blocked quotes are stored with status `blocked`.

## Propose

`POST /api/trades/propose`

```json
{
  "quoteId": "quote_uuid",
  "accountId": "0.0.1234"
}
```

Returns `proposalId`, signable transaction bytes, approval summary, expiry, and quote hash. The frontend should send the bytes to the wallet for user approval.

## Complete

`POST /api/trades/:proposalId/complete`

```json
{
  "status": "submitted",
  "transactionId": "0.0.1234@1770000000.000000001"
}
```

Use `wallet_rejected` when the user rejects the wallet approval.

## Status

`GET /api/trades/:proposalId/status`

Returns current proposal status and verifies submitted transactions against Mirror Node when a transaction id exists.

## Strategy Evaluate

`POST /api/strategies/evaluate`

```json
{
  "accountId": "0.0.1234",
  "tokenIn": "HBAR",
  "tokenOut": "SAUCE",
  "amountIn": "1",
  "slippageBps": 100,
  "condition": {
    "type": "minAmountOut",
    "minAmountOut": "100"
  }
}
```

Triggered strategies create wallet-approval proposals. They do not submit or sign transactions.

## Audit

`GET /api/audit/events?limit=50`

Returns local audit events for intents, quote creation, policy blocks, proposals, submissions, and confirmations.

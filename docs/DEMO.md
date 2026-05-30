# Demo Script

1. Start the backend.

```bash
cp .env.example .env
# Fill in HEDERA_OPERATOR_ACCOUNT_ID and HEDERA_OPERATOR_PRIVATE_KEY in .env
npm run db:init
npm run dev
```

1b. *(Optional but recommended)* Provision HCS topics for on-chain audit logging.

```bash
npx tsx scripts/provision-topics.ts
# Copy the output topic IDs into your .env file, then restart the server
```

2. Ask the agent for a trade.

```bash
curl -s http://localhost:3001/api/agent/chat \
  -H 'content-type: application/json' \
  -d '{"accountId":"0.0.1234","message":"swap 1 HBAR to SAUCE"}'
```

3. Request a quote.

```bash
curl -s http://localhost:3001/api/trades/quote \
  -H 'content-type: application/json' \
  -d '{"accountId":"0.0.1234","tokenIn":"HBAR","tokenOut":"SAUCE","amountIn":"1","slippageBps":100}'
```

4. Create a proposal with the returned `quoteId`.

```bash
curl -s http://localhost:3001/api/trades/propose \
  -H 'content-type: application/json' \
  -d '{"accountId":"0.0.1234","quoteId":"quote_from_step_3"}'
```

5. The frontend sends `transactionBytes` to the user's wallet for signing.

6. Post the submitted transaction id.

```bash
curl -s http://localhost:3001/api/trades/proposal_from_step_4/complete \
  -H 'content-type: application/json' \
  -d '{"status":"submitted","transactionId":"0.0.1234@1770000000.000000001"}'
```

7. Check status and audit events.

```bash
curl -s http://localhost:3001/api/trades/proposal_from_step_4/status
curl -s http://localhost:3001/api/audit/events
```

Safety proof for judges: try a blocked trade with `slippageBps` above `100`, an unknown token, or an amount above the configured demo cap.

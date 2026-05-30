# Bounty Submission Notes

## Project Description

Guarded Hedera trading wallet agent that reads portfolio state, understands trade intent, fetches SaucerSwap quotes, enforces explicit policy limits, and returns signable transaction bytes for wallet approval.

## Implementation Details

- Built with TypeScript, Fastify, Zod, SQLite, Hedera Agent Kit dependencies, and a SaucerSwap plugin integration point.
- Uses a policy-first backend flow: chat intent, quote, policy verdict, proposal, wallet approval, transaction tracking.
- Defaults to Hedera testnet and blocks mainnet unless explicitly enabled.
- Does not store private keys or custody user funds.
- Keeps local audit records for every material backend decision.

## Safety Highlights

- Explicit wallet approval is required before funds move.
- Mainnet is disabled by default.
- Allowed-token, max trade, slippage, quote freshness, recipient, approval, allowlist, and denylist policies are enforced before proposal creation.
- Strategy mode is signal/proposal only; it never signs or submits trades.

## Feedback Link

Add the required Hedera tool feedback link here before submitting:

`TODO: https://github.com/hashgraph/hedera-agent-kit-js/issues/...`

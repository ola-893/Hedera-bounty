import type { PortfolioResponse } from "../../shared/src/schemas";

export interface TransactionLookupResult {
  status: "submitted" | "confirmed" | "failed";
  result?: string;
}

export class MirrorNodeClient {
  constructor(private readonly baseUrl: string) {}

  async getPortfolio(accountId: string): Promise<PortfolioResponse> {
    const [account, tokens, transactions] = await Promise.all([
      this.safeGetJson<MirrorAccount>(`/api/v1/accounts/${accountId}`, {}),
      this.safeGetJson<MirrorAccountTokens>(`/api/v1/accounts/${accountId}/tokens?limit=100`, { tokens: [] }),
      this.safeGetJson<MirrorTransactions>(`/api/v1/accounts/${accountId}/transactions?limit=10&order=desc`, { transactions: [] })
    ]);

    const tokenRows = await Promise.all(
      (tokens.tokens ?? []).map(async (token) => {
        const metadata = await this.safeGetJson<MirrorToken>(`/api/v1/tokens/${token.token_id}`, {});
        const decimals = Number(metadata.decimals ?? token.decimals ?? 0);
        return {
          tokenId: token.token_id,
          symbol: metadata.symbol ?? token.token_id,
          name: metadata.name,
          balance: formatTokenBalance(token.balance, decimals),
          decimals,
          balanceSource: "mirror" as const
        };
      })
    );

    return {
      accountId,
      hbarBalance: formatHbarBalance(account.balance?.balance ?? 0),
      tokens: tokenRows,
      recentTransactions: (transactions.transactions ?? []).map((transaction) => ({
        transactionId: transaction.transaction_id,
        consensusTimestamp: transaction.consensus_timestamp,
        result: transaction.result,
        type: transaction.name
      }))
    };
  }

  async getTransactionStatus(transactionId: string): Promise<TransactionLookupResult> {
    try {
      const mirrorTransactionId = toMirrorTransactionId(transactionId);
      const result = await this.getJson<MirrorTransactions>(`/api/v1/transactions/${encodeURIComponent(mirrorTransactionId)}`);
      const first = result.transactions?.[0];
      if (!first) return { status: "submitted" };
      if (first.result === "SUCCESS") return { status: "confirmed", result: first.result };
      return {
        status: "failed",
        ...(first.result ? { result: first.result } : {})
      };
    } catch {
      return { status: "submitted" };
    }
  }

  async postContractCall<T>(body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/v1/contracts/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Mirror Node contract call failed: ${response.status} ${await response.text()}`);
    }

    return await response.json() as T;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`Mirror Node request failed: ${response.status} ${await response.text()}`);
    }
    return await response.json() as T;
  }

  private async safeGetJson<T>(path: string, fallback: T): Promise<T> {
    try {
      return await this.getJson<T>(path);
    } catch (error) {
      console.warn(`Mirror Node request failed for ${path}:`, error);
      return fallback;
    }
  }
}

interface MirrorAccount {
  balance?: {
    balance?: number;
  };
}

interface MirrorAccountTokens {
  tokens?: Array<{
    token_id: string;
    balance: number;
    decimals?: string;
  }>;
}

interface MirrorToken {
  symbol?: string;
  name?: string;
  decimals?: string;
}

interface MirrorTransactions {
  transactions?: Array<{
    transaction_id: string;
    consensus_timestamp?: string;
    result?: string;
    name?: string;
  }>;
}

function formatHbarBalance(tinybars: number): string {
  return formatFixed(BigInt(tinybars), 8);
}

function formatTokenBalance(balance: number, decimals: number): string {
  return formatFixed(BigInt(balance), decimals);
}

function formatFixed(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n || decimals === 0) return whole.toString();
  return `${whole.toString()}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

function toMirrorTransactionId(transactionId: string): string {
  const match = transactionId.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/);
  if (!match) return transactionId;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export interface TradingIntent {
  type: "quote_request";
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  confidence: number;
}

const SWAP_PATTERNS = [
  /\b(?:swap|trade|convert)\s+(\d+(?:\.\d+)?)\s+([a-zA-Z0-9.]+)\s+(?:to|for|into)\s+([a-zA-Z0-9.]+)/i,
  /\b(?:buy)\s+([a-zA-Z0-9.]+)\s+(?:with|using)\s+(\d+(?:\.\d+)?)\s+([a-zA-Z0-9.]+)/i,
  /\b(?:sell)\s+(\d+(?:\.\d+)?)\s+([a-zA-Z0-9.]+)\s+(?:for|into)\s+([a-zA-Z0-9.]+)/i
];

export function parseTradingIntent(message: string): TradingIntent | undefined {
  const trimmed = message.trim();

  const swap = SWAP_PATTERNS[0]?.exec(trimmed);
  if (swap) {
    return {
      type: "quote_request",
      amountIn: swap[1] ?? "0",
      tokenIn: normalizeSymbol(swap[2] ?? ""),
      tokenOut: normalizeSymbol(swap[3] ?? ""),
      confidence: 0.92
    };
  }

  const buy = SWAP_PATTERNS[1]?.exec(trimmed);
  if (buy) {
    return {
      type: "quote_request",
      amountIn: buy[2] ?? "0",
      tokenIn: normalizeSymbol(buy[3] ?? ""),
      tokenOut: normalizeSymbol(buy[1] ?? ""),
      confidence: 0.84
    };
  }

  const sell = SWAP_PATTERNS[2]?.exec(trimmed);
  if (sell) {
    return {
      type: "quote_request",
      amountIn: sell[1] ?? "0",
      tokenIn: normalizeSymbol(sell[2] ?? ""),
      tokenOut: normalizeSymbol(sell[3] ?? ""),
      confidence: 0.84
    };
  }

  return undefined;
}

function normalizeSymbol(value: string): string {
  return value.trim().replace(/[.,!?;:]+$/, "").toUpperCase();
}

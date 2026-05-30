import type { AgentChatRequest, AgentChatResponse } from "../../shared/src/schemas";
import { parseTradingIntent } from "../../trading/src/intentParser";

export async function handleAgentChat(request: AgentChatRequest): Promise<AgentChatResponse> {
  const intent = parseTradingIntent(request.message);
  const safetyNotes = [
    "I can prepare quotes and proposals, but wallet approval is required before funds move.",
    "This is not financial advice."
  ];

  if (!intent) {
    return {
      response: "I can help review portfolio state, prepare SaucerSwap quotes, and draft wallet-approved trade proposals. Try asking for a quote like: swap 10 HBAR to SAUCE.",
      safetyNotes
    };
  }

  return {
    response: `I found a trade intent: swap ${intent.amountIn} ${intent.tokenIn} to ${intent.tokenOut}. I can request a quote, then prepare signable transaction bytes only after policy checks pass.`,
    action: intent,
    safetyNotes
  };
}

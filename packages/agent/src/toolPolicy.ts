import { TradingPolicyEngine } from "../../trading/src/policies";
import type { PolicyVerdict } from "../../trading/src/types";

export const allowedAgentTools = [
  "account_query",
  "token_query",
  "saucerswap_quote",
  "saucerswap_swap"
] as const;

export const deniedAgentTools = [
  "account_delete",
  "transfer",
  "token_mint",
  "token_freeze",
  "contract_execute",
  "evm_call"
] as const;

export function assertAgentToolInvocation(
  policyEngine: TradingPolicyEngine,
  toolName: string,
  input: Record<string, unknown>
): PolicyVerdict {
  return policyEngine.evaluateToolInvocation(toolName, input);
}

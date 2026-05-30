import test from "node:test";
import assert from "node:assert/strict";
import { createSafeAgentPlugins } from "../packages/agent/src/agentKit";
import { assertAgentToolInvocation } from "../packages/agent/src/toolPolicy";
import { TradingPolicyEngine, createDefaultPolicyConfig } from "../packages/trading/src/policies";

test("agent kit runtime exposes explicit non-empty safe plugins", () => {
  const plugins = createSafeAgentPlugins();
  const pluginNames = plugins.map((plugin) => plugin.name);

  assert.ok(plugins.length > 0);
  assert.ok(pluginNames.includes("core-account-query-plugin"));
  assert.ok(pluginNames.includes("core-token-query-plugin"));
  assert.ok(pluginNames.includes("saucerswap"));

  const saucerSwapTools = plugins
    .find((plugin) => plugin.name === "saucerswap")
    ?.tools({} as never)
    .map((tool) => tool.method);

  assert.deepEqual(saucerSwapTools?.sort(), [
    "saucerswap_get_swap_quote",
    "saucerswap_swap_tokens"
  ]);
});

test("agent cannot call swap tool directly without proposal id", () => {
  const engine = new TradingPolicyEngine(createDefaultPolicyConfig());
  const verdict = assertAgentToolInvocation(engine, "saucerswap_swap", {});

  assert.equal(verdict.allowed, false);
  assert.match(verdict.reasons.join(" "), /proposalId/);
});

test("agent denies destructive tools", () => {
  const engine = new TradingPolicyEngine(createDefaultPolicyConfig());
  const verdict = assertAgentToolInvocation(engine, "account_delete", {});

  assert.equal(verdict.allowed, false);
  assert.match(verdict.reasons.join(" "), /denied/);
});

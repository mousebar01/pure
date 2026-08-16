export interface MobileRunState {
  promptPending: boolean;
  agentActive: boolean;
}

export const IDLE_RUN_STATE: MobileRunState = { promptPending: false, agentActive: false };

export function beginPromptRun(state: MobileRunState = IDLE_RUN_STATE): MobileRunState {
  return { ...state, promptPending: true };
}

export function applyRunEvent(state: MobileRunState, event: "agent_start" | "agent_settled" | "prompt_done"): { state: MobileRunState; settled: boolean } {
  if (event === "agent_start") return { state: { ...state, agentActive: true }, settled: false };
  if (event === "agent_settled") {
    return {
      state: { ...state, agentActive: false },
      settled: state.agentActive && !state.promptPending,
    };
  }
  const next = { ...state, promptPending: false };
  return { state: next, settled: !next.agentActive };
}

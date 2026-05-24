export type AgentMode = 'plan' | 'build';

export function isAgentMode(value: string): value is AgentMode {
  return value === 'plan' || value === 'build';
}
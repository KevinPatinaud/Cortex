export type McpConnectionEngine = "codex" | "claude" | "copilot";

export type McpConnectionScope = "user" | "project" | "local";

export type McpConnectionTransport = "stdio" | "http" | "sse";

export interface McpConnectionSummary {
  id: string;
  name: string;
  transport: McpConnectionTransport;
  endpoint: string;
  source: McpConnectionEngine | "shared";
  scope: McpConnectionScope;
  configurationFile: string;
  configuredFor: McpConnectionEngine[];
  compatibleEngines: McpConnectionEngine[];
  hasAuthentication: boolean;
}

export interface McpDiscoveryIssue {
  source: McpConnectionEngine | "shared";
  configurationFile: string;
  message: string;
}

export interface McpDiscoveryResult {
  connections: McpConnectionSummary[];
  issues: McpDiscoveryIssue[];
}

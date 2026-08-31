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
  manageable: boolean;
}

export interface McpMachineConnectionDetail {
  engine: McpConnectionEngine;
  name: string;
  transport: McpConnectionTransport;
  command: string;
  args: string[];
  url: string;
  environmentKeys: string[];
  headerNames: string[];
}

export interface McpMachineConnectionInput {
  engine?: unknown;
  name?: unknown;
  transport?: unknown;
  command?: unknown;
  args?: unknown;
  url?: unknown;
  environment?: unknown;
  headers?: unknown;
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

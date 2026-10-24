export interface CodexModel {
  model: string;
  displayName: string;
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  isDefault: boolean;
}

export interface CodexModelCatalog {
  declaredApps?: string[];
  configuredReasoningEffort?: string | null;
  availableSkills?: string[];
  declaredMcpServers?: string[];
  available: boolean;
  cliVersion: string | null;
  defaultModel: string | null;
  models: CodexModel[];
  checkedAt: string;
  error: string | null;
}

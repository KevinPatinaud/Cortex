export type CodexPluginAuthPolicy = "ON_INSTALL" | "ON_USE" | "NONE";

export interface CodexPluginSummary {
  id: string;
  name: string;
  marketplace: string;
  version: string | null;
  installed: boolean;
  enabled: boolean;
  authPolicy: CodexPluginAuthPolicy | null;
  installPolicy: string | null;
}

export interface CodexPluginCatalog {
  available: boolean;
  plugins: CodexPluginSummary[];
  error: string | null;
}

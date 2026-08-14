import path from "node:path";
import { parse } from "smol-toml";
import { ValidationError } from "../../error/ValidationError.ts";
import type { AgentDefinition } from "../../usecase/AgentUseCase.ts";
import type { ProjectContentOutput } from "../../usecase/ProjectUseCase.ts";

type ProjectDirectory = ProjectContentOutput["root"];
type ProjectEntry = ProjectDirectory["children"][number];
type ProjectFile = Extract<ProjectEntry, { type: "file" }>;

interface RegisteredCodexAgent {
  name: string;
  description: string;
}

export function toCodexAgentDefinitions(
  codexDirectory: ProjectDirectory
): AgentDefinition[] {
  const agentsDirectory = findChildDirectory(codexDirectory, "agents");

  if (!agentsDirectory) {
    return [];
  }

  const registeredAgents = readRegisteredAgents(codexDirectory);

  return agentsDirectory.children
    .filter((entry): entry is ProjectFile =>
      entry.type === "file" && /\.toml$/i.test(entry.name)
    )
    .map((file) => {
      const contentTomlFile = parseTomlFile(file);
      const registeredAgent = registeredAgents.get(file.relativePath);
      const model = readString(contentTomlFile.model);
      const reasoningEffort = readString(
        contentTomlFile.model_reasoning_effort
      );

      return {
        id: file.relativePath,
        name: readString(contentTomlFile.name) ||
          registeredAgent?.name ||
          file.name.replace(/\.toml$/i, ""),
        description: readString(contentTomlFile.description) ||
          registeredAgent?.description ||
          "",
        nextAgentIds: [],
        inputMode: "separate",
        hasSession: false,
        executionStatus: "idle",
        conversation: [],
        threads: [],
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        prompt: readString(contentTomlFile.developer_instructions) || ""
      };
    });
}

function readRegisteredAgents(
  codexDirectory: ProjectDirectory
): Map<string, RegisteredCodexAgent> {
  const configFile = codexDirectory.children.find(
    (entry): entry is ProjectFile =>
      entry.type === "file" && entry.name.toLowerCase() === "config.toml"
  );

  if (!configFile) {
    return new Map();
  }

  const configuration = parseTomlFile(configFile);
  const agents = readRecord(configuration.agents);
  const registeredAgents = new Map<string, RegisteredCodexAgent>();

  for (const [name, rawAgent] of Object.entries(agents)) {
    const agent = readRecord(rawAgent);
    const configFilePath = readString(agent.config_file);

    if (!configFilePath) {
      continue;
    }

    const relativePath = path.posix.normalize(
      path.posix.join(
        codexDirectory.relativePath,
        configFilePath.replace(/\\/g, "/")
      )
    );

    registeredAgents.set(relativePath, {
      name,
      description: readString(agent.description) || ""
    });
  }

  return registeredAgents;
}

function parseTomlFile(file: ProjectFile): Record<string, unknown> {
  try {
    const content = file.encoding === "base64"
      ? Buffer.from(file.content, "base64").toString("utf8")
      : file.content;

    return parse(content) as Record<string, unknown>;
  } catch {
    throw new ValidationError(
      `The Codex TOML file "${file.relativePath}" is invalid.`
    );
  }
}

function findChildDirectory(
  directory: ProjectDirectory,
  name: string
): ProjectDirectory | null {
  const matchingEntry = directory.children.find(
    (entry) => entry.type === "directory" && entry.name === name
  );

  return matchingEntry?.type === "directory" ? matchingEntry : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

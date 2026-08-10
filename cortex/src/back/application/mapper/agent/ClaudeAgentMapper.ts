import type { AgentDefinition } from "../../usecase/AgentUseCase.ts";
import type { ProjectContentOutput } from "../../usecase/ProjectUseCase.ts";
import { parseMarkdownFrontmatter } from "./MarkdownFrontmatterParser.ts";

type ProjectDirectory = ProjectContentOutput["root"];
type ProjectEntry = ProjectDirectory["children"][number];
type ProjectFile = Extract<ProjectEntry, { type: "file" }>;

export function toClaudeAgentDefinitions(
  claudeDirectory: ProjectDirectory
): AgentDefinition[] {
  const agentsDirectory = findAgentsDirectory(claudeDirectory);

  if (!agentsDirectory) {
    return [];
  }

  return agentsDirectory.children
    .filter((entry): entry is ProjectFile =>
      entry.type === "file" && /\.md$/i.test(entry.name)
    )
    .map(toClaudeAgentDefinition);
}

function toClaudeAgentDefinition(file: ProjectFile): AgentDefinition {
  const markdown = parseMarkdownFrontmatter(decodeFile(file));
  const model = readAttribute(markdown.attributes, "model");
  const reasoningEffort = readAttribute(
    markdown.attributes,
    "effort",
    "reasoning-effort",
    "reasoning_effort"
  );

  return {
    id: file.relativePath,
    name: markdown.attributes.name?.trim() ||
      file.name.replace(/\.md$/i, ""),
    description: markdown.attributes.description?.trim() || "",
    hasSession: false,
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    prompt: markdown.body.trim()
  };
}

function readAttribute(
  attributes: Record<string, string>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attributes[key]?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

function findAgentsDirectory(
  claudeDirectory: ProjectDirectory
): ProjectDirectory | null {
  const agentsDirectory = claudeDirectory.children.find(
    (entry) => entry.type === "directory" && entry.name === "agents"
  );

  return agentsDirectory?.type === "directory" ? agentsDirectory : null;
}

function decodeFile(file: ProjectFile): string {
  return file.encoding === "base64"
    ? Buffer.from(file.content, "base64").toString("utf8")
    : file.content;
}

import type { AgentDefinition } from "../../usecase/AgentUseCase.ts";
import type { ProjectContentOutput } from "../../usecase/ProjectUseCase.ts";
import { parseMarkdownFrontmatter } from "./MarkdownFrontmatterParser.ts";

type ProjectDirectory = ProjectContentOutput["root"];
type ProjectEntry = ProjectDirectory["children"][number];
type ProjectFile = Extract<ProjectEntry, { type: "file" }>;

export function toCopilotAgentDefinitions(
  githubDirectory: ProjectDirectory
): AgentDefinition[] {
  const agentsDirectory = findAgentsDirectory(githubDirectory);

  if (!agentsDirectory) {
    return [];
  }

  return agentsDirectory.children
    .filter((entry): entry is ProjectFile =>
      entry.type === "file" && /\.agent\.md$/i.test(entry.name)
    )
    .map(toCopilotAgentDefinition);
}

function toCopilotAgentDefinition(file: ProjectFile): AgentDefinition {
  const markdown = parseMarkdownFrontmatter(decodeFile(file));

  return {
    name: markdown.attributes.name?.trim() ||
      file.name.replace(/\.agent\.md$/i, ""),
    description: markdown.attributes.description?.trim() || "",
    prompt: markdown.body.trim()
  };
}

function findAgentsDirectory(
  githubDirectory: ProjectDirectory
): ProjectDirectory | null {
  const agentsDirectory = githubDirectory.children.find(
    (entry) => entry.type === "directory" && entry.name === "agents"
  );

  return agentsDirectory?.type === "directory" ? agentsDirectory : null;
}

function decodeFile(file: ProjectFile): string {
  return file.encoding === "base64"
    ? Buffer.from(file.content, "base64").toString("utf8")
    : file.content;
}

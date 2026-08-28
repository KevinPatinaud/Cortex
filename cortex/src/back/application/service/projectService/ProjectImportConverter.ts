import path from "node:path";
import { parse } from "smol-toml";
import { parseMarkdownFrontmatter } from "../../mapper/agent/MarkdownFrontmatterParser.ts";
import type {
  EditableProjectAgent,
  ProjectAgentEngine,
  UploadedProjectFile
} from "./ProjectService.ts";

interface ImportConversionResult {
  files: UploadedProjectFile[];
  sourceEngine: ProjectAgentEngine | null;
  targetEngine: ProjectAgentEngine | null;
  converted: boolean;
}

interface ImportEngineConfiguration {
  rootDirectory: ".codex" | ".claude" | ".github";
  instructionsFileName: "AGENTS.md" | "CLAUDE.md";
  configurationPathPrefix: string;
  agentFilePattern: RegExp;
}

const importEngineConfigurations: Record<
  ProjectAgentEngine,
  ImportEngineConfiguration
> = {
  codex: {
    rootDirectory: ".codex",
    instructionsFileName: "AGENTS.md",
    configurationPathPrefix: ".codex/agents/",
    agentFilePattern: /^\.codex\/agents\/[^/]+\.toml$/i
  },
  claude: {
    rootDirectory: ".claude",
    instructionsFileName: "CLAUDE.md",
    configurationPathPrefix: ".claude/agents/",
    agentFilePattern: /^\.claude\/agents\/[^/]+\.md$/i
  },
  copilot: {
    rootDirectory: ".github",
    instructionsFileName: "AGENTS.md",
    configurationPathPrefix: ".github/agents/",
    agentFilePattern: /^\.github\/agents\/[^/]+\.agent\.md$/i
  }
};

export function prepareImportedProject(
  files: UploadedProjectFile[],
  targetEngine?: ProjectAgentEngine | null
): ImportConversionResult {
  const sourceEngine = detectImportedProjectEngine(files);

  if (!sourceEngine || !targetEngine || sourceEngine === targetEngine) {
    return {
      files,
      sourceEngine,
      targetEngine: targetEngine ?? null,
      converted: false
    };
  }

  const sourceConfiguration = importEngineConfigurations[sourceEngine];
  const targetConfiguration = importEngineConfigurations[targetEngine];
  const instructionsFile = findFile(
    files,
    sourceConfiguration.instructionsFileName
  );

  if (!instructionsFile) {
    throw new TypeError(
      `The imported ${sourceEngine} project does not contain ` +
      `${sourceConfiguration.instructionsFileName}.`
    );
  }

  const agents = readImportedAgents(files, sourceEngine);
  const retainedFiles = files.filter((file) =>
    !isSourceConfigurationFile(file.relativePath, sourceEngine) &&
    file.relativePath.toLowerCase() !==
      sourceConfiguration.instructionsFileName.toLowerCase() &&
    file.relativePath.toLowerCase() !==
      targetConfiguration.instructionsFileName.toLowerCase()
  );
  const convertedFiles: UploadedProjectFile[] = [
    ...retainedFiles,
    {
      relativePath: targetConfiguration.instructionsFileName,
      content: Buffer.from(instructionsFile.content)
    }
  ];
  const unavailableFileNames = new Set<string>();

  for (const agent of agents) {
    const fileName = createAgentFileName(
      agent.name,
      targetEngine,
      unavailableFileNames
    );
    unavailableFileNames.add(fileName.toLowerCase());
    convertedFiles.push({
      relativePath: `${targetConfiguration.rootDirectory}/agents/${fileName}`,
      content: Buffer.from(serializeImportedAgent(targetEngine, agent), "utf8")
    });
  }

  if (agents.length === 0) {
    convertedFiles.push({
      relativePath: `${targetConfiguration.rootDirectory}/agents/.gitkeep`,
      content: Buffer.alloc(0)
    });
  }

  return {
    files: convertedFiles,
    sourceEngine,
    targetEngine,
    converted: true
  };
}

function detectImportedProjectEngine(
  files: UploadedProjectFile[]
): ProjectAgentEngine | null {
  const detectedEngines = (Object.keys(importEngineConfigurations) as
    ProjectAgentEngine[]).filter((engine) => {
      const configuration = importEngineConfigurations[engine];

      return files.some((file) =>
        file.relativePath.toLowerCase().startsWith(
          configuration.configurationPathPrefix
        ) ||
        (engine === "codex" &&
          file.relativePath.toLowerCase() === ".codex/config.toml")
      );
    });

  if (detectedEngines.length > 1) {
    throw new TypeError(
      `The imported project contains multiple agent configurations ` +
      `(${detectedEngines.join(", ")}).`
    );
  }

  if (detectedEngines.length === 1) {
    return detectedEngines[0] as ProjectAgentEngine;
  }

  return findFile(files, "CLAUDE.md") ? "claude" : null;
}

function readImportedAgents(
  files: UploadedProjectFile[],
  engine: ProjectAgentEngine
): EditableProjectAgent[] {
  const configuration = importEngineConfigurations[engine];

  return files
    .filter((file) => configuration.agentFilePattern.test(file.relativePath))
    .map((file) => engine === "codex"
      ? readCodexAgent(file)
      : readMarkdownAgent(file, engine)
    );
}

function readCodexAgent(file: UploadedProjectFile): EditableProjectAgent {
  let parsed: Record<string, unknown>;

  try {
    parsed = parse(file.content.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new TypeError(
      `The Codex TOML file "${file.relativePath}" is invalid.`
    );
  }

  return {
    name: readString(parsed.name) ??
      path.posix.basename(file.relativePath).replace(/\.toml$/i, ""),
    description: readString(parsed.description) ?? "",
    prompt: readString(parsed.developer_instructions) ?? ""
  };
}

function readMarkdownAgent(
  file: UploadedProjectFile,
  engine: "claude" | "copilot"
): EditableProjectAgent {
  const markdown = parseMarkdownFrontmatter(file.content.toString("utf8"));
  const extension = engine === "copilot" ? /\.agent\.md$/i : /\.md$/i;

  return {
    name: markdown.attributes.name?.trim() ||
      path.posix.basename(file.relativePath).replace(extension, ""),
    description: markdown.attributes.description?.trim() || "",
    prompt: markdown.body.trim()
  };
}

function isSourceConfigurationFile(
  relativePath: string,
  engine: ProjectAgentEngine
): boolean {
  const normalizedPath = relativePath.toLowerCase();

  if (engine === "copilot") {
    return normalizedPath.startsWith(".github/agents/");
  }

  return normalizedPath.startsWith(
    `${importEngineConfigurations[engine].rootDirectory}/`
  );
}

function findFile(
  files: UploadedProjectFile[],
  relativePath: string
): UploadedProjectFile | undefined {
  const normalizedPath = relativePath.toLowerCase();
  return files.find((file) => file.relativePath.toLowerCase() === normalizedPath);
}

function createAgentFileName(
  name: string,
  engine: ProjectAgentEngine,
  unavailableFileNames: Set<string>
): string {
  const extension = engine === "codex"
    ? ".toml"
    : engine === "copilot"
      ? ".agent.md"
      : ".md";
  const baseName = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
  let suffix = 1;
  let fileName = `${baseName}${extension}`;

  while (unavailableFileNames.has(fileName.toLowerCase())) {
    suffix += 1;
    fileName = `${baseName}-${suffix}${extension}`;
  }

  return fileName;
}

function serializeImportedAgent(
  engine: ProjectAgentEngine,
  agent: EditableProjectAgent
): string {
  if (engine === "codex") {
    return [
      `name = ${JSON.stringify(agent.name)}`,
      `description = ${JSON.stringify(agent.description)}`,
      `developer_instructions = ${JSON.stringify(agent.prompt)}`,
      ""
    ].join("\n");
  }

  return [
    "---",
    `name: ${JSON.stringify(agent.name)}`,
    `description: ${JSON.stringify(agent.description)}`,
    "---",
    agent.prompt.trim(),
    ""
  ].join("\n");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

import { toCodexAgentDefinitions } from "../../mapper/agent/CodexAgentMapper.ts";
import { toClaudeAgentDefinitions } from "../../mapper/agent/ClaudeAgentMapper.ts";
import { toCopilotAgentDefinitions } from "../../mapper/agent/CopilotAgentMapper.ts";
import { createAgentWorkflowHash } from "../workflowExecution/WorkflowConfiguration.ts";
import type { AgentWorkflowConfiguration, ProjectDirectoryContent, UploadedProjectFile } from "./ProjectService.ts";

/** Archive-only metadata: never writes instructions, sessions, or schedule values. */
export const projectWorkflowArchivePath = ".cortex/workflow.json";

function readDefinition(files: UploadedProjectFile[]) {
  const root: ProjectDirectoryContent = { type: "directory", name: "", relativePath: "", children: [] };
  // Use the same source order and parsers as the project loader, including the
  // legacy Codex registry, so old cached hashes can be verified before export.
  for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    const parts = file.relativePath.split("/");
    let directory = root;
    for (const name of parts.slice(0, -1)) {
      let child = directory.children.find((entry): entry is ProjectDirectoryContent => entry.type === "directory" && entry.name === name);
      if (!child) {
        child = { type: "directory", name, relativePath: [directory.relativePath, name].filter(Boolean).join("/"), children: [] };
        directory.children.push(child);
      }
      directory = child;
    }
    directory.children.push({ type: "file", name: parts.at(-1)!, relativePath: file.relativePath,
      size: file.content.byteLength, encoding: "utf8", content: file.content.toString("utf8") });
  }
  const formats = [
    { root: ".codex", instructions: "AGENTS.md", parse: toCodexAgentDefinitions },
    { root: ".claude", instructions: "CLAUDE.md", parse: toClaudeAgentDefinitions },
    { root: ".github", instructions: "AGENTS.md", parse: toCopilotAgentDefinitions }
  ];
  const available = formats.flatMap((format) => {
    const directory = root.children.find((entry): entry is ProjectDirectoryContent => entry.type === "directory" && entry.name === format.root);
    return directory && (format.root !== ".github" || directory.children.some((entry) => entry.type === "directory" && entry.name === "agents"))
      ? [{ format, directory }] : [];
  });
  if (available.length !== 1) return null;
  const { format, directory } = available[0];
  const instructionsFile = files.find((file) => file.relativePath.toLowerCase() === format.instructions.toLowerCase());
  return {
    instructions: { fileName: instructionsFile?.relativePath ?? format.instructions, content: instructionsFile?.content.toString("utf8") ?? null },
    agents: format.parse(directory)
  };
}

export function canonicalizeArchivedWorkflow(
  files: UploadedProjectFile[], workflow: AgentWorkflowConfiguration
): AgentWorkflowConfiguration | null {
  const sanitized = validateArchivedWorkflow(workflow);
  const definition = readDefinition(files);
  if (!definition) return null;
  const hash = createAgentWorkflowHash(definition.instructions, definition.agents);
  if (sanitized.hash !== hash && sanitized.hash !== createAgentWorkflowHash(definition.instructions, definition.agents, true)) return null;
  const agentIds = new Set(definition.agents.map((agent) => agent.id));
  if (sanitized.agents.length !== agentIds.size ||
    sanitized.agents.some((agent) => !agentIds.has(agent.id) || agent.nextAgentIds.some((id) => !agentIds.has(id)))) {
    throw new TypeError("The archived workflow does not match the project's agents.");
  }
  return { ...sanitized, hash };
}

function validateArchivedWorkflow(workflow: AgentWorkflowConfiguration): AgentWorkflowConfiguration {
  if (!workflow || typeof workflow.hash !== "string" || !Array.isArray(workflow.agents) || !Array.isArray(workflow.parameters)) {
    throw new TypeError("The archived Cortex workflow metadata is invalid.");
  }
  const agentIds = new Set<string>();
  const agents = workflow.agents.map((agent) => {
    if (!agent || typeof agent.id !== "string" || !agent.id || agentIds.has(agent.id) ||
      !Array.isArray(agent.nextAgentIds) || !agent.nextAgentIds.every((id) => typeof id === "string") ||
      new Set(agent.nextAgentIds).size !== agent.nextAgentIds.length ||
      (agent.inputMode !== "separate" && agent.inputMode !== "aggregate")) {
      throw new TypeError("The archived Cortex workflow agents are invalid.");
    }
    agentIds.add(agent.id);
    return { id: agent.id, nextAgentIds: [...agent.nextAgentIds], inputMode: agent.inputMode };
  });
  const parameterIds = new Set<string>();
  const parameters = workflow.parameters.map((parameter) => {
    if (!parameter || typeof parameter.id !== "string" || !/^[a-z][a-z0-9_-]*$/.test(parameter.id) ||
      parameterIds.has(parameter.id) || typeof parameter.label !== "string" || !parameter.label.trim() ||
      typeof parameter.description !== "string" || typeof parameter.required !== "boolean" ||
      !["text", "textarea", "select"].includes(parameter.inputType) || typeof parameter.placeholder !== "string" ||
      !Array.isArray(parameter.options) || !parameter.options.every((option) => typeof option === "string" && option.trim()) ||
      new Set(parameter.options.map((option) => option.trim())).size !== parameter.options.length ||
      (parameter.inputType === "select" ? parameter.options.length < 2 : parameter.options.length !== 0)) {
      throw new TypeError("The archived Cortex workflow parameters are invalid.");
    }
    parameterIds.add(parameter.id);
    // Explicit projection keeps runtime values, sessions and other local fields
    // out of both the archive and the restored configuration.
    return { id: parameter.id, label: parameter.label.trim(), description: parameter.description.trim(),
      required: parameter.required, inputType: parameter.inputType, placeholder: parameter.placeholder.trim(),
      options: parameter.options.map((option) => option.trim()) };
  });
  return { hash: workflow.hash, agents, parameters };
}

export function remapArchivedWorkflow(
  workflow: AgentWorkflowConfiguration,
  files: UploadedProjectFile[],
  agentIdMap: ReadonlyMap<string, string>
): AgentWorkflowConfiguration {
  const definition = readDefinition(files);
  if (!definition) throw new TypeError("The converted workflow has no agent configuration.");
  const remap = (id: string): string => {
    const target = agentIdMap.get(id);
    if (!target) throw new TypeError("The converted workflow contains an unknown agent.");
    return target;
  };
  return { ...workflow, hash: createAgentWorkflowHash(definition.instructions, definition.agents),
    agents: workflow.agents.map((agent) => ({ ...agent, id: remap(agent.id), nextAgentIds: agent.nextAgentIds.map(remap) })) };
}

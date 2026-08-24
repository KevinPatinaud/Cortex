import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { McpConfigurationService } from "./McpConfigurationService.ts";

async function withFixture(
  assertion: (
    service: McpConfigurationService,
    projectDirectory: string,
    files: { copilotConfigurationFile: string }
  ) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-mcp-"));
  const projectDirectory = path.join(directory, "project");
  const codexConfigurationFile = path.join(directory, "codex.toml");
  const claudeConfigurationFile = path.join(directory, "claude.json");
  const copilotConfigurationFile = path.join(directory, "copilot.json");

  try {
    await mkdir(path.join(projectDirectory, ".github"), { recursive: true });
    await mkdir(path.join(projectDirectory, ".codex"), { recursive: true });
    await writeFile(codexConfigurationFile, [
      "[mcp_servers.context7]",
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]'
    ].join("\n"));
    await writeFile(claudeConfigurationFile, JSON.stringify({
      mcpServers: {
        stripe: { type: "http", url: "https://mcp.stripe.com?token=secret" }
      },
      projects: {
        [projectDirectory]: {
          mcpServers: { local: { command: "local-mcp" } }
        }
      }
    }));
    await writeFile(copilotConfigurationFile, JSON.stringify({
      mcpServers: {
        atlassian: {
          type: "http",
          url: "https://mcp.atlassian.com/v1/mcp",
          tools: ["*"]
        }
      }
    }));
    await writeFile(path.join(projectDirectory, ".mcp.json"), JSON.stringify({
      mcpServers: { playwright: { command: "npx", args: ["@playwright/mcp"] } }
    }));
    await writeFile(
      path.join(projectDirectory, ".github", "mcp.json"),
      JSON.stringify({ mcpServers: { github: { type: "http", url: "https://api.example/mcp" } } })
    );
    await writeFile(
      path.join(projectDirectory, ".codex", "config.toml"),
      '[mcp_servers.figma]\nurl = "https://mcp.figma.com/mcp"\nbearer_token_env_var = "FIGMA_TOKEN"'
    );

    await assertion(new McpConfigurationService({
      codexConfigurationFile,
      claudeConfigurationFile,
      copilotConfigurationFile
    }), projectDirectory, { copilotConfigurationFile });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("découvre et normalise les configurations MCP natives", async () => {
  await withFixture(async (service, projectDirectory) => {
    const result = await service.discover(projectDirectory);

    assert.deepEqual(result.issues, []);
    assert.deepEqual(
      result.connections.map((connection) => connection.name),
      ["atlassian", "context7", "figma", "github", "local", "playwright", "stripe"]
    );
    assert.deepEqual(
      result.connections.find((connection) => connection.name === "playwright")
        ?.configuredFor,
      ["claude", "copilot"]
    );
    assert.equal(
      result.connections.find((connection) => connection.name === "stripe")
        ?.endpoint,
      "https://mcp.stripe.com/"
    );
    assert.equal(
      result.connections.find((connection) => connection.name === "figma")
        ?.hasAuthentication,
      true
    );
  });
});

test("injecte les serveurs utilisateur Copilot sauf ceux redéfinis par le projet", async () => {
  await withFixture(async (service, projectDirectory) => {
    await writeFile(path.join(projectDirectory, ".mcp.json"), JSON.stringify({
      mcpServers: {
        atlassian: { type: "http", url: "https://project.example/mcp" }
      }
    }));

    assert.deepEqual(await service.getCopilotMcpServers(projectDirectory), {});
  });
});

test("signale un fichier invalide sans bloquer les autres sources", async () => {
  await withFixture(async (service, _projectDirectory, files) => {
    await writeFile(files.copilotConfigurationFile, "{invalid-json");
    const result = await service.discover();

    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].source, "copilot");
    assert.ok(result.connections.some((connection) =>
      connection.name === "context7"
    ));
  });
});

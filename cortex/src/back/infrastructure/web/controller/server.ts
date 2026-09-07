import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { AgentService } from "../../../application/service/iaService/AgentService.ts";
import { AgentConfigurationService } from "../../../application/service/iaService/AgentConfigurationService.ts";
import { createDefaultAgentToolRegistry } from "../../../application/service/iaService/iaTools/AgentToolRegistry.ts";
import { McpConfigurationService } from "../../../application/service/iaService/McpConfigurationService.ts";
import { CodexPluginService } from "../../../application/service/iaService/CodexPluginService.ts";
import { ClaudeAgentProvider } from "../../../application/service/iaService/providers/ClaudeAgentProvider.ts";
import { CodexAgentProvider } from "../../../application/service/iaService/providers/CodexAgentProvider.ts";
import { CopilotAgentProvider } from "../../../application/service/iaService/providers/CopilotAgentProvider.ts";
import { DirectoryPickerService } from "../../../application/service/projectService/DirectoryPickerService.ts";
import { ProjectService } from "../../../application/service/projectService/ProjectService.ts";
import { AgentUseCase } from "../../../application/usecase/AgentUseCase.ts";
import { ProjectUseCase } from "../../../application/usecase/ProjectUseCase.ts";
import { WorkflowScheduler } from "../../../application/service/workflowScheduler/WorkflowScheduler.ts";
import { WorkflowWaitScheduler } from "../../../application/service/workflowScheduler/WorkflowWaitScheduler.ts";
import { GmailService } from "../../../application/service/gmail/GmailService.ts";
import { WorkflowAuditService } from "../../../application/service/workflowAudit/WorkflowAuditService.ts";
import { WorkflowAutomationService } from "../../../application/service/workflowAutomation/WorkflowAutomationService.ts";
import { SqliteWorkflowAutomationRepository } from "../../automation/SqliteWorkflowAutomationRepository.ts";
import { SqliteWorkflowAuditRepository } from "../../audit/SqliteWorkflowAuditRepository.ts";
import {
  PasswordAuthentication,
  readAccessPassword,
  readPasswordArgument,
  readSecureCookie
} from "../middleware/PasswordAuthentication.ts";
import { createCortexApplication } from "./CortexApplication.ts";

const port = readPort(process.env.PORT);
const host = process.env.HOST?.trim() || "127.0.0.1";
const directoryName = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(directoryName, "../../../../..");
const clientDirectory = path.join(workspaceDirectory, "dist");
const configurationFile = path.join(workspaceDirectory, "config.json");
const auditDatabaseFile = process.env.CORTEX_AUDIT_DATABASE?.trim() ||
  path.join(
    workspaceDirectory,
    "data",
    "audit",
    "cortex-audit.sqlite"
  );
const managedProjectsDirectory = process.env.CORTEX_PROJECTS_DIRECTORY?.trim() ||
  path.join(workspaceDirectory, "projects");
const shouldOpenBrowser = process.argv.includes("--open");
const suppliedPassword = readPasswordArgument(process.argv) ??
  process.env.CORTEX_PASSWORD;
const accessPassword = readAccessPassword(suppliedPassword);
const authentication = accessPassword === null
  ? null
  : new PasswordAuthentication({
    password: accessPassword,
    secureCookie: readSecureCookie(process.env.CORTEX_SECURE_COOKIE)
  });
const agentToolRegistry = createDefaultAgentToolRegistry();
const mcpConfigurationService = new McpConfigurationService();
const codexPluginService = new CodexPluginService();
const agentConfigurationService = new AgentConfigurationService(
  configurationFile
);
const agentService = new AgentService([
  new CodexAgentProvider(workspaceDirectory),
  new ClaudeAgentProvider(workspaceDirectory),
  new CopilotAgentProvider(agentToolRegistry, mcpConfigurationService)
], agentConfigurationService, mcpConfigurationService, codexPluginService,
readPositiveSetting("CORTEX_AGENT_TIMEOUT_MS", 15 * 60 * 1000));
const directoryPickerService = new DirectoryPickerService();
const projectService = new ProjectService(
  configurationFile,
  managedProjectsDirectory
);
const projectUseCase = new ProjectUseCase(
  projectService,
  directoryPickerService,
  agentService
);
const workflowAuditRepository = new SqliteWorkflowAuditRepository(
  auditDatabaseFile
);
const workflowAuditService = new WorkflowAuditService(workflowAuditRepository);
const agentUseCase = new AgentUseCase(
  agentService,
  projectUseCase,
  workflowAuditService,
  {
    maxConcurrentInstances: readPositiveSetting("CORTEX_MAX_CONCURRENT_INSTANCES", 4),
    maxWorkflowExecutions: readPositiveSetting("CORTEX_MAX_WORKFLOW_EXECUTIONS", 100)
  }
);
const workflowScheduler = new WorkflowScheduler(
  projectUseCase,
  agentUseCase,
  () => new Date(),
  workflowAuditService
);

const automationRepository = new SqliteWorkflowAutomationRepository(auditDatabaseFile);
const automations = new WorkflowAutomationService(automationRepository, agentUseCase, projectUseCase, workflowAuditService);
const gmail = new GmailService(
  path.join(workspaceDirectory, "data", "gmail", "connection.sqlite"),
  process.env.CORTEX_GMAIL_REDIRECT_URI?.trim() || `http://127.0.0.1:${port}/api/gmail/callback`,
  agentUseCase
);
const app = createCortexApplication({
  projectUseCase, agentUseCase, workflowScheduler, authentication, clientDirectory, gmail, automations
});

const workflowWaitScheduler = new WorkflowWaitScheduler(agentUseCase);
const httpServer = app.listen(port, host, () => {
  workflowWaitScheduler.start();
  gmail.start();
  const browserHost = host === "0.0.0.0" || host === "::"
    ? "localhost"
    : host;
  const applicationUrl = `http://${browserHost}:${port}`;
  console.log(`Server available at ${applicationUrl}`);
  void automations.start().then(() => { if (!shuttingDown) return workflowScheduler.start(); }).catch((error: unknown) => {
    console.error("Unable to start the workflow scheduler:", error);
  });

  if (shouldOpenBrowser) {
    openDefaultBrowser(applicationUrl);
  }
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  workflowScheduler.stop();
  workflowWaitScheduler.stop();
  const automationsStopped = automations.stop();
  void gmail.stop();
  agentUseCase.cancelAllExecutions();
  agentService.cancelAllExecutions();
  const deadline = setTimeout(() => process.exit(1), 15_000);
  deadline.unref();
  const closed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
  const expiresAt = Date.now() + 10_000;
  while ((agentUseCase.hasActiveExecutions() || agentService.hasActiveExecutions()) && Date.now() < expiresAt) {
    await delay(50);
  }
  if (agentUseCase.hasActiveExecutions() || agentService.hasActiveExecutions()) {
    // Leave SQLite open until process exit; unfinished audit rows and
    // checkpoints are recovered as interrupted on the next startup.
    process.exitCode = 1;
    return;
  }
  httpServer.closeAllConnections();
  await closed;
  await gmail.close();
  await automationsStopped;
  automationRepository.close();
  workflowAuditRepository.close();
  clearTimeout(deadline);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

function openDefaultBrowser(url: string): void {
  const browserProcess = process.platform === "win32"
    ? spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    })
    : process.platform === "darwin"
      ? spawn("open", [url], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });

  browserProcess.once("error", (error) => {
    console.warn("Unable to open the browser automatically.", error);
  });
  browserProcess.unref();
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 3000;
  }

  const parsedPort = Number(value);

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error("The PORT variable must be an integer between 1 and 65535.");
  }

  return parsedPort;
}

function readPositiveSetting(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error(`The ${name} variable must be a positive integer no larger than 2147483647.`);
  }
  return value;
}

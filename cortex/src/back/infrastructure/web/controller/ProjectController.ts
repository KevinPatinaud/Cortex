import { Router, type Request, type Response } from "express";
import multer from "multer";
import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  CreateProjectInput,
  ProjectUseCase
} from "../../../application/usecase/ProjectUseCase.ts";
import { NotFoundError } from "../../../application/error/NotFoundError.ts";
import {
  projectErrorMappings,
  toProjectDeletedResponse,
  toProjectSavedResponse,
  toProjectsResponse,
  toSelectedDirectoryResponse
} from "../mapper/ProjectResponseMapper.ts";
import { ValidationError } from "../../../application/error/ValidationError.ts";
import { asyncRoute } from "../middleware/HttpErrorMiddleware.ts";
import {
  cortexArchiveMimeType,
  getCortexArchiveFileName,
  writeCortexProjectArchive
} from "../../archive/ProjectArchive.ts";
import { readCortexProjectArchive } from "../../archive/ProjectArchiveReader.ts";
import type { WorkflowAutomationService } from "../../../application/service/workflowAutomation/WorkflowAutomationService.ts";

interface ProjectPathRequestBody {
  directoryPath?: unknown;
}

interface ProjectSettingsRequestBody {
  projectsDirectory?: unknown;
}

interface ProjectOrderRequestBody {
  projectIds?: unknown;
}

interface ProjectFolderRequestBody {
  name?: unknown;
}

interface ProjectFolderAssignmentRequestBody {
  folderId?: unknown;
}

interface ImportProjectRequestBody {
  projectName?: unknown;
  relativePaths?: unknown;
}

const maximumUploadRequestBytes = 105 * 1024 * 1024;
const projectUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 2_000,
    fileSize: 20 * 1024 * 1024,
    fields: 2,
    fieldSize: 2 * 1024 * 1024,
    parts: 2_002
  }
}).array("files", 2_000);
const projectArchiveUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 100 * 1024 * 1024,
    fields: 0,
    parts: 2
  }
}).single("archive");

export function createProjectController(projectUseCase: ProjectUseCase, automations?: WorkflowAutomationService): Router {
  const router = Router();

  router.get(
    "/folders",
    asyncRoute(async (_request, response) => {
      response.json(await projectUseCase.getProjectOrganization());
    }, projectErrorMappings.folders)
  );

  router.post(
    "/folders",
    asyncRoute<ProjectFolderRequestBody>(async (request, response) => {
      response.status(201).json(await projectUseCase.createProjectFolder(request.body?.name));
    }, projectErrorMappings.folders)
  );

  router.patch(
    "/folders/:folderId",
    asyncRoute<ProjectFolderRequestBody, { folderId: string }>(async (request, response) => {
      response.json(await projectUseCase.renameProjectFolder(request.params.folderId, request.body?.name));
    }, projectErrorMappings.folders)
  );

  router.delete(
    "/folders/:folderId",
    asyncRoute<unknown, { folderId: string }>(async (request, response) => {
      response.json(await projectUseCase.deleteProjectFolder(request.params.folderId));
    }, projectErrorMappings.folders)
  );

  router.put(
    "/:projectId/folder",
    asyncRoute<ProjectFolderAssignmentRequestBody, { projectId: string }>(async (request, response) => {
      response.json(await projectUseCase.setProjectFolder(request.params.projectId, request.body?.folderId));
    }, projectErrorMappings.folders)
  );

  router.get(
    "/settings",
    asyncRoute(async (_request, response) => {
      response.json(await projectUseCase.getProjectSettings());
    }, projectErrorMappings.settings)
  );

  router.put(
    "/settings",
    asyncRoute<ProjectSettingsRequestBody>(async (request, response) => {
      response.json(await projectUseCase.saveProjectSettings(
        request.body.projectsDirectory
      ));
    }, projectErrorMappings.settings)
  );

  router.put(
    "/order",
    asyncRoute<ProjectOrderRequestBody>(async (request, response) => {
      response.json(toProjectsResponse(
        await projectUseCase.reorderProjects(request.body.projectIds)
      ));
    }, projectErrorMappings.reorder)
  );

  router.post(
    "/create",
    asyncRoute<CreateProjectInput>(async (request, response) => {
      const result = await projectUseCase.createProject(request.body);
      response.status(201).json({
        message: "The project was created.",
        project: result.project,
        projects: result.projects
      });
    }, projectErrorMappings.create)
  );

  router.post(
    "/import",
    asyncRoute<ImportProjectRequestBody>(async (request, response) => {
      assertUploadRequestSize(request);
      await receiveProjectUpload(request, response);

      const files = Array.isArray(request.files) ? request.files : [];
      const relativePaths = readRelativePaths(request.body?.relativePaths);

      if (relativePaths.length !== files.length) {
        throw new ValidationError(
          "The uploaded file list does not match the path manifest."
        );
      }

      const result = await projectUseCase.importProject(
        request.body?.projectName,
        files.map((file, index) => ({
          relativePath: relativePaths[index] as string,
          content: file.buffer
        }))
      );
      await automations?.restoreImportedBranches(result.project.id);

      response.status(201).json({
        message: "The project was imported.",
        project: result.project,
        projects: result.projects,
        conversion: result.conversion ?? null
      });
    }, projectErrorMappings.import)
  );

  router.post(
    "/import-archive",
    asyncRoute(async (request, response) => {
      assertUploadRequestSize(request);
      await receiveProjectArchiveUpload(request, response);

      if (!request.file) {
        throw new ValidationError("The Cortex archive is required.");
      }

      const archive = await readCortexProjectArchive(
        request.file.originalname,
        request.file.buffer
      );
      const result = await projectUseCase.importProject(
        archive.projectName,
        archive.files
      );
      await automations?.restoreImportedBranches(result.project.id);

      response.status(201).json({
        message: "The Cortex project was imported.",
        project: result.project,
        projects: result.projects,
        conversion: result.conversion ?? null
      });
    }, projectErrorMappings.import)
  );

  router.post(
    "/save",
    asyncRoute<ProjectPathRequestBody>(async (request, response) => {
      const projects = await projectUseCase.saveProject(
        request.body.directoryPath
      );
      response.status(201).json(toProjectSavedResponse(projects));
    }, projectErrorMappings.save)
  );

  router.get(
    "/:projectId/export",
    asyncRoute<unknown, { projectId: string }>(async (request, response) => {
      const project = await projectUseCase.getProject(request.params.projectId);
      await assertExportableProjectDirectory(project.directoryPath);

      response.attachment(
        getCortexArchiveFileName(path.basename(project.directoryPath))
      );
      response.type(cortexArchiveMimeType);
      response.set("Cache-Control", "no-store");

      if (automations?.rules(project.id).length) await automations.target(project.id);
      const workflow = await projectUseCase.getAgentWorkflowConfiguration(project.id);
      if (workflow && automations) workflow.dossierBranches = automations.rules(project.id)
        .filter(rule => rule.targetProjectId === project.id && rule.targetAgentId)
        .map(rule => ({ sourceAgentId: rule.sourceAgentId, targetAgentId: rule.targetAgentId! }));
      await writeCortexProjectArchive(project.directoryPath, response, workflow);
    }, projectErrorMappings.export)
  );

  router.get(
    "/",
    asyncRoute(async (_request, response) => {
      response.json(toProjectsResponse(await projectUseCase.getProjects()));
    }, projectErrorMappings.list)
  );

  router.delete(
    "/",
    asyncRoute<ProjectPathRequestBody>(async (request, response) => {
      const projects = await projectUseCase.deleteProject(
        request.body.directoryPath
      );
      response.json(toProjectDeletedResponse(projects));
    }, projectErrorMappings.delete)
  );

  router.post(
    "/select-instructions-file",
    asyncRoute(async (_request, response) => {
      const directoryPath = await projectUseCase.selectProjectDirectoryFromInstructionsFile();
      response.json(toSelectedDirectoryResponse(directoryPath));
    }, projectErrorMappings.selectDirectory)
  );

  return router;
}

async function assertExportableProjectDirectory(
  directoryPath: string
): Promise<void> {
  try {
    if ((await stat(directoryPath)).isDirectory()) {
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  throw new NotFoundError("The project directory could not be found.");
}

function assertUploadRequestSize(request: Request): void {
  const contentLength = Number(request.headers["content-length"]);

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new ValidationError("The upload size could not be determined.");
  }

  if (contentLength > maximumUploadRequestBytes) {
    throw new ValidationError("The project upload exceeds the 100 MB limit.");
  }
}

function receiveProjectUpload(
  request: Request,
  response: Response
): Promise<void> {
  return new Promise((resolve, reject) => {
    projectUpload(request, response, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        reject(new ValidationError(getMulterErrorMessage(error)));
        return;
      }

      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function receiveProjectArchiveUpload(
  request: Request,
  response: Response
): Promise<void> {
  return new Promise((resolve, reject) => {
    projectArchiveUpload(request, response, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        reject(new ValidationError(getArchiveMulterErrorMessage(error)));
        return;
      }

      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function readRelativePaths(value: unknown): string[] {
  if (typeof value !== "string") {
    throw new ValidationError("The uploaded path manifest is required.");
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(value);
  } catch {
    throw new ValidationError("The uploaded path manifest is invalid.");
  }

  if (
    !Array.isArray(parsedValue) ||
    parsedValue.some((relativePath) => typeof relativePath !== "string")
  ) {
    throw new ValidationError("The uploaded path manifest is invalid.");
  }

  return parsedValue;
}

function getMulterErrorMessage(error: multer.MulterError): string {
  if (error.code === "LIMIT_FILE_SIZE") {
    return "An uploaded file exceeds the 20 MB limit.";
  }

  if (error.code === "LIMIT_FILE_COUNT") {
    return "The project exceeds the 2,000-file limit.";
  }

  return "The project upload is invalid.";
}

function getArchiveMulterErrorMessage(error: multer.MulterError): string {
  if (error.code === "LIMIT_FILE_SIZE") {
    return "The Cortex archive exceeds the 100 MB limit.";
  }

  if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_PART_COUNT") {
    return "Only one Cortex archive can be imported at a time.";
  }

  return "The Cortex archive upload is invalid.";
}

import { Router, type Request, type Response } from "express";
import multer from "multer";
import type {
  CreateProjectInput,
  ProjectUseCase
} from "../../../application/usecase/ProjectUseCase.ts";
import {
  projectErrorMappings,
  toProjectDeletedResponse,
  toProjectSavedResponse,
  toProjectsResponse,
  toSelectedDirectoryResponse
} from "../mapper/ProjectResponseMapper.ts";
import { ValidationError } from "../../../application/error/ValidationError.ts";
import { asyncRoute } from "../middleware/HttpErrorMiddleware.ts";

interface ProjectPathRequestBody {
  directoryPath?: unknown;
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

export function createProjectController(projectUseCase: ProjectUseCase): Router {
  const router = Router();

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

      response.status(201).json({
        message: "The project was imported.",
        project: result.project,
        projects: result.projects
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

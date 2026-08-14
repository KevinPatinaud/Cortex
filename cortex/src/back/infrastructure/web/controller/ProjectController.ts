import { Router } from "express";
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
import { asyncRoute } from "../middleware/HttpErrorMiddleware.ts";

interface ProjectPathRequestBody {
  directoryPath?: unknown;
}

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

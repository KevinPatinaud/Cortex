import { Router, type Request, type Response } from "express";
import type { DirectoryPickerService } from "../engine/service/projectService/DirectoryPickerService.ts";
import type { ProjectService } from "../engine/service/projectService/ProjectService.ts";

interface SaveProjectRequestBody {
  directoryPath?: unknown;
}

export function createProjectController(
  projectService: ProjectService,
  directoryPickerService: DirectoryPickerService
): Router {
  const router = Router();

  router.post(
    "/save",
    async (
      request: Request<Record<string, never>, unknown, SaveProjectRequestBody>,
      response: Response
    ) => {
      const directoryPath = typeof request.body.directoryPath === "string"
        ? request.body.directoryPath.trim()
        : "";

      if (!directoryPath) {
        response.status(400).json({
          error: "Le chemin du repertoire est obligatoire."
        });
        return;
      }

      try {
        const projects = await projectService.saveProject(directoryPath);
        response.status(201).json({
          message: "Repertoire enregistre.",
          projects
        });
      } catch (error) {
        console.error("Impossible d'enregistrer le repertoire :", error);
        response.status(500).json({
          error: "Impossible d'enregistrer le repertoire."
        });
      }
    }
  );

  router.get("/", async (_request: Request, response: Response) => {
    try {
      response.json({ projects: await projectService.getProjects() });
    } catch (error) {
      console.error("Impossible de lire les repertoires enregistres :", error);
      response.status(500).json({
        error: "Impossible de lire les repertoires enregistres."
      });
    }
  });

  router.post(
    "/select-directory",
    async (_request: Request, response: Response) => {
      try {
        const directoryPath = await directoryPickerService.selectDirectory();
        response.json({ directoryPath });
      } catch (error) {
        console.error("Impossible d'ouvrir le selecteur de repertoire :", error);
        response.status(500).json({
          error: "Impossible d'ouvrir le selecteur de repertoire."
        });
      }
    }
  );

  return router;
}

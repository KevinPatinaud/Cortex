import { Router } from "express";
import type { WorkLightService } from "../../../application/service/workLight/WorkLightService.ts";
import { ValidationError } from "../../../application/error/ValidationError.ts";
import { asyncRoute } from "../middleware/HttpErrorMiddleware.ts";

const mapping = { fallbackStatus: 500, fallbackMessage: "Work Light est indisponible.", logMessage: "Work Light API:" };
export function createWorkLightController(service: WorkLightService): Router {
  const router = Router();
  router.use((request, _response, next) => {
    if (request.method !== "GET" && !request.is("application/json")) throw new ValidationError("La requête Work Light doit être envoyée en JSON.");
    next();
  });
  router.get("/", asyncRoute(async (_request, response) => { response.setHeader("Cache-Control", "no-store"); response.json(await service.overview()); }, mapping));
  router.get("/status", asyncRoute(async (_request, response) => { response.setHeader("Cache-Control", "no-store"); response.json(await service.status()); }, mapping));
  router.get("/agents", asyncRoute(async (_request, response) => { response.json(await service.catalog()); }, mapping));
  router.post("/preview", asyncRoute(async (request, response) => { response.json(service.preview(request.body)); }, mapping));
  router.put("/configuration", asyncRoute(async (request, response) => { response.json(await service.saveConfiguration(request.body)); }, mapping));
  router.put("/settings", asyncRoute(async (request, response) => { response.json(await service.saveSettings(request.body)); }, mapping));
  router.post("/start", asyncRoute(async (_request, response) => { response.status(202).json(await service.arm()); }, mapping));
  router.post("/stop", asyncRoute(async (_request, response) => { response.json(await service.disarm()); }, mapping));
  return router;
}

import { Router } from "express";
import type { WorkForceService } from "../../../application/service/workForce/WorkForceService.ts";
import { ValidationError } from "../../../application/error/ValidationError.ts";
import { asyncRoute } from "../middleware/HttpErrorMiddleware.ts";

const mapping = { fallbackStatus: 500, fallbackMessage: "Work Force est indisponible.", logMessage: "Work Force API:" };
export function createWorkForceController(service: WorkForceService): Router {
  const router = Router();
  router.use((request, _response, next) => {
    if (request.method !== "GET" && !request.is("application/json")) throw new ValidationError("La requête Work Force doit être envoyée en JSON.");
    next();
  });
  router.get("/", asyncRoute(async (_request, response) => { response.setHeader("Cache-Control", "no-store"); response.json(await service.overview()); }, mapping));
  router.get("/agents", asyncRoute(async (_request, response) => { response.json(await service.catalog()); }, mapping));
  router.put("/configuration", asyncRoute(async (request, response) => { response.json(await service.saveConfiguration(request.body)); }, mapping));
  router.put("/settings", asyncRoute(async (request, response) => { response.json(await service.saveSettings(request.body)); }, mapping));
  router.post("/start", asyncRoute(async (_request, response) => { response.status(202).json(await service.arm()); }, mapping));
  router.post("/stop", asyncRoute(async (_request, response) => { response.json(await service.disarm()); }, mapping));
  return router;
}

import { Router } from "express";
import type { GlobalExecutionQueue } from "../../../application/service/executionQueue/GlobalExecutionQueue.ts";
import { ValidationError } from "../../../application/error/ValidationError.ts";
import { asyncRoute } from "../middleware/HttpErrorMiddleware.ts";
const mapping = { fallbackStatus: 500, fallbackMessage: "La file d’attente Cortex est indisponible.", logMessage: "Cortex execution queue:" };
export function createExecutionQueueController(queue: GlobalExecutionQueue): Router {
  const router = Router();
  router.get("/", asyncRoute(async (_request, response) => { response.setHeader("Cache-Control", "no-store"); response.json(await queue.status()); }, mapping));
  router.put("/settings", asyncRoute(async (request, response) => {
    if (!request.is("application/json")) throw new ValidationError("La requête doit être envoyée en JSON.");
    response.json(await queue.saveSettings(request.body));
  }, mapping));
  return router;
}

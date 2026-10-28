import { Router } from "express";
import multer from "multer";
import { ValidationError } from "../../../application/error/ValidationError.ts";
import { MAX_PROMPT_ATTACHMENTS, MAX_PROMPT_FILE_BYTES, MAX_PROMPT_TOTAL_BYTES } from "../../../../shared/PromptAttachment.ts";
import type { PromptQueueService } from "../../../application/service/promptQueue/PromptQueueService.ts";

export function createPromptQueueController(service: PromptQueueService): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: MAX_PROMPT_ATTACHMENTS, fileSize: MAX_PROMPT_FILE_BYTES, fields: 1, fieldSize: 500_000, parts: MAX_PROMPT_ATTACHMENTS + 2 } }).array("files", MAX_PROMPT_ATTACHMENTS);
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/", async (_request, response) => { response.json(await service.overview()); });
  router.get("/settings", (_request, response) => { response.json(service.settings()); });
  router.put("/settings", async (request, response) => { response.json(await service.saveSettings(request.body)); });
  router.get("/models", async (_request, response) => { response.json(await service.defaultModels()); });
  router.post("/check", async (_request, response) => { await service.checkNow(); response.json(await service.overview()); });
  router.post("/chats", async (request, response) => { response.status(201).json(await service.create(request.body)); });
  router.get("/chats/:id", (request, response) => { response.json(service.detail(request.params.id)); });
  router.patch("/chats/:id", async (request, response) => { await service.configureChat(request.params.id, request.body); response.json(service.detail(request.params.id)); });
  router.delete("/chats/:id", (request, response) => { service.delete(request.params.id); response.json({ deleted: true }); });
  router.put("/chats/:id/pause", (request, response) => { service.setPaused(request.params.id, request.body); response.json(service.detail(request.params.id)); });
  router.get("/chats/:id/models", async (request, response) => { response.json(await service.models(request.params.id)); });
  router.post("/chats/:id/prompts", (request, response, next) => {
    if (!request.is("multipart/form-data")) return next();
    // Multipart is a browser "simple request". A different website must not
    // be able to submit an automatic task to a local, passwordless Cortex.
    const origin = request.get("origin");
    if (origin) {
      try { if (!["http:", "https:"].includes(new URL(origin).protocol) || new URL(origin).host !== request.get("host")) throw new Error(); }
      catch { return next(new ValidationError("Origine de transfert non autorisée.")); }
    }
    if (Number(request.headers["content-length"]) > MAX_PROMPT_TOTAL_BYTES + 1024 * 1024) return next(new ValidationError("Maximum : 50 Mo de pièces jointes par prompt."));
    upload(request, response, error => next(error ? new ValidationError(error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? "Maximum : 20 Mo par pièce jointe." : "Envoi invalide. Maximum : 10 pièces jointes de 20 Mo, 50 Mo au total.") : undefined));
  }, async (request, response) => {
    let input = request.body;
    if (request.is("multipart/form-data")) {
      try { input = JSON.parse(request.body.message); }
      catch { throw new ValidationError("Message avec pièces jointes invalide."); }
    }
    const files = (request.files as Express.Multer.File[] | undefined) ?? [];
    const names = input?.fileNames;
    if (files.length && (!Array.isArray(names) || names.length !== files.length || names.some(name => typeof name !== "string"))) throw new ValidationError("La liste des pièces jointes est invalide.");
    response.status(201).json(await service.submit(request.params.id, input, files.map((file, index) => ({ name: names[index], buffer: file.buffer }))));
  });
  router.get("/chats/:id/prompts/:promptId/attachments/:attachmentId", async (request, response) => {
    const file = await service.attachment(request.params.id, request.params.promptId, request.params.attachmentId);
    if (file.kind === "document") response.attachment(file.name);
    else response.setHeader("Content-Disposition", "inline");
    response.type(file.mimeType).sendFile(file.path);
  });
  router.patch("/chats/:id/prompts/:promptId", (request, response) => { service.edit(request.params.id, request.params.promptId, request.body); response.json({ saved: true }); });
  router.post("/chats/:id/prompts/:promptId/cancel", (request, response) => { service.cancel(request.params.id, request.params.promptId); response.json({ cancelled: true }); });
  router.post("/chats/:id/prompts/:promptId/retry", (request, response) => { service.retry(request.params.id, request.params.promptId); response.json({ queued: true }); });
  router.post("/chats/:id/prompts/:promptId/force", (request, response) => { service.forceNow(request.params.id, request.params.promptId); response.json(service.detail(request.params.id)); });
  return router;
}

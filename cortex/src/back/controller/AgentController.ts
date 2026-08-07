import { Router, type Request, type Response } from "express";
import type { AgentService } from "../engine/service/iaService/AgentService.ts";

interface AskAgentRequestBody {
  prompt?: unknown;
  model?: unknown;
}

export function createAgentController(agentService: AgentService): Router {
  const router = Router();

  router.get("/status", async (_request: Request, response: Response) => {
    try {
      response.json(await agentService.getStatus());
    } catch (error) {
      console.error("Impossible de detecter le moteur IA :", error);
      response.status(500).json({
        engine: null,
        label: null,
        error: "Impossible de detecter le moteur IA."
      });
    }
  });

  router.post(
    "/ask",
    async (
      request: Request<Record<string, never>, unknown, AskAgentRequestBody>,
      response: Response
    ) => {
      const prompt = typeof request.body.prompt === "string"
        ? request.body.prompt.trim()
        : "";
      const model = typeof request.body.model === "string" && request.body.model.trim()
        ? request.body.model.trim()
        : undefined;

      if (!prompt) {
        response.status(400).json({ error: "Le prompt est obligatoire." });
        return;
      }

      try {
        response.json({ answer: await agentService.ask(prompt, model) });
      } catch (error) {
        console.error("Impossible d'obtenir une reponse du moteur IA :", error);
        response.status(503).json({
          error: error instanceof Error
            ? error.message
            : "Le moteur IA est indisponible."
        });
      }
    }
  );

  return router;
}

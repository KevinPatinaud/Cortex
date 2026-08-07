import { Router, type Request, type Response } from "express";
import type { CopilotService } from "../engine/service/iaService/CopilotService.ts";

interface AskAgentRequestBody {
  prompt?: unknown;
  model?: unknown;
}

export function createAgentController(copilotService: CopilotService): Router {
  const router = Router();

  router.post(
    "/ask",
    async (
      request: Request<Record<string, never>, unknown, AskAgentRequestBody>,
      response: Response
    ) => {
      const prompt = typeof request.body.prompt === "string"
        ? request.body.prompt.trim()
        : "";
      const model = typeof request.body.model === "string"
        ? request.body.model
        : "gpt-5.6-luna";

      if (!prompt) {
        response.status(400).json({ error: "Le prompt est obligatoire." });
        return;
      }

      try {
        response.json({ answer: await copilotService.ask(prompt, model) });
      } catch (error) {
        console.error("Impossible d'obtenir une reponse de Copilot :", error);
        response.status(503).json({
          error: "Copilot est indisponible. Verifiez que vous etes connecte a Copilot CLI."
        });
      }
    }
  );

  return router;
}

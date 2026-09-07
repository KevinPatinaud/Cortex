import { Router } from "express";
import type { GmailService } from "../../../application/service/gmail/GmailService.ts";

export function createGmailController(gmail: GmailService): Router {
  const router = Router();
  const origin = new URL(gmail.redirectUri).origin;
  router.use((request, response, next) => {
    response.set("Cache-Control", "no-store");
    // A fixed origin also prevents DNS rebinding against an unauthenticated local server.
    if (request.get("host") !== new URL(origin).host ||
      (request.method !== "GET" && request.get("origin") !== origin)) {
      response.status(403).json({ error: `Ouvrez Cortex depuis ${origin} pour connecter Gmail.` });
      return;
    }
    next();
  });
  router.get("/status", (request, response) => { response.json(gmail.status(typeof request.query.projectId === "string" ? request.query.projectId : undefined)); });
  router.post("/configure", (request, response) => { gmail.configure(request.body); response.json({ configured: true }); });
  router.post("/connect", (request, response) => {
    const { url, state } = gmail.authorize(typeof request.body?.projectId === "string" ? request.body.projectId : "");
    response.cookie("cortex_gmail_oauth", state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/api/gmail/callback", maxAge: 600_000 });
    response.json({ url });
  });
  router.get("/callback", async (request, response) => {
    const cookie = request.headers.cookie?.split(";").map(s => s.trim()).find(s => s.startsWith("cortex_gmail_oauth="))?.slice("cortex_gmail_oauth=".length) ?? "";
    response.clearCookie("cortex_gmail_oauth", { path: "/api/gmail/callback" });
    try {
      const projectId = await gmail.callback(String(request.query.code ?? ""), String(request.query.state ?? ""), cookie);
      response.redirect(`/?${new URLSearchParams({ project: projectId, gmail: "connected" })}`);
    } catch {
      response.status(400).type("text/plain").send("Connexion Gmail refusée ou expirée. Revenez dans Cortex et recommencez la connexion en accordant les accès demandés.");
    }
  });
  router.post("/disconnect", async (_request, response) => { await gmail.disconnect(); response.json({ connected: false }); });
  router.get("/threads", async (request, response) => { response.json(await gmail.listThreads(String(request.query.q ?? ""))); });
  router.post("/watches", async (request, response) => {
    if (typeof request.body?.projectId !== "string") { response.status(400).json({ error: "Projet requis." }); return; }
    response.status(201).json(await gmail.watch(request.body.projectId, request.body));
  });
  router.delete("/watches/:id", (request, response) => { gmail.removeWatch(request.params.id); response.json({ removed: true }); });
  router.post("/send", async (request, response) => { response.json(await gmail.send(request.body)); });
  return router;
}

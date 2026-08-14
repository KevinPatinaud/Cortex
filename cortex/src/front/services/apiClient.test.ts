import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, requestJson } from "./apiClient.ts";

test("retourne le JSON d'une réponse réussie", async () => {
  const result = await requestJson<{ value: number }>(
    "/api/test",
    undefined,
    async () => new Response(JSON.stringify({ value: 42 }), { status: 200 })
  );
  assert.deepEqual(result, { value: 42 });
});

test("accepte null comme une réponse JSON valide", async () => {
  const result = await requestJson<null>(
    "/api/test",
    undefined,
    async () => new Response("null", { status: 200 })
  );
  assert.equal(result, null);
});

test("conserve le message et le statut d'une erreur API", async () => {
  await assert.rejects(
    requestJson("/api/test", undefined, async () =>
      new Response(JSON.stringify({ error: "Projet introuvable." }), {
        status: 404
      })
    ),
    (error: unknown) =>
      error instanceof ApiRequestError &&
      error.status === 404 &&
      error.message === "Projet introuvable."
  );
});

test("signale explicitement une réponse réussie qui n'est pas du JSON", async () => {
  await assert.rejects(
    requestJson("/api/test", undefined, async () =>
      new Response("<html></html>", { status: 200 })
    ),
    /invalid response/
  );
});

test("distingue une panne réseau d'une erreur HTTP", async () => {
  await assert.rejects(
    requestJson("/api/test", undefined, async () => {
      throw new Error("connexion refusée");
    }),
    (error: unknown) =>
      error instanceof ApiRequestError &&
      error.status === null &&
      error.message.includes("connexion refusée")
  );
});

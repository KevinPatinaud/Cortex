import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundError } from "../../../application/error/NotFoundError.ts";
import { ValidationError } from "../../../application/error/ValidationError.ts";
import { toHttpError, type ErrorMappingOptions } from "./HttpErrorMapper.ts";

const options: ErrorMappingOptions = {
  fallbackStatus: 500,
  fallbackMessage: "Erreur interne.",
  logMessage: "Erreur :"
};

test("convertit les erreurs métier sans demander de journalisation", () => {
  assert.deepEqual(
    toHttpError(new ValidationError("Entrée invalide."), options),
    {
      status: 400,
      body: { error: "Entrée invalide." },
      shouldLog: false
    }
  );
  assert.deepEqual(
    toHttpError(new NotFoundError("Ressource absente."), options),
    {
      status: 404,
      body: { error: "Ressource absente." },
      shouldLog: false
    }
  );
});

test("retourne une erreur 400 pour un JSON mal formé", () => {
  assert.deepEqual(
    toHttpError({ type: "entity.parse.failed", status: 400 }, options),
    {
      status: 400,
      body: { error: "The JSON request body is invalid." },
      shouldLog: false
    }
  );
});

test("retourne une erreur 413 pour un corps trop volumineux", () => {
  assert.deepEqual(
    toHttpError({ type: "entity.too.large", status: 413 }, options),
    {
      status: 413,
      body: { error: "The request body exceeds the allowed size." },
      shouldLog: false
    }
  );
});

test("masque les erreurs inattendues", () => {
  assert.deepEqual(toHttpError(new Error("secret"), options), {
    status: 500,
    body: { error: "Erreur interne." },
    shouldLog: true
  });
});

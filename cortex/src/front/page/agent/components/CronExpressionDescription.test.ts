import assert from "node:assert/strict";
import test from "node:test";
import { describeCronExpression } from "./CronExpressionDescription.ts";

test("explique une planification en semaine à heure fixe", () => {
  assert.equal(
    describeCronExpression("0 9 * * 1-5", "fr"),
    "Du lundi au vendredi à 09:00."
  );
  assert.equal(
    describeCronExpression("0 9 * * 1-5", "en"),
    "Monday through Friday at 09:00."
  );
});

test("explique les intervalles courants", () => {
  assert.equal(
    describeCronExpression("*/15 * * * *", "fr"),
    "Toutes les 15 minutes."
  );
  assert.equal(
    describeCronExpression("30 */6 * * *", "fr"),
    "Toutes les 6 heures, à la minute 30."
  );
});

test("explique les dates mensuelles et annuelles", () => {
  assert.equal(
    describeCronExpression("0 8 15 * *", "fr"),
    "Le 15 de chaque mois à 08:00."
  );
  assert.equal(
    describeCronExpression("0 8 25 12 *", "fr"),
    "Chaque année, le 25 décembre à 08:00."
  );
});

test("nomme les listes et plages de jours", () => {
  assert.equal(
    describeCronExpression("30 10 * * 1,3,5", "fr"),
    "Le lundi, le mercredi et le vendredi à 10:30."
  );
  assert.equal(
    describeCronExpression("0 12 * * 2-4", "fr"),
    "Du mardi au jeudi à 12:00."
  );
});

test("ne décrit pas une expression incomplète ou invalide", () => {
  assert.equal(describeCronExpression("0 9 * *", "fr"), null);
  assert.equal(describeCronExpression("70 9 * * *", "fr"), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { ValidationError } from "../../error/ValidationError.ts";
import {
  cronMatchesDate,
  getNextCronOccurrence,
  normalizeCronExpression
} from "./CronExpression.ts";

test("normalise et valide une expression cron standard à cinq champs", () => {
  assert.equal(normalizeCronExpression("  */15   8-18 * * 1-5 "), "*/15 8-18 * * 1-5");
  assert.throws(() => normalizeCronExpression("0 8 * *"), ValidationError);
  assert.throws(() => normalizeCronExpression("61 8 * * *"), ValidationError);
});

test("reconnaît les listes, intervalles, pas et dimanche 7", () => {
  const mondayMorning = new Date(2026, 7, 17, 8, 30, 0);
  const sundayMorning = new Date(2026, 7, 16, 8, 30, 0);

  assert.equal(cronMatchesDate("0,30 8-10/2 * * 1-5", mondayMorning), true);
  assert.equal(cronMatchesDate("30 8 * * 7", sundayMorning), true);
  assert.equal(cronMatchesDate("0 8 * * 1-5", sundayMorning), false);
});

test("calcule la prochaine occurrence à la minute suivante", () => {
  const after = new Date(2026, 7, 14, 9, 59, 42);
  const next = getNextCronOccurrence("0 10 * * 1-5", after);

  assert.deepEqual(next, new Date(2026, 7, 14, 10, 0, 0));
});

test("applique la règle cron OU entre jour du mois et jour de semaine", () => {
  const mondayNotFirst = new Date(2026, 7, 17, 9, 0, 0);

  assert.equal(cronMatchesDate("0 9 1 * 1", mondayNotFirst), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { ValidationError } from "../../error/ValidationError.ts";
import {
  cronMatchesDate,
  getNextCronOccurrence,
  normalizeCronExpression,
  normalizeScheduleTimezone
} from "./CronExpression.ts";

test("uses the selected timezone across dates and fractional offsets", () => {
  assert.equal(getNextCronOccurrence("0 9 * * *", new Date("2026-09-07T00:00:00Z"), "Europe/Paris").toISOString(), "2026-09-07T07:00:00.000Z");
  assert.equal(getNextCronOccurrence("0 9 * * *", new Date("2026-01-07T00:00:00Z"), "Europe/Paris").toISOString(), "2026-01-07T08:00:00.000Z");
  assert.equal(getNextCronOccurrence("0 9 * * *", new Date("2026-09-07T00:00:00Z"), "Asia/Kathmandu").toISOString(), "2026-09-07T03:15:00.000Z");
  assert.equal(cronMatchesDate("0 0 * * 2", new Date("2026-09-07T22:00:00Z"), "Europe/Paris"), true);
  assert.throws(() => normalizeScheduleTimezone("Mars/Olympus"), ValidationError);
  assert.throws(() => normalizeScheduleTimezone(null), ValidationError);
});

test("skips missing DST times and previews both repeated absolute occurrences", () => {
  assert.equal(getNextCronOccurrence("30 2 * * *", new Date("2026-03-29T00:00:00Z"), "Europe/Paris").toISOString(), "2026-03-30T00:30:00.000Z");
  const first = getNextCronOccurrence("30 2 * * *", new Date("2026-10-25T00:00:00Z"), "Europe/Paris");
  const second = getNextCronOccurrence("30 2 * * *", first, "Europe/Paris");
  assert.equal(first.toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal(second.toISOString(), "2026-10-25T01:30:00.000Z");
  for (const date of [first, second]) assert.equal(cronMatchesDate("30 2 * * *", date, "Europe/Paris"), true);
  assert.equal(getNextCronOccurrence("30 2 * * *", new Date("2026-10-03T14:00:00Z"), "Australia/Lord_Howe").toISOString(), "2026-10-03T15:30:00.000Z");
});

test("handles leap days and rejects schedules without an occurrence", () => {
  assert.equal(getNextCronOccurrence("0 9 29 2 *", new Date("2026-03-01T00:00:00Z"), "UTC").toISOString(), "2028-02-29T09:00:00.000Z");
  assert.throws(() => getNextCronOccurrence("0 9 31 2 *", new Date("2026-03-01T00:00:00Z"), "UTC"), ValidationError);
});

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

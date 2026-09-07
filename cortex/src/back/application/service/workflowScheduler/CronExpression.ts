import { ValidationError } from "../../error/ValidationError.ts";

interface CronFieldDefinition {
  label: string;
  minimum: number;
  maximum: number;
  normalize?: (value: number) => number;
}

interface ParsedCronField {
  values: Set<number>;
  wildcard: boolean;
}

interface ParsedCronExpression {
  minute: ParsedCronField;
  hour: ParsedCronField;
  dayOfMonth: ParsedCronField;
  month: ParsedCronField;
  dayOfWeek: ParsedCronField;
}

const FIELD_DEFINITIONS: CronFieldDefinition[] = [
  { label: "minute", minimum: 0, maximum: 59 },
  { label: "hour", minimum: 0, maximum: 23 },
  { label: "day of month", minimum: 1, maximum: 31 },
  { label: "month", minimum: 1, maximum: 12 },
  {
    label: "day of week",
    minimum: 0,
    maximum: 7,
    normalize: (value) => value === 7 ? 0 : value
  }
];

const MAX_NEXT_OCCURRENCE_MINUTES = 60 * 24 * 366 * 8;

export function normalizeCronExpression(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("The cron expression must be a string.");
  }

  const expression = value.trim().replace(/\s+/g, " ");
  parseCronExpression(expression);
  return expression;
}

export function normalizeScheduleTimezone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError("A valid IANA schedule timezone is required.");
  }
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    throw new ValidationError("The schedule timezone is invalid.");
  }
}

export function serverTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function zonedClock(timezone: string): (date: Date) => Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  return (date) => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
    return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute));
  };
}

export function cronMatchesDate(expression: string, date: Date, timezone = serverTimezone()): boolean {
  return parsedCronMatchesDate(parseCronExpression(expression), zonedClock(timezone)(date));
}

export function getNextCronOccurrence(
  expression: string,
  after = new Date(),
  timezone = serverTimezone()
): Date {
  const parsed = parseCronExpression(expression);
  const maximumMonthDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (parsed.dayOfWeek.wildcard && ![...parsed.month.values].some((month) =>
    [...parsed.dayOfMonth.values].some((day) => day <= maximumMonthDays[month - 1])
  )) {
    throw new ValidationError("The cron expression has no occurrence in the supported date range.");
  }
  const clock = zonedClock(timezone);
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  if (!Number.isFinite(start)) throw new ValidationError("The schedule date is invalid.");

  for (
    let elapsedMinutes = 0;
    elapsedMinutes < MAX_NEXT_OCCURRENCE_MINUTES;
    elapsedMinutes += 60
  ) {
    const windowStart = start + elapsedMinutes * 60_000;
    // Inspect both ends before skipping an hour, including fractional offsets
    // and daylight-saving transitions. All iteration uses absolute UTC minutes.
    const first = clock(new Date(windowStart));
    const last = clock(new Date(windowStart + 59 * 60_000));
    const stableOffset = last.getTime() - first.getTime() === 59 * 60_000;
    if (stableOffset && !parsedCronMatchesDate(parsed, first, true) && !parsedCronMatchesDate(parsed, last, true)) continue;
    for (let minute = 0; minute < 60; minute++) {
      const candidate = new Date(windowStart + minute * 60_000);
      if (parsedCronMatchesDate(parsed, clock(candidate))) return candidate;
    }
  }

  throw new ValidationError(
    "The cron expression has no occurrence in the supported date range."
  );
}

function parseCronExpression(expression: string): ParsedCronExpression {
  const fields = expression.split(" ");

  if (fields.length !== FIELD_DEFINITIONS.length) {
    throw new ValidationError(
      "The cron expression must contain 5 fields: minute, hour, day, month and weekday."
    );
  }

  const parsedFields = fields.map((field, index) =>
    parseCronField(field, FIELD_DEFINITIONS[index])
  );

  return {
    minute: parsedFields[0],
    hour: parsedFields[1],
    dayOfMonth: parsedFields[2],
    month: parsedFields[3],
    dayOfWeek: parsedFields[4]
  };
}

function parseCronField(
  field: string,
  definition: CronFieldDefinition
): ParsedCronField {
  if (!field) {
    throw new ValidationError(`The cron ${definition.label} field is empty.`);
  }

  const values = new Set<number>();

  for (const segment of field.split(",")) {
    const [rangePart, stepPart, ...extraParts] = segment.split("/");

    if (extraParts.length > 0 || !rangePart) {
      throwInvalidField(definition);
    }

    const step = stepPart === undefined
      ? 1
      : readInteger(stepPart, definition);

    if (step < 1) {
      throwInvalidField(definition);
    }

    let start: number;
    let end: number;

    if (rangePart === "*") {
      start = definition.minimum;
      end = definition.maximum;
    } else if (rangePart.includes("-")) {
      const rangeValues = rangePart.split("-");

      if (rangeValues.length !== 2) {
        throwInvalidField(definition);
      }

      start = readInteger(rangeValues[0], definition);
      end = readInteger(rangeValues[1], definition);
    } else {
      start = readInteger(rangePart, definition);
      end = stepPart === undefined ? start : definition.maximum;
    }

    if (
      start < definition.minimum ||
      end > definition.maximum ||
      start > end
    ) {
      throwInvalidField(definition);
    }

    for (let value = start; value <= end; value += step) {
      values.add(definition.normalize?.(value) ?? value);
    }
  }

  return { values, wildcard: field === "*" };
}

function readInteger(
  value: string,
  definition: CronFieldDefinition
): number {
  if (!/^\d+$/.test(value)) {
    throwInvalidField(definition);
  }

  return Number(value);
}

function throwInvalidField(definition: CronFieldDefinition): never {
  throw new ValidationError(
    `The cron ${definition.label} field is invalid (expected ${definition.minimum}-${definition.maximum}).`
  );
}

function parsedCronMatchesDate(
  parsed: ParsedCronExpression,
  date: Date,
  ignoreMinute = false
): boolean {
  const dayOfMonthMatches = parsed.dayOfMonth.values.has(date.getUTCDate());
  const dayOfWeekMatches = parsed.dayOfWeek.values.has(date.getUTCDay());
  const dayMatches = parsed.dayOfMonth.wildcard
    ? dayOfWeekMatches
    : parsed.dayOfWeek.wildcard
      ? dayOfMonthMatches
      : dayOfMonthMatches || dayOfWeekMatches;

  return (ignoreMinute || parsed.minute.values.has(date.getUTCMinutes())) &&
    parsed.hour.values.has(date.getUTCHours()) &&
    dayMatches &&
    parsed.month.values.has(date.getUTCMonth() + 1);
}

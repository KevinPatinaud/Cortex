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

export function cronMatchesDate(expression: string, date: Date): boolean {
  const parsed = parseCronExpression(expression);
  const dayOfMonthMatches = parsed.dayOfMonth.values.has(date.getDate());
  const dayOfWeekMatches = parsed.dayOfWeek.values.has(date.getDay());
  const dayMatches = parsed.dayOfMonth.wildcard
    ? dayOfWeekMatches
    : parsed.dayOfWeek.wildcard
      ? dayOfMonthMatches
      : dayOfMonthMatches || dayOfWeekMatches;

  return parsed.minute.values.has(date.getMinutes()) &&
    parsed.hour.values.has(date.getHours()) &&
    dayMatches &&
    parsed.month.values.has(date.getMonth() + 1);
}

export function getNextCronOccurrence(
  expression: string,
  after = new Date()
): Date {
  const parsed = parseCronExpression(expression);
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (
    let elapsedMinutes = 0;
    elapsedMinutes < MAX_NEXT_OCCURRENCE_MINUTES;
    elapsedMinutes += 1
  ) {
    if (parsedCronMatchesDate(parsed, candidate)) {
      return candidate;
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
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
  date: Date
): boolean {
  const dayOfMonthMatches = parsed.dayOfMonth.values.has(date.getDate());
  const dayOfWeekMatches = parsed.dayOfWeek.values.has(date.getDay());
  const dayMatches = parsed.dayOfMonth.wildcard
    ? dayOfWeekMatches
    : parsed.dayOfWeek.wildcard
      ? dayOfMonthMatches
      : dayOfMonthMatches || dayOfWeekMatches;

  return parsed.minute.values.has(date.getMinutes()) &&
    parsed.hour.values.has(date.getHours()) &&
    dayMatches &&
    parsed.month.values.has(date.getMonth() + 1);
}

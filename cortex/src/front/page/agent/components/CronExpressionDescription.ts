import type { Language } from "../../../i18n.tsx";

interface CronParts {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

const monthNames = {
  fr: [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre"
  ],
  en: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ]
} satisfies Record<Language, string[]>;

const weekdayNames = {
  fr: [
    "dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"
  ],
  en: [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
  ]
} satisfies Record<Language, string[]>;

export function describeCronExpression(
  expression: string,
  language: Language
): string | null {
  const fields = expression.trim().split(/\s+/);

  if (
    fields.length !== 5 ||
    !isValidField(fields[0], 0, 59) ||
    !isValidField(fields[1], 0, 23) ||
    !isValidField(fields[2], 1, 31) ||
    !isValidField(fields[3], 1, 12) ||
    !isValidField(fields[4], 0, 7)
  ) {
    return null;
  }

  const parts: CronParts = {
    minute: fields[0],
    hour: fields[1],
    dayOfMonth: fields[2],
    month: fields[3],
    dayOfWeek: fields[4]
  };
  const intervalDescription = describeSimpleInterval(parts, language);

  if (intervalDescription) {
    return intervalDescription;
  }

  const time = describeFixedTime(parts.minute, parts.hour);

  if (time) {
    return describeFixedTimeSchedule(parts, time, language);
  }

  return describeFieldByField(parts, language);
}

function describeSimpleInterval(
  parts: CronParts,
  language: Language
): string | null {
  const minuteStep = readWildcardStep(parts.minute);
  const hourStep = readWildcardStep(parts.hour);
  const everyDay = parts.dayOfMonth === "*" &&
    parts.month === "*" &&
    parts.dayOfWeek === "*";

  if (minuteStep && parts.hour === "*" && everyDay) {
    return language === "fr"
      ? `Toutes les ${minuteStep} minutes.`
      : `Every ${minuteStep} minutes.`;
  }

  if (/^\d+$/.test(parts.minute) && hourStep && everyDay) {
    const minute = Number(parts.minute);

    return language === "fr"
      ? `Toutes les ${hourStep} heures, à la minute ${pad(minute)}.`
      : `Every ${hourStep} hours, at minute ${pad(minute)}.`;
  }

  return null;
}

function describeFixedTimeSchedule(
  parts: CronParts,
  time: string,
  language: Language
): string {
  const everyMonth = parts.month === "*";
  const everyDayOfMonth = parts.dayOfMonth === "*";
  const everyWeekday = parts.dayOfWeek === "*";

  if (everyDayOfMonth && everyMonth && everyWeekday) {
    return language === "fr"
      ? `Tous les jours à ${time}.`
      : `Every day at ${time}.`;
  }

  if (everyDayOfMonth && everyMonth) {
    const weekdays = describeWeekdays(parts.dayOfWeek, language);
    return language === "fr"
      ? `${capitalize(weekdays)} à ${time}.`
      : `${capitalize(weekdays)} at ${time}.`;
  }

  if (everyWeekday && everyMonth && /^\d+$/.test(parts.dayOfMonth)) {
    return language === "fr"
      ? `Le ${Number(parts.dayOfMonth)} de chaque mois à ${time}.`
      : `On day ${Number(parts.dayOfMonth)} of every month at ${time}.`;
  }

  if (
    everyWeekday &&
    /^\d+$/.test(parts.dayOfMonth) &&
    /^\d+$/.test(parts.month)
  ) {
    const month = monthNames[language][Number(parts.month) - 1];
    return language === "fr"
      ? `Chaque année, le ${Number(parts.dayOfMonth)} ${month} à ${time}.`
      : `Every year on ${month} ${Number(parts.dayOfMonth)} at ${time}.`;
  }

  return describeFieldByField(parts, language, time);
}

function describeFieldByField(
  parts: CronParts,
  language: Language,
  fixedTime?: string
): string {
  const descriptions: string[] = [];

  if (fixedTime) {
    descriptions.push(language === "fr" ? `à ${fixedTime}` : `at ${fixedTime}`);
  } else {
    descriptions.push(language === "fr"
      ? `minutes ${describeNumericField(parts.minute, "chaque minute", "toutes les", language)}`
      : `minutes ${describeNumericField(parts.minute, "every minute", "every", language)}`);
    descriptions.push(language === "fr"
      ? `heures ${describeNumericField(parts.hour, "chaque heure", "toutes les", language)}`
      : `hours ${describeNumericField(parts.hour, "every hour", "every", language)}`);
  }

  if (parts.dayOfMonth !== "*") {
    descriptions.push(language === "fr"
      ? `jours du mois ${formatNumberExpression(parts.dayOfMonth)}`
      : `days of month ${formatNumberExpression(parts.dayOfMonth)}`);
  }

  if (parts.month !== "*") {
    descriptions.push(language === "fr"
      ? `mois ${formatNamedExpression(parts.month, monthNames.fr, 1)}`
      : `months ${formatNamedExpression(parts.month, monthNames.en, 1)}`);
  }

  if (parts.dayOfWeek !== "*") {
    descriptions.push(describeWeekdays(parts.dayOfWeek, language));
  }

  return `${capitalize(descriptions.join(language === "fr" ? ", " : ", "))}.`;
}

function describeWeekdays(expression: string, language: Language): string {
  const names = weekdayNames[language];

  if (expression === "1-5") {
    return language === "fr" ? "du lundi au vendredi" : "Monday through Friday";
  }

  if (expression === "0,6" || expression === "6,0" || expression === "6-7") {
    return language === "fr" ? "le week-end" : "on weekends";
  }

  if (/^\d$/.test(expression)) {
    const name = names[normalizeWeekday(Number(expression))];
    return language === "fr" ? `le ${name}` : `on ${name}`;
  }

  const rangeMatch = /^(\d)-(\d)$/.exec(expression);

  if (rangeMatch) {
    const firstName = names[normalizeWeekday(Number(rangeMatch[1]))];
    const lastName = names[normalizeWeekday(Number(rangeMatch[2]))];
    return language === "fr"
      ? `du ${firstName} au ${lastName}`
      : `${firstName} through ${lastName}`;
  }

  if (/^\d(?:,\d)+$/.test(expression)) {
    const selectedNames = expression.split(",").map((value) =>
      names[normalizeWeekday(Number(value))]
    );

    if (language === "fr") {
      return joinNaturally(selectedNames.map((name) => `le ${name}`), "et");
    }

    return `on ${joinNaturally(selectedNames, "and")}`;
  }

  const formatted = formatNamedExpression(expression, names, 0, true);
  return language === "fr" ? `jours ${formatted}` : `on ${formatted}`;
}

function normalizeWeekday(value: number): number {
  return value === 7 ? 0 : value;
}

function joinNaturally(values: string[], conjunction: string): string {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} ${conjunction} ${values.at(-1)}`;
}

function describeNumericField(
  expression: string,
  wildcardLabel: string,
  stepLabel: string,
  _language: Language
): string {
  if (expression === "*") return wildcardLabel;
  const step = readWildcardStep(expression);
  if (step) return `${stepLabel} ${step}`;
  return formatNumberExpression(expression);
}

function describeFixedTime(minute: string, hour: string): string | null {
  return /^\d+$/.test(minute) && /^\d+$/.test(hour)
    ? `${pad(Number(hour))}:${pad(Number(minute))}`
    : null;
}

function formatNumberExpression(expression: string): string {
  return expression.replace(/-/g, "–").replace(/\//g, "/");
}

function formatNamedExpression(
  expression: string,
  names: string[],
  offset: number,
  sundayIsSeven = false
): string {
  return expression.split(",").map((segment) => {
    const [range, step] = segment.split("/");
    const formattedRange = range.split("-").map((rawValue) => {
      const value = Number(rawValue);
      const normalizedValue = sundayIsSeven && value === 7 ? 0 : value;
      return names[normalizedValue - offset] ?? rawValue;
    }).join("–");
    return step ? `${formattedRange}/${step}` : formattedRange;
  }).join(", ");
}

function isValidField(field: string, minimum: number, maximum: number): boolean {
  if (!field) return false;

  return field.split(",").every((segment) => {
    const parts = segment.split("/");
    if (parts.length > 2 || !parts[0]) return false;
    if (parts[1] !== undefined && (!/^\d+$/.test(parts[1]) || Number(parts[1]) < 1)) {
      return false;
    }

    if (parts[0] === "*") return true;
    const range = parts[0].split("-");
    if (range.length > 2 || range.some((value) => !/^\d+$/.test(value))) {
      return false;
    }

    const start = Number(range[0]);
    const end = Number(range.at(-1));
    return start >= minimum && end <= maximum && start <= end;
  });
}

function readWildcardStep(field: string): number | null {
  const match = /^\*\/(\d+)$/.exec(field);
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

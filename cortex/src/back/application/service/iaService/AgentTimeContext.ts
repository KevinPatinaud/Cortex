import { normalizeScheduleTimezone, serverTimezone } from "../workflowScheduler/CronExpression.ts";

export function readAgentTimezone(value = process.env.CORTEX_TIMEZONE): string {
  return normalizeScheduleTimezone(value?.trim() || serverTimezone());
}

export function createAgentTimeContext(now: Date, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "longOffset"
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const offset = parts.timeZoneName.replace("GMT", "") || "+00:00";
  const milliseconds = String(now.getUTCMilliseconds()).padStart(3, "0");
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}${offset}`;
  return `Cortex time context:
- Current local time (${timezone}): ${local}.
- Current UTC time: ${now.toISOString()}.
These are the same instant. Use the local time and date for user-facing references to now, today and local deadlines unless the task explicitly specifies another timezone. Convert UTC tool timestamps to the requested timezone exactly once. Use the IANA timezone rules for future dates, including daylight-saving changes; do not assume today's offset applies year-round. Waiting deadlines must be ISO 8601 timestamps with Z or an explicit UTC offset.`;
}

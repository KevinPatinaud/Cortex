export type ScheduleFrequency = "daily" | "weekdays" | "weekly" | "monthly" | "hourly" | "custom";

export function readScheduleForm(cron: string): { frequency: ScheduleFrequency; time: string; day: string } {
  const fields = cron.trim().split(/\s+/);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const fallback = { frequency: "custom" as const, time: "09:00", day: "1" };
  if (fields.length !== 5) return fallback;
  if (fields.join(" ") === "0 * * * *") return { ...fallback, frequency: "hourly" };
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || Number(minute) > 59 || Number(hour) > 23 || month !== "*") return fallback;
  const time = `${String(Number(hour)).padStart(2, "0")}:${String(Number(minute)).padStart(2, "0")}`;
  if (dayOfMonth === "*") {
    if (dayOfWeek === "*") return { frequency: "daily", time, day: "1" };
    if (dayOfWeek === "1-5") return { frequency: "weekdays", time, day: "1" };
    if (/^[0-7]$/.test(dayOfWeek)) return { frequency: "weekly", time, day: String(Number(dayOfWeek) % 7) };
  }
  if (/^\d+$/.test(dayOfMonth) && Number(dayOfMonth) >= 1 && Number(dayOfMonth) <= 31 && dayOfWeek === "*") {
    return { frequency: "monthly", time, day: String(Number(dayOfMonth)) };
  }
  return { ...fallback, time };
}

export function buildScheduleCron(frequency: Exclude<ScheduleFrequency, "custom">, time: string, day: string): string {
  const [hour, minute] = time.split(":").map(Number);
  if (frequency === "hourly") return "0 * * * *";
  return `${minute} ${hour} ${frequency === "monthly" ? day : "*"} * ${frequency === "weekly" ? day : frequency === "weekdays" ? "1-5" : "*"}`;
}

import { refine, regex, string } from "zod/mini";

/*
 * Date and time formats shared by the appointment and shop schemas. Internal: not re-exported from
 * the package index. A module of their own so the shop schemas, which the web landing page needs at
 * boot, do not pull the appointment schemas into its initial bundle (BENCHMARKS.md §76).
 */

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return true;
  const [yearStr = "", monthStr = "", dayStr = ""] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= daysInMonth;
}

export const dateSchema = string().check(
  regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format"),
  refine(isValidCalendarDate, { message: "Date must be a valid calendar date" }),
);
export const timeSchema = string().check(
  regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Booking time must be in 24h HH:mm format"),
);

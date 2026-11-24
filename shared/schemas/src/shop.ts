import { array, gte, lte, minLength, number, object, string, type infer as zInfer } from "zod/mini";
import { omittedAsEmptyString } from "./catalog";
import { timeSchema } from "./formats";

/** One weekday's hours in the shop info: ISO weekday (1 = Monday) and HH:mm opening/closing times. */
export const openingHoursSchema = object({
  dayOfWeek: number().check(gte(1), lte(7)),
  opens: timeSchema,
  closes: timeSchema,
});

/**
 * GET /api/v1/appointments/public/shop response: the IANA time zone every booking is read in, how
 * many days ahead a booking may be made, and the weekdays the shop is open (a missing one is closed).
 */
export const shopInfoResponseSchema = object({
  timeZone: string().check(minLength(1)),
  maxAdvanceDays: number().check(gte(1)),
  openingHours: array(openingHoursSchema),
  // The owner's promo strip for the landing pages; "" when there is none (omitted when null).
  announcement: omittedAsEmptyString(),
});

export type ShopInfoResponse = zInfer<typeof shopInfoResponseSchema>;

package com.example.taskflow.appointment;

import org.jspecify.annotations.Nullable;

import java.util.List;

/**
 * Public facts a booking client needs to apply the shop's rules the way the server does, instead
 * of hard-coding them.
 *
 * @param timeZone       IANA id of the shop's time zone ({@code app.shop.time-zone}); every booking date and time
 *                       is a wall-clock value in it, and "is this slot in the past?" is decided in it
 * @param maxAdvanceDays how many days after today a booking may still be made ({@code app.booking.max-advance-days});
 *                       today plus this many days is the last bookable date
 * @param openingHours   one entry per weekday on which at least one barber works, Monday first; a weekday that
 *                       is missing is closed. Derived from the barbers' schedules, so it follows them.
 * @param announcement   the promo strip the owner set for the landing pages (at most 120 characters), or
 *                       absent when there is none; owned by the catalog module ({@code ShopAnnouncementService})
 */
record ShopInfoResponse(String timeZone, int maxAdvanceDays, List<OpeningHoursResponse> openingHours,
                        @Nullable String announcement) {}

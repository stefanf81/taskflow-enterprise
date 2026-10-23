package com.example.taskflow.appointment;

/**
 * Public facts a booking client needs to read dates the way the server does.
 *
 * @param timeZone IANA id of the shop's time zone ({@code app.shop.time-zone}); every booking date and time is
 *                 a wall-clock value in it, and "is this slot in the past?" is decided in it
 */
public record ShopInfoResponse(String timeZone) {}

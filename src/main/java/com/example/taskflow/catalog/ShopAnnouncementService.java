package com.example.taskflow.catalog;

/**
 * The landing pages' promo strip. Part of the catalog module's API: the appointment module adds
 * the current message to {@code GET /api/v1/appointments/public/shop}, which both clients already
 * load on their landing page, so the strip costs no request of its own.
 */
public interface ShopAnnouncementService {

    /** The current strip (cached; never null, its message is null when the strip is off). */
    AnnouncementResponse current();

    /** Sets the strip; a blank message turns it off. */
    AnnouncementResponse update(AnnouncementRequest request);
}

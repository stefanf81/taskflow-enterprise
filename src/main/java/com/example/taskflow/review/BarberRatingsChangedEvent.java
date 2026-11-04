package com.example.taskflow.review;

/**
 * Published inside a transaction that changes which reviews count towards a barber's rating (a new
 * review, or a reviewed appointment leaving or re-entering APPROVED). The cached ratings are evicted
 * once that transaction has committed.
 */
record BarberRatingsChangedEvent() {
}

package com.example.taskflow.catalog;

/** Published inside the catalog transaction; listeners invalidate committed views only after commit. */
public record CatalogChangedEvent(boolean availabilityChanged) {}

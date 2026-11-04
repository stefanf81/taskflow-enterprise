/**
 * Customer reviews and per-barber ratings.
 */
@ApplicationModule(allowedDependencies = {"appointment", "core", "core :: cache"})
package com.example.taskflow.review;

import org.springframework.modulith.ApplicationModule;

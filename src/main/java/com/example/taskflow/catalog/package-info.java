/**
 * Services offered by the shop (name, price, duration) and the retail products it sells over the
 * counter (display only).
 */
@ApplicationModule(allowedDependencies = {"core", "core :: cache"})
package com.example.taskflow.catalog;

import org.springframework.modulith.ApplicationModule;

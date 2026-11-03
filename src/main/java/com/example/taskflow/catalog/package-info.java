/**
 * Services offered by the shop (name, price, duration).
 */
@ApplicationModule(allowedDependencies = {"core", "core :: cache"})
package com.example.taskflow.catalog;

import org.springframework.modulith.ApplicationModule;

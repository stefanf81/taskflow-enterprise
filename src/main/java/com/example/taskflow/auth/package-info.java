/**
 * Authentication, JWT/cookie/CSRF handling, login throttling and token revocation.
 */
@ApplicationModule(allowedDependencies = {"core", "core :: redis"})
package com.example.taskflow.auth;

import org.springframework.modulith.ApplicationModule;

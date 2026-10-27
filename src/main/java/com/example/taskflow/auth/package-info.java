/**
 * Authentication, JWT/cookie/CSRF handling, login throttling and token revocation.
 */
@ApplicationModule(allowedDependencies = {"core"})
package com.example.taskflow.auth;

import org.springframework.modulith.ApplicationModule;

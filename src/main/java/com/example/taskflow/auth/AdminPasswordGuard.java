package com.example.taskflow.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Refuses to start a production instance whose admin password is missing, the
 * well-known development default, or an unedited {@code .env.example} placeholder.
 *
 * <p>Enabled by {@code app.security.require-strong-admin-password=true}
 * (set in {@code application-prod.properties}), mirroring how
 * {@code app.rsa.require-persistent-keys} makes missing signing keys fatal.
 */
@Component
@ConditionalOnProperty(name = "app.security.require-strong-admin-password", havingValue = "true")
class AdminPasswordGuard {

    static final String DEV_DEFAULT = "admin-password";

    public AdminPasswordGuard(@Value("${spring.security.user.password:}") String adminPassword) {
        validate(adminPassword);
    }

    static void validate(String password) {
        if (password == null || password.isBlank()) {
            throw new IllegalStateException(
                    "SPRING_SECURITY_PASSWORD must be set to a strong value in this environment.");
        }
        if (DEV_DEFAULT.equals(password) || password.contains("CHANGE_ME")) {
            throw new IllegalStateException(
                    "SPRING_SECURITY_PASSWORD is still the development default or an .env.example "
                            + "placeholder; set a strong, unique value before starting in this environment.");
        }
    }
}

package com.example.taskflow.auth;

import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * The JWT signing key pair, bound from {@code app.rsa.*} (see {@link SecurityConfig}).
 *
 * <ul>
 *   <li>{@code private-key}: single-line Base64 of a PKCS#8 DER private key ({@code APP_RSA_PRIVATE_KEY}).</li>
 *   <li>{@code public-key}: Base64 of the X.509 SubjectPublicKeyInfo DER ({@code APP_RSA_PUBLIC_KEY}).</li>
 *   <li>{@code require-persistent-keys} (default {@code false}; {@code true} in prod): fail the start
 *       instead of generating an ephemeral pair when the keys are missing or unreadable.</li>
 * </ul>
 * A key that is absent is {@code null}; one set to an empty value is empty. Both mean "no key".
 */
@ConfigurationProperties(prefix = "app.rsa")
record RsaKeyProperties(
        @Nullable String privateKey,
        @Nullable String publicKey,
        @DefaultValue("false") boolean requirePersistentKeys) {
}

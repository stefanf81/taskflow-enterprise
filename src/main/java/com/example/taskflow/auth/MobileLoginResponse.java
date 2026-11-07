package com.example.taskflow.auth;

import org.jspecify.annotations.Nullable;

/**
 * Native-client authentication response. Unlike the web login response, the
 * bearer token is returned to the mobile app so it can be stored in the native
 * secure store and sent in the Authorization header.
 */
record MobileLoginResponse(
        String accessToken,
        String tokenType,
        long expiresIn,
        String username,
        String role,
        @Nullable String refreshToken
) {}

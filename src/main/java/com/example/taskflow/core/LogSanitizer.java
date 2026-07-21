package com.example.taskflow.core;

/**
 * Utilities for sanitising user-supplied strings before they reach log
 * statements. Prevents log injection (CRLF) and limits PII exposure.
 */
public final class LogSanitizer {

    private LogSanitizer() {}

    /**
     * Strip CR/LF characters that could inject fake log lines.
     */
    public static String stripNewlines(String input) {
        if (input == null) return null;
        return input.replaceAll("[\\r\\n]", "");
    }

    /**
     * Mask a string to "XX****XX" — useful for logging tokens, IDs, and
     * other sensitive identifiers without leaking full values.
     */
    public static String mask(String input) {
        if (input == null || input.length() <= 4) {
            return "****";
        }
        String safe = stripNewlines(input);
        if (safe.length() <= 4) {
            return "****";
        }
        return safe.substring(0, 2) + "****" + safe.substring(safe.length() - 2);
    }

    /**
     * Safely extract a loggable message from an exception, stripping newlines
     * and falling back to the exception's class name when the message is null.
     */
    public static String safeMessage(Throwable t) {
        if (t == null) return "unknown error";
        String msg = t.getMessage();
        return msg != null ? stripNewlines(msg) : t.getClass().getSimpleName();
    }
}

package com.example.taskflow.auth.internal;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Validates that a character sequence encodes to at most {@link #max()} UTF-8 bytes (BCrypt rejects
 * new passwords above 72 UTF-8 bytes). {@code null} is considered valid so {@code @NotBlank} owns
 * the required-field message.
 */
@Documented
@Constraint(validatedBy = Utf8ByteLengthValidator.class)
@Target({ElementType.FIELD, ElementType.RECORD_COMPONENT, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
public @interface Utf8ByteLength {

    String message() default "Must not exceed {max} UTF-8 bytes";

    int max();

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}

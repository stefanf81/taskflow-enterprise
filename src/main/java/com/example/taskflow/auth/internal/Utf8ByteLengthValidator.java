package com.example.taskflow.auth.internal;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.nio.charset.StandardCharsets;

public class Utf8ByteLengthValidator implements ConstraintValidator<Utf8ByteLength, CharSequence> {

    private int max;

    public Utf8ByteLengthValidator() {
    }

    @Override
    public void initialize(Utf8ByteLength annotation) {
        this.max = annotation.max();
    }

    @Override
    public boolean isValid(CharSequence value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        String text = value.toString();
        // Do not silently hash '?' in place of an unpaired UTF-16 surrogate.
        if (text.codePoints().anyMatch(point -> point >= 0xD800 && point <= 0xDFFF)) {
            return false;
        }
        return text.getBytes(StandardCharsets.UTF_8).length <= max;
    }
}

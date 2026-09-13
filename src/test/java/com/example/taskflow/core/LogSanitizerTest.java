package com.example.taskflow.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class LogSanitizerTest {

    @Test
    void testStripNewlines() {
        assertNull(LogSanitizer.stripNewlines(null));
        assertEquals("", LogSanitizer.stripNewlines(""));
        assertEquals("clean text", LogSanitizer.stripNewlines("clean text"));
        assertEquals("foobar", LogSanitizer.stripNewlines("foo\nbar"));
        assertEquals("foobar", LogSanitizer.stripNewlines("foo\rbar"));
        assertEquals("foobar", LogSanitizer.stripNewlines("foo\r\nbar"));
        assertEquals("multiplelinesremoved", LogSanitizer.stripNewlines("multiple\r\nlines\nremoved\r"));
    }

    @Test
    void testMask() {
        assertEquals("****", LogSanitizer.mask(null));
        assertEquals("****", LogSanitizer.mask(""));
        assertEquals("****", LogSanitizer.mask("a"));
        assertEquals("****", LogSanitizer.mask("abcd"));
        assertEquals("ab****de", LogSanitizer.mask("abcde"));
        assertEquals("to****12", LogSanitizer.mask("token-secret-12"));
        assertEquals("****", LogSanitizer.mask("a\r\nb\nc")); // length 6 shrinks to 3 after strip
        assertEquals("ab****de", LogSanitizer.mask("ab\r\nc\nde"));
    }

    @Test
    void testSafeMessage() {
        assertEquals("unknown error", LogSanitizer.safeMessage(null));
        assertEquals("NullPointerException", LogSanitizer.safeMessage(new NullPointerException()));
        assertEquals("Invalid argument value", LogSanitizer.safeMessage(new IllegalArgumentException("Invalid argument value")));
        assertEquals("line 1line 2", LogSanitizer.safeMessage(new RuntimeException("line 1\r\nline 2")));
        assertEquals("line 1line 2", LogSanitizer.safeMessage(new RuntimeException("line 1\nline 2")));
    }
}

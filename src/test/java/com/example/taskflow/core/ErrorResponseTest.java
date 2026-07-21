package com.example.taskflow.core;

import org.junit.jupiter.api.Test;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class ErrorResponseTest {

    @Test
    void testErrorResponseWithoutValidationErrors() {
        ErrorResponse response = new ErrorResponse(404, "Not Found", "Item not found", "/api/test");

        assertEquals(404, response.status());
        assertEquals("Not Found", response.error());
        assertEquals("Item not found", response.message());
        assertEquals("/api/test", response.path());
        assertNotNull(response.timestamp());
        assertNull(response.validationErrors());
    }

    @Test
    void testErrorResponseWithValidationErrors() {
        ErrorResponse.ValidationError validationError = new ErrorResponse.ValidationError("field", "message");
        ErrorResponse response = new ErrorResponse(400, "Bad Request", "Validation failed", "/api/test", Collections.singletonList(validationError));

        assertEquals(400, response.status());
        assertEquals(1, response.validationErrors().size());
        assertEquals("field", response.validationErrors().get(0).field());
        assertEquals("message", response.validationErrors().get(0).message());
    }
}

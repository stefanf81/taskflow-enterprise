package com.example.todoapi.core;

import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class ErrorResponseTest {

    @Test
    void testErrorResponseWithoutValidationErrors() {
        ErrorResponse response = new ErrorResponse(404, "Not Found", "Item not found", "/api/test");

        assertEquals(404, response.getStatus());
        assertEquals("Not Found", response.getError());
        assertEquals("Item not found", response.getMessage());
        assertEquals("/api/test", response.getPath());
        assertNotNull(response.getTimestamp());
        assertNull(response.getValidationErrors());

        // Test setters
        LocalDateTime now = LocalDateTime.now();
        response.setTimestamp(now);
        response.setStatus(500);
        response.setError("Internal Error");
        response.setMessage("Server failed");
        response.setPath("/api/error");

        assertEquals(now, response.getTimestamp());
        assertEquals(500, response.getStatus());
        assertEquals("Internal Error", response.getError());
        assertEquals("Server failed", response.getMessage());
        assertEquals("/api/error", response.getPath());
    }

    @Test
    void testErrorResponseWithValidationErrors() {
        ErrorResponse.ValidationError validationError = new ErrorResponse.ValidationError("field", "message");
        ErrorResponse response = new ErrorResponse(400, "Bad Request", "Validation failed", "/api/test", Collections.singletonList(validationError));

        assertEquals(400, response.getStatus());
        assertEquals(1, response.getValidationErrors().size());

        // Test ValidationError setters
        validationError.setField("newField");
        validationError.setMessage("newMessage");

        assertEquals("newField", validationError.getField());
        assertEquals("newMessage", validationError.getMessage());

        response.setValidationErrors(null);
        assertNull(response.getValidationErrors());
    }
}

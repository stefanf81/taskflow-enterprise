package com.example.todoapi.core;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GlobalExceptionHandlerTest {

    private GlobalExceptionHandler globalExceptionHandler;
    private HttpServletRequest request;

    @BeforeEach
    void setUp() {
        globalExceptionHandler = new GlobalExceptionHandler();
        request = mock(HttpServletRequest.class);
        when(request.getRequestURI()).thenReturn("/api/test");
    }

    @Test
    void testHandleResourceNotFoundException() {
        ResourceNotFoundException ex = new ResourceNotFoundException("Not found");
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleResourceNotFoundException(ex, request);

        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("Not found", response.getBody().getMessage());
        assertEquals("/api/test", response.getBody().getPath());
        assertEquals(404, response.getBody().getStatus());
    }

    @Test
    void testHandleValidationException() throws NoSuchMethodException {
        BindingResult bindingResult = mock(BindingResult.class);
        FieldError fieldError = new FieldError("object", "field", "must not be blank");
        when(bindingResult.getFieldErrors()).thenReturn(Collections.singletonList(fieldError));

        MethodParameter methodParameter = new MethodParameter(this.getClass().getDeclaredMethod("setUp"), -1);
        MethodArgumentNotValidException ex = new MethodArgumentNotValidException(methodParameter, bindingResult);

        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleValidationException(ex, request);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("Validation failed", response.getBody().getMessage());
        assertEquals(1, response.getBody().getValidationErrors().size());
        assertEquals("field", response.getBody().getValidationErrors().get(0).getField());
        assertEquals("must not be blank", response.getBody().getValidationErrors().get(0).getMessage());
    }

    @Test
    void testHandleConstraintViolationException() {
        ConstraintViolation<Object> violation = new ConstraintViolation<Object>() {
            @Override
            public String getMessage() {
                return "must not be null";
            }
            @Override
            public String getMessageTemplate() { return null; }
            @Override
            public Object getRootBean() { return null; }
            @Override
            public Class<Object> getRootBeanClass() { return null; }
            @Override
            public Object getLeafBean() { return null; }
            @Override
            public Object[] getExecutableParameters() { return new Object[0]; }
            @Override
            public Object getExecutableReturnValue() { return null; }
            @Override
            public Path getPropertyPath() {
                return new Path() {
                    @Override
                    public String toString() { return "field"; }
                    @Override
                    public java.util.Iterator<Node> iterator() { return null; }
                };
            }
            @Override
            public Object getInvalidValue() { return null; }
            @Override
            public jakarta.validation.metadata.ConstraintDescriptor<?> getConstraintDescriptor() { return null; }
            @Override
            public <U> U unwrap(Class<U> type) { return null; }
        };

        Set<ConstraintViolation<?>> violations = new HashSet<>();
        violations.add(violation);
        ConstraintViolationException ex = new ConstraintViolationException(violations);

        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleConstraintViolationException(ex, request);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("Validation failed", response.getBody().getMessage());
        assertEquals(1, response.getBody().getValidationErrors().size());
        assertEquals("field", response.getBody().getValidationErrors().get(0).getField());
    }

    @Test
    void testHandleBadRequestExceptions_MissingServletRequestParameterException() {
        MissingServletRequestParameterException ex = new MissingServletRequestParameterException("param", "String");
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleBadRequestExceptions(ex, request);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(400, response.getBody().getStatus());
        assertEquals("Bad Request: " + ex.getMessage(), response.getBody().getMessage());
    }

    @Test
    void testHandleAuthenticationException() {
        AuthenticationException ex = new AuthenticationException("Bad credentials") {};
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleAuthenticationException(ex, request);

        assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(401, response.getBody().getStatus());
    }

    @Test
    void testHandleAccessDeniedException() {
        AccessDeniedException ex = new AccessDeniedException("Access denied");
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleAccessDeniedException(ex, request);

        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(403, response.getBody().getStatus());
    }

    @Test
    void testHandleGlobalException() {
        Exception ex = new Exception("Some internal error");
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleGlobalException(ex, request);

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(500, response.getBody().getStatus());
        assertEquals("An unexpected error occurred. Please try again later.", response.getBody().getMessage());
    }
}

package com.example.taskflow.core;

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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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
        assertEquals("Not found", response.getBody().message());
        assertEquals("/api/test", response.getBody().path());
        assertEquals(404, response.getBody().status());
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
        assertEquals("Validation failed", response.getBody().message());
        assertEquals(1, response.getBody().validationErrors().size());
        assertEquals("field", response.getBody().validationErrors().get(0).field());
        assertEquals("must not be blank", response.getBody().validationErrors().get(0).message());
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
        assertEquals("Validation failed", response.getBody().message());
        assertEquals(1, response.getBody().validationErrors().size());
        assertEquals("field", response.getBody().validationErrors().get(0).field());
    }

    @Test
    void testHandleBadRequestExceptions_MissingServletRequestParameterException() {
        MissingServletRequestParameterException ex = new MissingServletRequestParameterException("param", "String");
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleBadRequestExceptions(ex, request);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(400, response.getBody().status());
        assertEquals("Bad Request: Required parameter 'param' is missing.", response.getBody().message());
    }

    @Test
    void testHandleAuthenticationException() {
        AuthenticationException ex = new AuthenticationException("Bad credentials") {};
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleAuthenticationException(ex, request);

        assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(401, response.getBody().status());
    }

    @Test
    void testHandleAccessDeniedException() {
        AccessDeniedException ex = new AccessDeniedException("Access denied");
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleAccessDeniedException(ex, request);

        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(403, response.getBody().status());
    }

    @Test
    void testHandleGlobalException() {
        Exception ex = new Exception("Some internal error");
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleGlobalException(ex, request);

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(500, response.getBody().status());
        assertEquals("An unexpected error occurred. Please try again later.", response.getBody().message());
    }

    @Test
    void testHandleHttpMessageNotReadableException() {
        org.springframework.http.converter.HttpMessageNotReadableException ex = mock(org.springframework.http.converter.HttpMessageNotReadableException.class);
        when(ex.getMessage()).thenReturn("Malformed JSON");
        RuntimeException cause = new RuntimeException("Parse error detail");
        when(ex.getMostSpecificCause()).thenReturn(cause);
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleHttpMessageNotReadableException(ex, request);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        // M1: response message must NOT leak the internal cause detail
        assertEquals("Malformed JSON request payload. Please check your request body and content type.", response.getBody().message());
    }

    @Test
    void testHandleNotFoundExceptions() {
        org.springframework.web.servlet.resource.NoResourceFoundException ex = mock(org.springframework.web.servlet.resource.NoResourceFoundException.class);
        when(ex.getMessage()).thenReturn("Resource not found message");
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleNotFoundExceptions(ex, request);

        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("Resource not found.", response.getBody().message());
    }

    @Test
    void testHandleMethodNotSupportedException() {
        org.springframework.web.HttpRequestMethodNotSupportedException ex = mock(org.springframework.web.HttpRequestMethodNotSupportedException.class);
        when(ex.getMessage()).thenReturn("Request method 'POST' is not supported");
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleMethodNotSupportedException(ex, request);

        assertEquals(HttpStatus.METHOD_NOT_ALLOWED, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("Method not allowed.", response.getBody().message());
    }

    @Test
    void testHandleMediaTypeNotSupportedException() {
        org.springframework.web.HttpMediaTypeNotSupportedException ex = mock(org.springframework.web.HttpMediaTypeNotSupportedException.class);
        when(ex.getMessage()).thenReturn("Content-Type 'text/plain' is not supported");
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleMediaTypeNotSupportedException(ex, request);

        assertEquals(HttpStatus.UNSUPPORTED_MEDIA_TYPE, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("Unsupported media type.", response.getBody().message());
    }

    @Test
    void testHandleDataAccessResourceFailure() {
        org.springframework.dao.DataAccessResourceFailureException ex =
                new org.springframework.dao.DataAccessResourceFailureException("Connection pool exhausted");

        ResponseEntity<ErrorResponse> response =
                globalExceptionHandler.handleDataAccessResourceFailure(ex, request);

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, response.getStatusCode());
        assertEquals("1", response.getHeaders().getFirst("Retry-After"));
        assertNotNull(response.getBody());
        assertEquals("The service is temporarily busy. Please try again shortly.", response.getBody().message());
    }

    @Test
    void typeMismatchDoesNotLeakJavaClassNames() {
        MethodArgumentTypeMismatchException ex = new MethodArgumentTypeMismatchException(
                "abc", Long.class, "id", mock(MethodParameter.class), new NumberFormatException("For input string: \"abc\""));

        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleBadRequestExceptions(ex, request);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertEquals("Bad Request: Invalid value for parameter 'id'.", response.getBody().message());
        assertFalse(response.getBody().message().contains("java.lang"));
    }

    @Test
    void uniqueViolationMapsTo409() {
        var ex = new org.springframework.dao.DataIntegrityViolationException("could not execute statement",
                new RuntimeException("wrapper", new java.sql.SQLException("duplicate key", "23505")));

        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleDataIntegrityViolation(ex, request);

        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        assertEquals("The request conflicts with existing data.", response.getBody().message());
    }

    @Test
    void foreignKeyViolationMapsTo409() {
        var ex = new org.springframework.dao.DataIntegrityViolationException("fk",
                new java.sql.SQLException("violates foreign key", "23503"));

        assertEquals(HttpStatus.CONFLICT, globalExceptionHandler.handleDataIntegrityViolation(ex, request).getStatusCode());
    }

    @Test
    void exclusionViolationMapsTo409() {
        // PostgreSQL appointments_no_overlap (V35)
        var ex = new org.springframework.dao.DataIntegrityViolationException("overlap",
                new java.sql.SQLException("conflicting key value violates exclusion constraint", "23P01"));

        assertEquals(HttpStatus.CONFLICT, globalExceptionHandler.handleDataIntegrityViolation(ex, request).getStatusCode());
    }

    @Test
    void otherIntegrityViolationsStayServerErrors() {
        var ex = new org.springframework.dao.DataIntegrityViolationException("null value",
                new java.sql.SQLException("not null", "23502"));

        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleDataIntegrityViolation(ex, request);

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
    }

    @Test
    void frameworkClientErrorsKeepTheirOwnStatusInsteadOf500() {
        var ex = new org.springframework.web.HttpMediaTypeNotAcceptableException("nothing acceptable");

        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleGlobalException(ex, request);

        assertEquals(HttpStatus.NOT_ACCEPTABLE, response.getStatusCode());
        assertEquals("The request could not be processed.", response.getBody().message());
    }

    @Test
    void asyncTimeoutIsNotReportedAsAnInternalError() {
        var ex = new org.springframework.web.context.request.async.AsyncRequestTimeoutException();

        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleGlobalException(ex, request);

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, response.getStatusCode());
        assertNull(response.getBody(), "an SSE response is already text/event-stream; no JSON body");
    }

    @Test
    void responseStatusExceptionForwardsItsHeaders() {
        var ex = new com.example.taskflow.auth.TooManyLoginAttemptsException(42);

        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleResponseStatusException(ex, request);

        assertEquals(HttpStatus.TOO_MANY_REQUESTS, response.getStatusCode());
        assertEquals("42", response.getHeaders().getFirst("Retry-After"));
    }

    @Test
    void conflictExceptionsAreMappedTo409() {
        ResponseEntity<ErrorResponse> plain = globalExceptionHandler.handleConflictException(
                new ConflictException("slot taken"), request);
        assertEquals(HttpStatus.CONFLICT, plain.getStatusCode());
        assertEquals("slot taken", plain.getBody().message());

        ResponseEntity<ErrorResponse> transition = globalExceptionHandler.handleConflictException(
                new InvalidStatusTransitionException("CANCELLED", "APPROVED"), request);
        assertEquals(HttpStatus.CONFLICT, transition.getStatusCode());
        assertEquals("Cannot change an appointment from CANCELLED to APPROVED.", transition.getBody().message());
    }

    @Test
    void optimisticLockFailuresAreMappedTo409() {
        ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleOptimisticLockingFailure(
                new org.springframework.orm.ObjectOptimisticLockingFailureException("Appointment", 1L), request);

        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        assertEquals(409, response.getBody().status());
    }

    @Test
    void transientDatabaseFailuresAreMappedTo503WithRetryAfter() {
        List<Exception> transients = List.of(
                new org.springframework.dao.QueryTimeoutException("timeout"),
                new org.springframework.dao.TransientDataAccessResourceException("transient"),
                new org.springframework.dao.CannotAcquireLockException("lock"),
                new org.springframework.transaction.CannotCreateTransactionException("no connection"),
                new org.springframework.dao.DataAccessResourceFailureException("down"));
        for (Exception ex : transients) {
            ResponseEntity<ErrorResponse> response = globalExceptionHandler.handleDataAccessResourceFailure(ex, request);
            assertEquals(HttpStatus.SERVICE_UNAVAILABLE, response.getStatusCode(), ex.getClass().getSimpleName());
            assertEquals("1", response.getHeaders().getFirst("Retry-After"));
            assertEquals(503, response.getBody().status());
        }
    }

    /**
     * The handler is picked by exception type, so the more specific 409 handler for optimistic
     * locking must win over the 503 handler for the (broader) transient data-access family.
     */
    @Test
    void springPicksTheSpecificHandlerForEachExceptionFamily() throws Exception {
        org.springframework.web.method.annotation.ExceptionHandlerMethodResolver resolver =
                new org.springframework.web.method.annotation.ExceptionHandlerMethodResolver(GlobalExceptionHandler.class);

        assertEquals("handleOptimisticLockingFailure", resolver.resolveMethodByThrowable(
                new org.springframework.orm.ObjectOptimisticLockingFailureException("A", 1L)).getName());
        assertEquals("handleDataAccessResourceFailure", resolver.resolveMethodByThrowable(
                new org.springframework.dao.QueryTimeoutException("t")).getName());
        assertEquals("handleDataAccessResourceFailure", resolver.resolveMethodByThrowable(
                new org.springframework.transaction.CannotCreateTransactionException("t")).getName());
        assertEquals("handleConflictException", resolver.resolveMethodByThrowable(
                new InvalidStatusTransitionException("A", "B")).getName());
        assertEquals("handleIdempotencyConflictException", resolver.resolveMethodByThrowable(
                new IdempotencyConflictException("x")).getName());
    }

    @Test
    void redisFailuresAreNotReportedAsDatabaseFailures() {
        assertEquals("Redis", GlobalExceptionHandler.unavailableResource(
                new org.springframework.dao.QueryTimeoutException("Redis command timed out",
                        new io.lettuce.core.RedisCommandTimeoutException("timed out after 250 ms"))));
        assertEquals("Redis", GlobalExceptionHandler.unavailableResource(
                new org.springframework.data.redis.RedisConnectionFailureException("refused")));
        assertEquals("Database", GlobalExceptionHandler.unavailableResource(
                new org.springframework.dao.QueryTimeoutException("statement timeout")));
        assertEquals("Database", GlobalExceptionHandler.unavailableResource(
                new org.springframework.dao.DataAccessResourceFailureException("pool exhausted")));
    }
}

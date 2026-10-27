package com.example.taskflow.core;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.List;

@ControllerAdvice
class GlobalExceptionHandler {

    private static final Logger logger = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleResourceNotFoundException(
            ResourceNotFoundException ex, HttpServletRequest request) {
        
        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.NOT_FOUND.value(),
                HttpStatus.NOT_FOUND.getReasonPhrase(),
                ex.getMessage(),
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.NOT_FOUND);
    }

    @ExceptionHandler(IdempotencyConflictException.class)
    public ResponseEntity<ErrorResponse> handleIdempotencyConflictException(
            IdempotencyConflictException ex, HttpServletRequest request) {

        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.CONFLICT.value(),
                HttpStatus.CONFLICT.getReasonPhrase(),
                ex.getMessage(),
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.CONFLICT);
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<ErrorResponse> handleConflictException(
            ConflictException ex, HttpServletRequest request) {

        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.CONFLICT.value(),
                HttpStatus.CONFLICT.getReasonPhrase(),
                ex.getMessage(),
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.CONFLICT);
    }

    /**
     * Another request changed the same row between this request's read and its
     * write (JPA {@code @Version}). The caller should reload and decide again.
     */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handleOptimisticLockingFailure(
            OptimisticLockingFailureException ex, HttpServletRequest request) {
        logger.warn("Optimistic lock conflict on {}", LogSanitizer.stripNewlines(request.getRequestURI()));

        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.CONFLICT.value(),
                HttpStatus.CONFLICT.getReasonPhrase(),
                "The record was changed by someone else. Please reload and try again.",
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.CONFLICT);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleIllegalArgumentException(
            IllegalArgumentException ex, HttpServletRequest request) {
        
        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                ex.getMessage(),
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(
            MethodArgumentNotValidException ex, HttpServletRequest request) {
        
        List<ErrorResponse.ValidationError> validationErrors = ex.getBindingResult()
                .getFieldErrors()
                .stream()
                .map(error -> new ErrorResponse.ValidationError(error.getField(), error.getDefaultMessage()))
                .toList();

        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                "Validation failed",
                request.getRequestURI(),
                validationErrors
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(jakarta.validation.ConstraintViolationException.class)
    public ResponseEntity<ErrorResponse> handleConstraintViolationException(
            jakarta.validation.ConstraintViolationException ex, HttpServletRequest request) {
        
        List<ErrorResponse.ValidationError> validationErrors = ex.getConstraintViolations()
                .stream()
                .map(violation -> new ErrorResponse.ValidationError(
                        violation.getPropertyPath().toString(), 
                        violation.getMessage()))
                .toList();

        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                "Validation failed",
                request.getRequestURI(),
                validationErrors
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleHttpMessageNotReadableException(
            org.springframework.http.converter.HttpMessageNotReadableException ex, HttpServletRequest request) {

        // M1: Log the detailed message server-side for debugging, but return a
        // generic message to the client. The raw mostSpecificCause message can
        // leak internal class names (e.g. "Cannot deserialize value of type
        // `com.example.taskflow.appointment.AppointmentCreateRequest`"), which
        // is an information-disclosure vector flagged by OWASP / ZAP.
        String detailedMessage = ex.getMostSpecificCause() != null ? ex.getMostSpecificCause().getMessage() : ex.getMessage();
        logger.warn("Malformed JSON request on {}: {}", LogSanitizer.stripNewlines(request.getRequestURI()), LogSanitizer.stripNewlines(detailedMessage));

        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                "Malformed JSON request payload. Please check your request body and content type.",
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler({
        org.springframework.web.servlet.resource.NoResourceFoundException.class,
        org.springframework.web.servlet.NoHandlerFoundException.class
    })
    public ResponseEntity<ErrorResponse> handleNotFoundExceptions(
            Exception ex, HttpServletRequest request) {
        
        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.NOT_FOUND.value(),
                HttpStatus.NOT_FOUND.getReasonPhrase(),
                "Resource not found.",
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.NOT_FOUND);
    }

    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMethodNotSupportedException(
            org.springframework.web.HttpRequestMethodNotSupportedException ex, HttpServletRequest request) {
        
        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.METHOD_NOT_ALLOWED.value(),
                HttpStatus.METHOD_NOT_ALLOWED.getReasonPhrase(),
                "Method not allowed.",
                request.getRequestURI()
        );
        // Keep the Allow header Spring computes for this exception.
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).headers(ex.getHeaders()).body(errorResponse);
    }

    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMediaTypeNotSupportedException(
            org.springframework.web.HttpMediaTypeNotSupportedException ex, HttpServletRequest request) {
        
        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.UNSUPPORTED_MEDIA_TYPE.value(),
                HttpStatus.UNSUPPORTED_MEDIA_TYPE.getReasonPhrase(),
                "Unsupported media type.",
                request.getRequestURI()
        );
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).headers(ex.getHeaders()).body(errorResponse);
    }

    @ExceptionHandler({
        org.springframework.web.bind.MissingServletRequestParameterException.class,
        org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class
    })
    public ResponseEntity<ErrorResponse> handleBadRequestExceptions(
            Exception ex, HttpServletRequest request) {

        // Only the parameter name (chosen by us) is echoed. The framework's own
        // message for a type mismatch names Java classes ("Failed to convert value
        // of type 'java.lang.String' to required type 'java.lang.Long'..."), which
        // is internal detail a client has no use for.
        String detail;
        if (ex instanceof org.springframework.web.bind.MissingServletRequestParameterException missing) {
            detail = "Required parameter '" + missing.getParameterName() + "' is missing.";
        } else if (ex instanceof org.springframework.web.method.annotation.MethodArgumentTypeMismatchException mismatch) {
            detail = "Invalid value for parameter '" + mismatch.getName() + "'.";
        } else {
            detail = "Invalid request.";
        }
        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                "Bad Request: " + detail,
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.BAD_REQUEST);
    }

    /**
     * Unique/foreign-key/exclusion violations are conflicts with existing data (duplicate
     * service name, deleting a service that has bookings, re-activating a booking
     * whose slot was taken; 23P01 is PostgreSQL's appointments_no_overlap exclusion
     * constraint), not server faults. Everything else — NOT NULL, length
     * — is left to the catch-all so it is still logged as an error.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponse> handleDataIntegrityViolation(
            DataIntegrityViolationException ex, HttpServletRequest request) {

        String sqlState = findSqlState(ex);
        if (!"23505".equals(sqlState) && !"23503".equals(sqlState) && !"23P01".equals(sqlState)) {
            return handleGlobalException(ex, request);
        }
        logger.warn("Data conflict (SQLState {}) on {}", sqlState, LogSanitizer.stripNewlines(request.getRequestURI()));
        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.CONFLICT.value(),
                HttpStatus.CONFLICT.getReasonPhrase(),
                "The request conflicts with existing data.",
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.CONFLICT);
    }

    private static String findSqlState(Throwable ex) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof java.sql.SQLException sql && sql.getSQLState() != null) {
                return sql.getSQLState();
            }
            if (t.getCause() == t) {
                break;
            }
        }
        return null;
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ErrorResponse> handleAuthenticationException(
            AuthenticationException ex, HttpServletRequest request) {
        
        String safeMessage = LogSanitizer.stripNewlines(ex.getMessage());
        logger.warn("Authentication failed: {}", safeMessage);
        
        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.UNAUTHORIZED.value(),
                HttpStatus.UNAUTHORIZED.getReasonPhrase(),
                "Authentication failed: Invalid credentials.",
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.UNAUTHORIZED);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ErrorResponse> handleAccessDeniedException(
            AccessDeniedException ex, HttpServletRequest request) {
        
        String safeMessage = LogSanitizer.stripNewlines(ex.getMessage());
        logger.warn("Access denied: {}", safeMessage);
        
        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.FORBIDDEN.value(),
                HttpStatus.FORBIDDEN.getReasonPhrase(),
                "Access denied: You do not have permission to access this resource.",
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.FORBIDDEN);
    }

    /**
     * Which backing service failed, for the log line: Redis errors arrive as the same Spring
     * data-access exceptions as database errors ({@code QueryTimeoutException} for a Lettuce command
     * timeout), and logging them as a database problem sent operators to the wrong system.
     */
    static String unavailableResource(Throwable ex) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof org.springframework.data.redis.RedisConnectionFailureException
                    || t.getClass().getName().startsWith("io.lettuce.")) {
                return "Redis";
            }
            if (t.getCause() == t) {
                break;
            }
        }
        return "Database";
    }

    /**
     * Temporary infrastructure failures: the database is unreachable, the pool is
     * exhausted, a query timed out, or a lock/deadlock was lost. None of these say
     * anything about the request itself, so the client is told to retry shortly
     * instead of receiving a 500. (Optimistic-lock conflicts are also transient
     * data-access exceptions but have their own, more specific 409 handler.)
     */
    @ExceptionHandler({
        DataAccessResourceFailureException.class,
        QueryTimeoutException.class,
        TransientDataAccessException.class,
        CannotCreateTransactionException.class
    })
    public ResponseEntity<ErrorResponse> handleDataAccessResourceFailure(
            Exception ex, HttpServletRequest request) {
        logger.warn("{} resource unavailable on {}: {}", unavailableResource(ex),
                LogSanitizer.stripNewlines(request.getRequestURI()), LogSanitizer.safeMessage(ex));

        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.SERVICE_UNAVAILABLE.value(),
                HttpStatus.SERVICE_UNAVAILABLE.getReasonPhrase(),
                "The service is temporarily busy. Please try again shortly.",
                request.getRequestURI()
        );
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .header("Retry-After", "1")
                .body(errorResponse);
    }

    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    public ResponseEntity<ErrorResponse> handleResponseStatusException(
            org.springframework.web.server.ResponseStatusException ex, HttpServletRequest request) {

        int status = ex.getStatusCode().value();
        String message = ex.getReason() == null ? "Request could not be processed." : LogSanitizer.stripNewlines(ex.getReason());
        ErrorResponse errorResponse = new ErrorResponse(
                status,
                ex.getStatusCode().toString(),
                message,
                request.getRequestURI()
        );
        return ResponseEntity.status(ex.getStatusCode()).headers(ex.getHeaders()).body(errorResponse);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGlobalException(
            Exception ex, HttpServletRequest request) {

        // Spring MVC's own exceptions (missing header, unacceptable Accept, async
        // timeout, upload too large, ...) implement ErrorResponse and know their
        // status. Answering them with a 500 + ERROR stack trace misreports client
        // errors as server faults, so honour the status they carry.
        if (ex instanceof org.springframework.web.ErrorResponse framework) {
            HttpStatus status = HttpStatus.resolve(framework.getStatusCode().value());
            if (ex instanceof org.springframework.web.context.request.async.AsyncRequestTimeoutException) {
                // e.g. an SSE stream reaching its timeout: the response is already
                // text/event-stream and often committed, so send no JSON body.
                logger.debug("Async request timed out on {}", LogSanitizer.stripNewlines(request.getRequestURI()));
                return ResponseEntity.status(framework.getStatusCode()).build();
            }
            if (status != null && status.is4xxClientError()) {
                logger.debug("Request rejected ({}) on {}: {}", status.value(),
                        LogSanitizer.stripNewlines(request.getRequestURI()), LogSanitizer.safeMessage(ex));
                HttpHeaders headers = framework.getHeaders();
                ErrorResponse errorResponse = new ErrorResponse(
                        status.value(),
                        status.getReasonPhrase(),
                        "The request could not be processed.",
                        request.getRequestURI()
                );
                return ResponseEntity.status(status).headers(headers).body(errorResponse);
            }
        }

        // Log the actual exception securely on the server
        logger.error("Unhandled exception caught: ", ex);

        // Return an obfuscated message to the client to prevent Information Disclosure (ZAP Security fix)
        ErrorResponse errorResponse = new ErrorResponse(
                HttpStatus.INTERNAL_SERVER_ERROR.value(),
                HttpStatus.INTERNAL_SERVER_ERROR.getReasonPhrase(),
                "An unexpected error occurred. Please try again later.",
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
}

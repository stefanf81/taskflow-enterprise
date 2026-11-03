/**
 * HTTP edge of the shared kernel: the global exception handler and its error body, the
 * {@code ShallowEtagHeaderFilter}, the per-IP rate limiter and the OpenAPI response-nullability
 * customizer. Internal to {@code core}: no other module references these types.
 */
package com.example.taskflow.core.web;

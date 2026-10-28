package com.example.taskflow.core;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import org.jspecify.annotations.Nullable;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.ClassUtils;

import java.lang.reflect.RecordComponent;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Publishes which response fields can be absent. Jackson leaves null fields out of every response
 * ({@code spring.jackson.default-property-inclusion=non_null}), and springdoc does not mark response
 * properties as required, so without this the OpenAPI document could not tell clients which fields
 * they will always get.
 *
 * <p>Rule: every component of a response record is {@code required} unless its type is annotated
 * JSpecify {@link Nullable}. A response field that can be null must therefore carry
 * {@code @Nullable}; the generated client contracts ({@code shared/schemas/src/generated}) and the
 * validator parity spec are derived from these lists.
 */
@Configuration(proxyBeanMethods = false)
class OpenApiResponseNullabilityConfig {

    private static final String BASE_PACKAGE = "com.example.taskflow";

    @Bean
    OpenApiCustomizer responseRequiredFields() {
        // The classpath scan runs when springdoc builds the document (once, it is cached), not at
        // startup: startup time is measured and the document is only served on demand.
        return openApi -> markRequired(openApi, responseCandidates());
    }

    static void markRequired(OpenAPI openApi, Map<String, Class<?>> recordsBySimpleName) {
        if (openApi.getComponents() == null || openApi.getComponents().getSchemas() == null) {
            return;
        }
        Map<String, Schema> schemas = openApi.getComponents().getSchemas();
        for (String name : responseSchemaNames(openApi, schemas)) {
            Class<?> type = recordsBySimpleName.get(name);
            Schema<?> schema = schemas.get(name);
            if (type == null || schema == null || schema.getProperties() == null) {
                continue;
            }
            Set<String> required = new TreeSet<>(schema.getRequired() == null ? List.of() : schema.getRequired());
            for (RecordComponent component : type.getRecordComponents()) {
                boolean nullable = component.getAnnotatedType().isAnnotationPresent(Nullable.class);
                if (!nullable && schema.getProperties().containsKey(component.getName())) {
                    required.add(component.getName());
                }
            }
            schema.setRequired(List.copyOf(required));
        }
    }

    /** Component schemas reachable from any operation's response bodies. */
    private static Set<String> responseSchemaNames(OpenAPI openApi, Map<String, Schema> schemas) {
        Deque<Schema<?>> queue = new ArrayDeque<>();
        if (openApi.getPaths() != null) {
            openApi.getPaths().values().forEach(path -> path.readOperations().stream()
                    .map(Operation::getResponses)
                    .filter(responses -> responses != null)
                    .flatMap(responses -> responses.values().stream())
                    .filter(response -> response.getContent() != null)
                    .flatMap(response -> response.getContent().values().stream())
                    .map(MediaType::getSchema)
                    .filter(schema -> schema != null)
                    .forEach(queue::add));
        }
        Set<String> names = new HashSet<>();
        while (!queue.isEmpty()) {
            Schema<?> schema = queue.pop();
            if (schema.get$ref() != null) {
                String name = schema.get$ref().substring(schema.get$ref().lastIndexOf('/') + 1);
                if (names.add(name) && schemas.get(name) != null) {
                    queue.add(schemas.get(name));
                }
                continue;
            }
            if (schema.getItems() != null) {
                queue.add(schema.getItems());
            }
            if (schema.getProperties() != null) {
                schema.getProperties().values().forEach(queue::add);
            }
        }
        return names;
    }

    private static Map<String, Class<?>> responseCandidates() {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter((reader, factory) -> "java.lang.Record".equals(reader.getClassMetadata().getSuperClassName()));
        Map<String, Class<?>> records = new HashMap<>();
        for (BeanDefinition definition : scanner.findCandidateComponents(BASE_PACKAGE)) {
            Class<?> type = ClassUtils.resolveClassName(definition.getBeanClassName(), OpenApiResponseNullabilityConfig.class.getClassLoader());
            records.putIfAbsent(type.getSimpleName(), type);
        }
        return records;
    }
}

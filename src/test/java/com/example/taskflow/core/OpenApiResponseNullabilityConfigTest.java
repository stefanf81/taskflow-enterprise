package com.example.taskflow.core;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class OpenApiResponseNullabilityConfigTest {

    record ItemResponse(String id, @Nullable String note) {
    }

    record ItemRequest(String id, String note) {
    }

    private static Schema<?> object(String... properties) {
        ObjectSchema schema = new ObjectSchema();
        for (String property : properties) {
            schema.addProperty(property, new StringSchema());
        }
        return schema;
    }

    @Test
    void responseRecordFieldsAreRequiredUnlessNullableAndRequestsAreUntouched() {
        Schema<?> response = object("id", "note");
        Schema<?> request = object("id", "note");
        OpenAPI openApi = new OpenAPI()
                .components(new Components().schemas(Map.of("ItemResponse", response, "ItemRequest", request)))
                .paths(new Paths().addPathItem("/items", new PathItem().get(new Operation().responses(
                        new ApiResponses().addApiResponse("200", new ApiResponse().content(new Content()
                                .addMediaType("application/json", new MediaType()
                                        .schema(new Schema<>().type("array")
                                                .items(new Schema<>().$ref("#/components/schemas/ItemResponse"))))))))));

        OpenApiResponseNullabilityConfig.markRequired(openApi,
                Map.of("ItemResponse", ItemResponse.class, "ItemRequest", ItemRequest.class));

        assertEquals(List.of("id"), response.getRequired());
        assertNull(request.getRequired(), "only schemas reachable from a response are changed");
    }
}

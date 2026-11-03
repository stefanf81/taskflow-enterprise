package com.example.taskflow.core.web;

import jakarta.servlet.Filter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/**
 * The ETag filter hashes successful, storable GET bodies but must leave event streams and actuator
 * responses unbuffered.
 */
class ShallowEtagFilterTest {

    private final Filter filter = new EtagFilterConfig().shallowEtagHeaderFilter();

    @Test
    void plainGetGetsAnEtag() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/catalog");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain(new jakarta.servlet.http.HttpServlet() {
            @Override
            protected void doGet(jakarta.servlet.http.HttpServletRequest req,
                                 jakarta.servlet.http.HttpServletResponse res) throws java.io.IOException {
                res.getWriter().write("[]");
            }
        });

        filter.doFilter(request, response, chain);

        assertNotSame(response, chain.getResponse(), "body is buffered to hash it");
        assertNotNull(response.getHeader("ETag"));
    }

    @Test
    void eventStreamPathIsNotBuffered() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", EtagFilterConfig.EVENT_STREAM_PATH);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertSame(response, chain.getResponse());
        assertNull(response.getHeader("ETag"));
    }

    @Test
    void eventStreamAcceptHeaderIsNotBuffered() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/anything");
        request.addHeader("Accept", "text/event-stream");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertSame(response, chain.getResponse());
    }

    @Test
    void actuatorResponsesAreNotBuffered() throws Exception {
        for (String path : new String[] {"/actuator/prometheus", "/actuator/health/readiness"}) {
            MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
            request.setServletPath(path);
            MockHttpServletResponse response = new MockHttpServletResponse();
            MockFilterChain chain = new MockFilterChain();

            filter.doFilter(request, response, chain);

            assertSame(response, chain.getResponse(), path);
            assertNull(response.getHeader("ETag"), path);
        }
    }

    @Test
    void actuatorIsMatchedWithinTheContextPath() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/app/actuator/prometheus");
        request.setContextPath("/app");
        request.setServletPath("/actuator/prometheus");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertSame(response, chain.getResponse());
    }

    @Test
    void apiPathsThatMerelyContainActuatorAreStillHashed() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/actuator/x");
        request.setServletPath("/api/v1/actuator/x");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain(new jakarta.servlet.http.HttpServlet() {
            @Override
            protected void doGet(jakarta.servlet.http.HttpServletRequest req,
                                 jakarta.servlet.http.HttpServletResponse res) throws java.io.IOException {
                res.getWriter().write("[]");
            }
        });

        filter.doFilter(request, response, chain);

        assertNotNull(response.getHeader("ETag"));
    }

    @Test
    void errorResponsesGetNoEtag() throws Exception {
        for (int status : new int[] {400, 404, 500, 503}) {
            MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/catalog");
            request.addHeader("If-None-Match", "\"anything\"");
            MockHttpServletResponse response = new MockHttpServletResponse();

            filter.doFilter(request, response, servlet(status, null));

            assertNull(response.getHeader("ETag"), "status " + status);
            assertEquals(status, response.getStatus(), "an error is never turned into a 304");
            assertEquals("[]", response.getContentAsString(), "the body is still sent");
        }
    }

    @Test
    void noStoreResponsesGetNoEtag() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/appointments");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, servlet(200, "no-store"));

        assertNull(response.getHeader("ETag"));
        assertEquals("[]", response.getContentAsString());
    }

    @Test
    void successfulCacheableGetStillGetsAnEtagAndA304() throws Exception {
        MockHttpServletResponse first = new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest("GET", "/api/v1/catalog"), first, servlet(200, "max-age=300, public"));
        String etag = first.getHeader("ETag");
        assertNotNull(etag);

        MockHttpServletRequest again = new MockHttpServletRequest("GET", "/api/v1/catalog");
        again.addHeader("If-None-Match", etag);
        MockHttpServletResponse second = new MockHttpServletResponse();
        filter.doFilter(again, second, servlet(200, "max-age=300, public"));

        assertEquals(304, second.getStatus());
    }

    @Test
    void nonGetRequestsGetNoEtag() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(new MockHttpServletRequest("POST", "/api/v1/appointments"), response, servlet(200, null));

        assertNull(response.getHeader("ETag"));
    }

    private static MockFilterChain servlet(int status, String cacheControl) {
        return new MockFilterChain(new jakarta.servlet.http.HttpServlet() {
            @Override
            protected void service(jakarta.servlet.http.HttpServletRequest req,
                                   jakarta.servlet.http.HttpServletResponse res) throws java.io.IOException {
                res.setStatus(status);
                if (cacheControl != null) {
                    res.setHeader("Cache-Control", cacheControl);
                }
                res.getWriter().write("[]");
            }
        });
    }
}

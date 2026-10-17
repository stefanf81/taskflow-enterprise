package com.example.taskflow.core;

import jakarta.servlet.Filter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/** The ETag filter hashes ordinary GET bodies but must leave event streams unbuffered. */
class ShallowEtagFilterTest {

    private final Filter filter = new CacheConfig().shallowEtagHeaderFilter();

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
        MockHttpServletRequest request = new MockHttpServletRequest("GET", CacheConfig.EVENT_STREAM_PATH);
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
}

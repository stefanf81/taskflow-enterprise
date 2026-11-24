package com.example.taskflow.benchmark;

import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * The benchmarks' HTTP client: {@link RestClient} with the three {@code RestTemplate} calls they use
 * ({@code RestTemplate} is deprecated for removal in Spring Framework 8, compiler {@code [removal]}).
 *
 * <p>Built on {@link SimpleClientHttpRequestFactory} ({@code HttpURLConnection}), the factory
 * {@code new RestTemplate()} used, so the measured numbers stay comparable: {@code RestClient.create()}
 * would pick another client, and pooled clients cap connections per route. The benchmarks raise
 * {@code http.maxConnections} for this connection type. As with {@code RestTemplate}, a 4xx or 5xx
 * response throws a {@code RestClientResponseException}.
 */
final class BenchmarkHttp {

    private final RestClient client = RestClient.builder()
            .requestFactory(new SimpleClientHttpRequestFactory())
            .build();

    <T> ResponseEntity<T> getForEntity(String url, Class<T> responseType) {
        return client.get().uri(url).retrieve().toEntity(responseType);
    }

    <T> ResponseEntity<T> postForEntity(String url, HttpEntity<?> request, Class<T> responseType) {
        return exchange(url, HttpMethod.POST, request, responseType);
    }

    <T> ResponseEntity<T> exchange(String url, HttpMethod method, HttpEntity<?> request, Class<T> responseType) {
        RestClient.RequestBodySpec spec =
                client.method(method).uri(url).headers(headers -> headers.addAll(request.getHeaders()));
        Object body = request.getBody();
        if (body != null) {
            spec.body(body);
        }
        return spec.retrieve().toEntity(responseType);
    }
}

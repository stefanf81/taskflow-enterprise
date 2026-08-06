package com.example.taskflow.appointment;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Maintains the local SSE connections for authenticated administrator dashboards. */
@Service
public class AppointmentEventStreamService {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentEventStreamService.class);
    private static final long STREAM_TIMEOUT_MILLIS = Duration.ofMinutes(30).toMillis();

    private final int maxConnectionsPerAdmin;
    private final Map<String, Set<SseEmitter>> emittersByAdmin = new ConcurrentHashMap<>();

    public AppointmentEventStreamService(
            @Value("${app.sse.max-connections-per-admin:2}") int maxConnectionsPerAdmin) {
        this.maxConnectionsPerAdmin = maxConnectionsPerAdmin;
    }

    public SseEmitter subscribe(String adminName) {
        Set<SseEmitter> emitters = emittersByAdmin.computeIfAbsent(adminName, ignored -> ConcurrentHashMap.newKeySet());
        SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MILLIS);
        synchronized (emitters) {
            if (emitters.size() >= maxConnectionsPerAdmin) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Too many active dashboard event streams.");
            }
            emitters.add(emitter);
        }

        emitter.onCompletion(() -> remove(adminName, emitter));
        emitter.onTimeout(() -> remove(adminName, emitter));
        emitter.onError(ignored -> remove(adminName, emitter));

        try {
            emitter.send(SseEmitter.event().name("ready").comment("dashboard event stream connected"));
            return emitter;
        } catch (IOException ex) {
            remove(adminName, emitter);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Unable to open dashboard event stream.", ex);
        }
    }

    public void publish(AppointmentAdminEvent event) {
        String eventName = "appointment." + event.type().name().toLowerCase();
        emittersByAdmin.forEach((adminName, emitters) -> emitters.forEach(emitter -> {
            try {
                emitter.send(SseEmitter.event()
                        .name(eventName)
                        .data(event));
            } catch (IOException | IllegalStateException ex) {
                logger.debug("Removing closed dashboard event stream for {}", adminName);
                remove(adminName, emitter);
            }
        }));
    }

    /** Keeps otherwise idle proxy connections alive. */
    @org.springframework.scheduling.annotation.Scheduled(
            fixedDelayString = "${app.sse.heartbeat-interval-ms:20000}")
    void sendHeartbeats() {
        emittersByAdmin.forEach((adminName, emitters) -> emitters.forEach(emitter -> {
            try {
                emitter.send(SseEmitter.event().comment("keepalive"));
            } catch (IOException | IllegalStateException ex) {
                logger.debug("Removing closed dashboard event stream for {}", adminName);
                remove(adminName, emitter);
            }
        }));
    }

    int connectionCount(String adminName) {
        return emittersByAdmin.getOrDefault(adminName, Set.of()).size();
    }

    private void remove(String adminName, SseEmitter emitter) {
        emittersByAdmin.computeIfPresent(adminName, (ignored, emitters) -> {
            emitters.remove(emitter);
            return emitters.isEmpty() ? null : emitters;
        });
    }
}

package com.example.taskflow.appointment.stream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseBuilder;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseType;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.time.Instant;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/** The admin SSE stream only hears about appointments whose transaction actually committed. */
@SpringJUnitConfig(AppointmentEventStreamListenerTest.Config.class)
class AppointmentEventStreamListenerTest {

    @Configuration
    @EnableTransactionManagement
    static class Config {

        @Bean
        DataSource dataSource() {
            return new EmbeddedDatabaseBuilder().setType(EmbeddedDatabaseType.H2).generateUniqueName(true).build();
        }

        @Bean
        PlatformTransactionManager transactionManager(DataSource dataSource) {
            return new DataSourceTransactionManager(dataSource);
        }

        @Bean
        AppointmentEventStreamService eventStreamService() {
            return Mockito.mock(AppointmentEventStreamService.class);
        }

        @Bean
        AppointmentEventStreamListener listener(AppointmentEventStreamService eventStreamService) {
            return new AppointmentEventStreamListener(eventStreamService);
        }
    }

    @Autowired private ApplicationEventPublisher publisher;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private AppointmentEventStreamService eventStreamService;

    private final AppointmentAdminEvent event =
            new AppointmentAdminEvent(AppointmentAdminEvent.Type.CREATED, 42L, Instant.parse("2031-01-01T10:00:00Z"));

    @BeforeEach
    void resetMock() {
        Mockito.reset(eventStreamService);
    }

    @Test
    void publishesAfterCommit() {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            publisher.publishEvent(event);
            verify(eventStreamService, never()).publish(event);
        });
        verify(eventStreamService).publish(event);
    }

    @Test
    void doesNotPublishWhenTheTransactionRollsBack() {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            publisher.publishEvent(event);
            status.setRollbackOnly();
        });
        verify(eventStreamService, never()).publish(event);
    }

    @Test
    void ignoresEventsPublishedOutsideATransaction() {
        publisher.publishEvent(event);
        verify(eventStreamService, never()).publish(event);
    }
}

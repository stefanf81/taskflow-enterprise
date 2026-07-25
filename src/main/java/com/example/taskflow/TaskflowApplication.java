package com.example.taskflow;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Bean;
import org.springframework.data.web.config.EnableSpringDataWebSupport;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableCaching
@EnableAsync
@EnableScheduling
@EnableSpringDataWebSupport(pageSerializationMode = EnableSpringDataWebSupport.PageSerializationMode.VIA_DTO)
public class TaskflowApplication {

	public static void main(String[] args) {
		SpringApplication.run(TaskflowApplication.class, args);
	}

	@Bean
	public FlywayMigrationStrategy flywayMigrationStrategy() {
		// Only migrate — do NOT call flyway.repair() in the default strategy.
		// repair() silently removes failed migration entries from
		// flyway_schema_history and retries, which can cause data corruption
		// if a migration failed due to a real issue (not just a checksum
		// mismatch). If a repair is genuinely needed (e.g. after correcting a
		// checksum), run it as a deliberate manual operation via the Flyway CLI
		// or a throwaway Spring Boot profile — never automatically on every boot.
		return flyway -> flyway.migrate();
	}

}

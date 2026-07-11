package com.example.taskflow;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableCaching
@EnableAsync
@EnableScheduling
public class TaskflowApplication {

	static {
		System.setProperty("io.netty.allocator.type", "pooled");
		System.setProperty("io.netty.allocator.useCacheForAllThreads", "true");
	}

	public static void main(String[] args) {
		SpringApplication.run(TaskflowApplication.class, args);
	}

}

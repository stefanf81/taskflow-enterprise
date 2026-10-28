/**
 * Notification outbox: listens to appointment events and sends the e-mails.
 */
@ApplicationModule(allowedDependencies = {"appointment", "core"})
package com.example.taskflow.notification;

import org.springframework.modulith.ApplicationModule;

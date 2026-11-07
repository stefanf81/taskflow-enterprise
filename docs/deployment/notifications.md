# Notification delivery

`app.notification.gateway=simulated` is the **offline default** for development, tests and image
AOT training. It marks processed outbox rows SENT without sending email. The `prod` profile logs
a warning in this mode, but still starts for existing smoke tests. **Real production deployments
must explicitly select SMTP** in the separate GitOps repository before relying on notifications.

Configure these environment variables using the deployment's secret/config mechanism (never commit
credentials):

```text
APP_NOTIFICATION_GATEWAY=smtp
APP_NOTIFICATION_SMTP_HOST=smtp.example.com
APP_NOTIFICATION_SMTP_PORT=587
APP_NOTIFICATION_SMTP_FROM=bookings@example.com
APP_NOTIFICATION_SMTP_USERNAME=<SMTP account>
APP_NOTIFICATION_SMTP_PASSWORD=<SMTP secret>
```

STARTTLS is enabled and required by default, with certificate hostname verification. For implicit
TLS use port 465 and `APP_NOTIFICATION_SMTP_SSL=true`. Do not disable TLS for a remote server.
Use a verified sender address/domain with the provider's SPF/DKIM/DMARC configuration. These
settings are under `app.notification.smtp.*`, not `spring.mail.*`; the application owns the bounded
`JavaMailSender` configuration. The mail dependency version is managed by Spring Boot.

Connect, read and write timeouts default to 5,000 ms each; the corresponding
`APP_NOTIFICATION_SMTP_CONNECT_TIMEOUT_MS`, `APP_NOTIFICATION_SMTP_READ_TIMEOUT_MS` and
`APP_NOTIFICATION_SMTP_WRITE_TIMEOUT_MS` must each be 1–10,000 ms. Host and sender are required
and validated only in SMTP mode. Context initialization does not connect or send mail. An SMTP
outage is recovered by the outbox retry/backoff and stale-claim mechanisms, not by failing startup.

For local testing, point SMTP at a separately started disposable Mailpit instance on loopback
(port 1025), set a test-only sender address, omit username/password, and set
`APP_NOTIFICATION_SMTP_START_TLS=false`. Use synthetic recipients only. No production/customer
delivery should be used to verify a deployment.

The relay claims at most 50 rows at a time and checks its 20-second budget before every batch and
delivery start. Unstarted claims return to PENDING without consuming a retry. In-flight delivery
is not interrupted at the budget boundary; socket timeouts bound individual transport operations.
Claim validation/snapshot and conditional outcome updates use separate short transactions; SMTP
holds no database transaction/row lock. Delivery is **at least once**: a crash after SMTP acceptance
or a lost claim may cause duplicates. `X-Taskflow-Notification-Id` provides a stable outbox identifier
for diagnostics, not a guarantee that a provider deduplicates. SENT means transport acceptance,
not proof that the recipient read the message. Logs exclude recipients, content and mail exception
messages. `app.notification.simulate-failures` applies only to the simulated gateway.

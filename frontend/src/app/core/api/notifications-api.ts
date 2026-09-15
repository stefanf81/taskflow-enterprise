import { Service } from '@angular/core';

/** Admin notification outbox endpoints (`/api/v1/notifications`). */
@Service()
export class NotificationsApi {
  /** Resource URL for the admin notification outbox store. */
  readonly listUrl = '/api/v1/notifications';
}

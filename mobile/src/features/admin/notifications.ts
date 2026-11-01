import { apiClient, RequestOptions } from '../../api/client';
import { NotificationItem } from '../../types/api';
import { parseContract } from '../../api/contracts';
import { notificationOutboxResponseListSchema } from '@taskflow/schemas';

export const notificationsApi = {
  getNotifications: async ({ signal }: RequestOptions = {}): Promise<NotificationItem[]> => {
    const response = await apiClient.get<NotificationItem[]>('/api/v1/notifications', { signal });
    return parseContract(
      notificationOutboxResponseListSchema,
      response.data,
      'GET /api/v1/notifications',
    );
  },
};

import { apiClient } from './client';
import { NotificationItem } from '../types/api';
import { parseContract } from './contracts';
import { notificationOutboxResponseSchema } from '@taskflow/schemas';

export const notificationsApi = {
  getNotifications: async (): Promise<NotificationItem[]> => {
    const response = await apiClient.get<NotificationItem[]>('/api/v1/notifications');
    return parseContract(
      notificationOutboxResponseSchema.array(),
      response.data,
      'GET /api/v1/notifications',
    );
  },
};

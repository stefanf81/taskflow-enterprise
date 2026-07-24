import { apiClient } from './client';
import { NotificationItem } from '../types/api';

export const notificationsApi = {
  getNotifications: async (): Promise<NotificationItem[]> => {
    const response = await apiClient.get<NotificationItem[]>('/api/v1/notifications');
    return response.data;
  },
};

import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '../api/notifications';

export const useNotifications = () => {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getNotifications(),
    refetchInterval: 15000,
  });
};

import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '../api/notifications';

export const NOTIFICATIONS_POLL_MS = 15000;

interface UseNotificationsOptions {
  /**
   * Poll while true. Screens pass their navigation focus state so a mounted-
   * but-hidden tab does not keep polling. Polling additionally pauses while
   * the app is backgrounded (TanStack's focusManager follows AppState, see
   * query/queryClient.ts).
   */
  poll?: boolean;
}

export const useNotifications = ({ poll = true }: UseNotificationsOptions = {}) => {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getNotifications(),
    refetchInterval: poll ? NOTIFICATIONS_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
};

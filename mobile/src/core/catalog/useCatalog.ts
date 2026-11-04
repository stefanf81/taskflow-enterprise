import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateCatalogQueries, queryKeys } from '../../query/queryKeys';
import { catalogApi } from './catalog';

export const useCatalog = () => {
  return useQuery({
    queryKey: queryKeys.catalog.all,
    queryFn: ({ signal }) => catalogApi.getAllServices({ signal }),
    staleTime: 60000,
  });
};

/** Admin only. `enabled: false` keeps it idle until the retired list is on screen. */
export const useRetiredServices = ({ enabled = true }: { enabled?: boolean } = {}) => {
  return useQuery({
    queryKey: queryKeys.catalog.retired,
    queryFn: ({ signal }) => catalogApi.getRetiredServices({ signal }),
    enabled,
  });
};

export const useRestoreService = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => catalogApi.restoreService(id),
    onSuccess: () => invalidateCatalogQueries(queryClient),
  });
};

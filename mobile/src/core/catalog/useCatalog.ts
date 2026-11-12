import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ServiceItemRequest } from '@taskflow/schemas';
import { ServiceItem } from '../../types/api';
import { invalidateCatalogQueries, queryKeys } from '../../query/queryKeys';
import { storage } from '../../utils/storage';
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
    onMutate: () => ({ epoch: storage.getSessionEpoch() }),
    onSuccess: (service, _id, context) => acceptService(queryClient, service, context?.epoch),
  });
};

/** Only committed, validated server responses enter the menu cache; retired cache stays session-fenced. */
function acceptService(queryClient: QueryClient, service: ServiceItem, epoch?: number): void {
  queryClient.setQueryData<ServiceItem[]>(queryKeys.catalog.all, (current = []) =>
    current.some((item) => item.id === service.id)
      ? current.map((item) => item.id === service.id ? service : item)
      : [...current, service],
  );
  if (epoch === undefined || epoch === storage.getSessionEpoch()) {
    queryClient.setQueryData<ServiceItem[]>(queryKeys.catalog.retired, (current) =>
      current?.filter((item) => item.id !== service.id),
    );
  }
  invalidateCatalogQueries(queryClient);
}

export const useCreateService = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ServiceItemRequest) => catalogApi.createService(request),
    onMutate: () => ({ epoch: storage.getSessionEpoch() }),
    onSuccess: (service, _request, context) => acceptService(queryClient, service, context?.epoch),
  });
};

export const useUpdateService = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, request }: { id: number; request: ServiceItemRequest }) => catalogApi.updateService(id, request),
    onMutate: () => ({ epoch: storage.getSessionEpoch() }),
    onSuccess: (service, _variables, context) => acceptService(queryClient, service, context?.epoch),
  });
};

export const useRetireService = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => catalogApi.retireService(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<ServiceItem[]>(queryKeys.catalog.all, (current) => current?.filter((item) => item.id !== id));
      invalidateCatalogQueries(queryClient);
    },
  });
};

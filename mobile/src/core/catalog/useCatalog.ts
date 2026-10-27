import { useQuery } from '@tanstack/react-query';
import { catalogApi } from './catalog';

export const useCatalog = () => {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: () => catalogApi.getAllServices(),
    staleTime: 60000,
  });
};

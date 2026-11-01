import { useQuery } from '@tanstack/react-query';
import { catalogApi } from './catalog';

export const useCatalog = () => {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: ({ signal }) => catalogApi.getAllServices({ signal }),
    staleTime: 60000,
  });
};

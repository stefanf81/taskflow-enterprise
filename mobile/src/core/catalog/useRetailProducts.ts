import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RetailProductRequest } from '@taskflow/schemas';
import { queryKeys } from '../../query/queryKeys';
import { retailProductsApi } from './retailProducts';

/** The shop's retail products, in its order (public; shared by the home screen and the admin). */
export const useRetailProducts = () =>
  useQuery({
    queryKey: queryKeys.retailProducts.all,
    queryFn: ({ signal }) => retailProductsApi.getProducts({ signal }),
    staleTime: 60000,
  });

/** Owner only: create (no id) or update a product, then refetch the list. */
export const useSaveRetailProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, request }: { id: number | null; request: RetailProductRequest }) =>
      id === null
        ? retailProductsApi.createProduct(request)
        : retailProductsApi.updateProduct(id, request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.retailProducts.all }),
  });
};

export const useDeleteRetailProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => retailProductsApi.deleteProduct(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.retailProducts.all }),
  });
};

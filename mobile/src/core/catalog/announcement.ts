import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  announcementResponseSchema,
  announcementSchema,
  AnnouncementRequest,
  AnnouncementResponse,
} from '@taskflow/schemas';
import { apiClient } from '../../api/client';
import { parseContract, parseRequest } from '../../api/contracts';
import { shopInfoQuery } from '../shop/useShopInfo';

/**
 * The owner's edit of the home screen's promo strip. Guests read the strip from the shop info
 * (`useShopInfo().announcement`), which a save refetches.
 */
export const announcementApi = {
  updateAnnouncement: async (request: AnnouncementRequest): Promise<AnnouncementResponse> => {
    const payload = parseRequest(announcementSchema, request, 'PUT /api/v1/catalog/announcement');
    const response = await apiClient.put<unknown>('/api/v1/catalog/announcement', payload);
    return parseContract(announcementResponseSchema, response.data, 'PUT /api/v1/catalog/announcement');
  },
};

export const useUpdateAnnouncement = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AnnouncementRequest) => announcementApi.updateAnnouncement(request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shopInfoQuery.queryKey }),
  });
};

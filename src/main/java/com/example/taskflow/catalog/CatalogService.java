package com.example.taskflow.catalog;

import java.util.List;

public interface CatalogService {
    List<ServiceItemResponse> getAllServices();
    ServiceItemResponse getServiceById(Long id);
    ServiceItemResponse createService(ServiceItemRequest request);
    ServiceItemResponse updateService(Long id, ServiceItemRequest request);
    void deleteService(Long id);
}

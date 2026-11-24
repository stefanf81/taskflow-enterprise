import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, map, Observable } from 'rxjs';
import {
  retailProductResponseSchema,
  retailProductSchema,
  RetailProductRequest,
  RetailProductResponse,
} from '@taskflow/schemas';
import { parseRequest, parseResponse } from './request-validation';

/**
 * Retail product endpoints (`/api/v1/catalog/products`): the public list and the owner's writes.
 * Separate from {@link CatalogApi} on purpose: that one is in main.js (the eager menu), and the
 * products are only needed by a deferred landing block and the admin dashboard.
 */
@Service()
export class RetailProductsApi {
  private readonly http = inject(HttpClient);

  /** Resource URL for {@link RetailProductStore}. */
  readonly productsUrl = '/api/v1/catalog/products';

  createProduct(request: RetailProductRequest): Observable<RetailProductResponse> {
    return defer(() =>
      this.http.post<unknown>(this.productsUrl, parseRequest(retailProductSchema, request)),
    ).pipe(
      map((raw) =>
        parseResponse(retailProductResponseSchema, raw, 'POST /api/v1/catalog/products'),
      ),
    );
  }

  updateProduct(id: number, request: RetailProductRequest): Observable<RetailProductResponse> {
    return defer(() =>
      this.http.put<unknown>(
        `${this.productsUrl}/${id}`,
        parseRequest(retailProductSchema, request),
      ),
    ).pipe(
      map((raw) =>
        parseResponse(retailProductResponseSchema, raw, 'PUT /api/v1/catalog/products/{id}'),
      ),
    );
  }

  deleteProduct(id: number): Observable<void> {
    return defer(() => this.http.delete<void>(`${this.productsUrl}/${id}`));
  }
}

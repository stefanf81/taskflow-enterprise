import { http, HttpResponse } from 'msw';

export const handlers = [http.get('/api/v1/catalog', () => HttpResponse.json([]))];

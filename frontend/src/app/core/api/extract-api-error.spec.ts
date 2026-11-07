import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { NETWORK_ERROR_MESSAGE, extractApiError } from './extract-api-error';

const httpError = (status: number, error: unknown) =>
  new HttpErrorResponse({ status, error, url: '/api/v1/x' });

describe('extractApiError', () => {
  it('prefers the problem detail, then the legacy message', () => {
    expect(
      extractApiError(
        httpError(409, { title: 'Conflict', detail: 'Slot taken', message: 'x' }),
        'f',
      ),
    ).toBe('Slot taken');
    expect(extractApiError(httpError(400, { message: 'No past bookings' }), 'f')).toBe(
      'No past bookings',
    );
  });

  it('falls back instead of showing the edge’s bare reason phrase', () => {
    const nginx = { type: 'about:blank', title: 'Bad Gateway', status: 502 };
    expect(extractApiError(httpError(502, nginx), 'Could not save the service.')).toBe(
      'Could not save the service.',
    );
  });

  it('names a transport failure as such', () => {
    expect(extractApiError(httpError(0, null), 'f')).toBe(NETWORK_ERROR_MESSAGE);
  });
});

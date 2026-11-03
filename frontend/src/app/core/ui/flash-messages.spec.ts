import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthState } from '../auth/auth.state';
import { FlashMessages, SUCCESS_BANNER_MS } from './flash-messages';

describe('FlashMessages (app-wide banner)', () => {
  let flash: FlashMessages;
  let authState: AuthState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    flash = TestBed.inject(FlashMessages);
    authState = TestBed.inject(AuthState);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty', () => {
    expect(flash.errorMessage()).toBeNull();
    expect(flash.successMessage()).toBeNull();
  });

  it('dismisses a success message by itself, and a newer one restarts the timer', () => {
    vi.useFakeTimers();
    flash.showSuccess('first');
    vi.advanceTimersByTime(SUCCESS_BANNER_MS - 100);
    flash.showSuccess('second');
    vi.advanceTimersByTime(200);
    expect(flash.successMessage()).toBe('second');

    vi.advanceTimersByTime(SUCCESS_BANNER_MS);
    expect(flash.successMessage()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears both messages and the pending auto-dismiss when the session ends', () => {
    vi.useFakeTimers();
    authState.applyRole('ROLE_ADMIN', 'admin');
    flash.errorMessage.set('boom');
    flash.showSuccess('done');

    authState.clear();

    expect(flash.errorMessage()).toBeNull();
    expect(flash.successMessage()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops a guest form error when someone signs in', () => {
    flash.errorMessage.set('Verification failed. Please check your Booking Code and Email.');

    authState.applyRole('ROLE_CUSTOMER', 'jane@example.com');

    expect(flash.errorMessage()).toBeNull();
  });

  it('does not erase the message of an action that fails after the session ended', () => {
    authState.applyRole('ROLE_ADMIN', 'admin');
    authState.clear();

    flash.reportActionError({ status: 409, error: { message: 'Already approved' } }, 'fallback');

    expect(flash.errorMessage()).toBe('Already approved');
  });

  it('reports an action failure with its fallback copy when the server says nothing', () => {
    flash.reportActionError({ status: 500 }, 'Failed to delete booking.');
    expect(flash.errorMessage()).toBe('Failed to delete booking.');
  });

  it('skips the action banner for a 401 (the session-expiry flow explains it)', () => {
    flash.reportActionError({ status: 401 }, 'Failed to approve appointment.');
    expect(flash.errorMessage()).toBeNull();
  });
});

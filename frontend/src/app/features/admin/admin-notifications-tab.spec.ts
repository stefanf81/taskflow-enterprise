import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminNotificationsTab } from './admin-notifications-tab';

describe('AdminNotificationsTab', () => {
  let fixture: ComponentFixture<AdminNotificationsTab>;
  let httpMock: HttpTestingController;

  const element = () => fixture.nativeElement as HTMLElement;
  const text = () => element().textContent ?? '';

  async function respond(body: object, status = 200): Promise<void> {
    const req = httpMock.expectOne('/api/v1/notifications');
    if (status === 200) {
      req.flush(body);
    } else {
      req.flush(body, { status, statusText: 'Error' });
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminNotificationsTab],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminNotificationsTab);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('lists outbox entries, including ones not sent yet', async () => {
    await respond([
      {
        id: 1,
        message: 'Your appointment is confirmed',
        recipient: 'a***@example.com',
        retryCount: 0,
        sentAt: '2026-07-01T09:00:00',
        status: 'SENT',
        type: 'EMAIL',
      },
      {
        id: 2,
        message: 'Reminder',
        recipient: 'b***@example.com',
        retryCount: 1,
        status: 'PENDING',
      },
    ]);

    expect(text()).toContain('EMAIL');
    expect(text()).toContain('a***@example.com');
    expect(text()).toContain('Your appointment is confirmed');
    expect(text()).toContain('SENT');
    expect(text()).toContain('Reminder');
    expect(text()).toContain('PENDING');
    expect(text()).not.toContain('No notifications sent yet');
  });

  it('shows an empty state when nothing was sent', async () => {
    await respond([]);
    expect(text()).toContain('No notifications sent yet');
  });

  it('shows the error with a Retry button that reloads the outbox', async () => {
    await respond({ message: 'boom' }, 500);
    expect(text()).toContain('Could not load notification outbox.');
    expect(text()).not.toContain('No notifications sent yet');

    const retry = Array.from(element().querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Retry'),
    );
    expect(retry).toBeDefined();
    retry!.click();
    fixture.detectChanges();

    await respond([]);
    expect(text()).not.toContain('Could not load notification outbox.');
    expect(text()).toContain('No notifications sent yet');
  });
});

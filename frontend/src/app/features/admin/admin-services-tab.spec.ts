import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminServicesTab } from './admin-services-tab';

describe('AdminServicesTab', () => {
  let fixture: ComponentFixture<AdminServicesTab>;
  let httpMock: HttpTestingController;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  function flush(url: string, body: object, status = 200): void {
    const req = httpMock.expectOne(url);
    if (status === 200) {
      req.flush(body);
    } else {
      req.flush(body, { status, statusText: 'Error' });
    }
  }

  /**
   * Answers the two requests the tab makes on mount. Both are flushed before waiting: whenStable()
   * does not settle while either one is pending.
   */
  async function respond(
    body: object,
    status = 200,
    retired: { body: object; status?: number } = { body: [] },
  ): Promise<void> {
    flush('/api/v1/catalog', body, status);
    flush('/api/v1/catalog/retired', retired.body, retired.status);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminServicesTab],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminServicesTab);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  const retiredService = {
    id: 7,
    name: 'Old Fade',
    price: 30,
    durationMinutes: 25,
    category: 'hair',
  };

  it('shows a loading state until the catalog arrives', async () => {
    expect(text()).toContain('Loading catalog');
    await respond([]);
    expect(text()).not.toContain('Loading catalog');
  });

  it('lists every service with its price and duration', async () => {
    await respond([
      { id: 1, name: 'Classic Haircut', price: 25, durationMinutes: 30, category: 'hair' },
      {
        id: 2,
        name: 'Beard Trim',
        price: 15,
        durationMinutes: 20,
        category: 'beard',
        description: 'Shape and line-up',
      },
    ]);

    expect(text()).toContain('Classic Haircut');
    expect(text()).toContain('$25');
    expect(text()).toContain('30 mins');
    expect(text()).toContain('Beard Trim');
    expect(text()).toContain('Shape and line-up');
    expect(text()).not.toContain('No services in the catalog yet');
  });

  it('shows an empty state for an empty catalog', async () => {
    await respond([]);
    expect(text()).toContain('No services in the catalog yet');
  });

  it('shows the error instead of the list when the request fails', async () => {
    await respond({ message: 'boom' }, 500);
    expect(text()).toContain('Could not load service catalog.');
    expect(text()).not.toContain('No services in the catalog yet');
  });

  it('treats a response that breaks the contract as an error', async () => {
    await respond([{ id: 1, name: 'Classic Haircut' }]);
    expect(text()).toContain('Could not load service catalog.');
  });

  describe('retired services', () => {
    const restoreButton = () =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
        (b) => b.textContent?.includes('Restor'), // "Restore", or "Restoring…" while in flight
      ) as HTMLButtonElement | undefined;

    it('lists the retired services separately from the menu', async () => {
      await respond([], 200, { body: [retiredService] });

      expect(text()).toContain('Retired services');
      expect(text()).toContain('Old Fade');
      expect(restoreButton()).toBeTruthy();
    });

    it('says so when nothing is retired', async () => {
      await respond([]);

      expect(text()).toContain('No retired services.');
      expect(restoreButton()).toBeUndefined();
    });

    it('shows the failure with a retry when the list cannot be loaded', async () => {
      await respond([], 200, { body: { message: 'boom' }, status: 500 });

      expect(text()).toContain('Could not load retired services.');
      const retry = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).find((b) => b.textContent?.includes('Retry'));
      retry!.click();
      fixture.detectChanges();
      flush('/api/v1/catalog/retired', [retiredService]);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(text()).toContain('Old Fade');
    });

    it('restores a service, then refreshes the menu and the retired list', async () => {
      await respond([], 200, { body: [retiredService] });

      restoreButton()!.click();
      fixture.detectChanges();
      const post = httpMock.expectOne('/api/v1/catalog/7/restore');
      expect(post.request.method).toBe('POST');
      expect(restoreButton()!.disabled).toBe(true);
      post.flush({ ...retiredService, description: 'back' });
      fixture.detectChanges();

      // The restored service moves from the retired list to the menu.
      flush('/api/v1/catalog', [{ ...retiredService, description: 'back' }]);
      flush('/api/v1/catalog/retired', []);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(text()).toContain('Old Fade is bookable again.');
      expect(text()).toContain('No retired services.');
    });

    it('keeps the service listed and shows the error when a restore fails', async () => {
      await respond([], 200, { body: [retiredService] });

      restoreButton()!.click();
      flush('/api/v1/catalog/7/restore', { message: 'Service not found with id: 7' }, 404);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(text()).toContain('Service not found with id: 7');
      expect(text()).toContain('Old Fade');
      expect(restoreButton()!.disabled).toBe(false);
    });
  });
});

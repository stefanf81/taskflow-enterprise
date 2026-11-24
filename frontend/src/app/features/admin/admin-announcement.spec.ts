import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SHOP_RULES } from '@taskflow/domain';
import { AdminAnnouncement } from './admin-announcement';

const SHOP = (r: { url: string }) => r.url.endsWith('/public/shop');
const PUT = { method: 'PUT', url: '/api/v1/catalog/announcement' };

describe('AdminAnnouncement', () => {
  let fixture: ComponentFixture<AdminAnnouncement>;
  let httpMock: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const textarea = () => el().querySelector('textarea') as HTMLTextAreaElement;
  const button = (label: string) =>
    Array.from(el().querySelectorAll('button')).find((b) =>
      b.textContent?.includes(label),
    ) as HTMLButtonElement;

  async function shopAnswers(announcement?: string): Promise<void> {
    TestBed.tick();
    httpMock
      .expectOne(SHOP)
      .flush({ ...DEFAULT_SHOP_RULES, timeZone: 'UTC', ...(announcement ? { announcement } : {}) });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [AdminAnnouncement],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AdminAnnouncement);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await shopAnswers('Old promo');
  });

  afterEach(() => httpMock.verify());

  it('starts from the published text and counts characters', () => {
    expect(textarea().value).toBe('Old promo');
    expect(el().textContent).toContain('9 / 120 characters');
  });

  it('saves the trimmed text, then reloads the shop info', async () => {
    textarea().value = '  New promo  ';
    textarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    const put = httpMock.expectOne(PUT);
    expect(put.request.body).toEqual({ message: 'New promo' });
    put.flush({ active: true, message: 'New promo' });
    await shopAnswers('New promo');

    expect(el().querySelector('[role="status"]')?.textContent).toContain('Announcement saved.');
    expect(textarea().value).toBe('New promo');
  });

  it('hides the strip with an empty message', async () => {
    button('Hide the strip').click();
    const put = httpMock.expectOne(PUT);
    expect(put.request.body).toEqual({});
    put.flush({ active: false });
    await shopAnswers();

    expect(el().textContent).toContain('The strip is hidden.');
    expect(button('Hide the strip').disabled).toBe(true);
  });

  it('shows a server error', async () => {
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    httpMock
      .expectOne(PUT)
      .flush({ message: 'Validation failed' }, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Validation failed');
  });
});

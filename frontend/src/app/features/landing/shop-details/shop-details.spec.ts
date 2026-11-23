import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SHOP_RULES } from '@taskflow/domain';
import { ShopDetails } from './shop-details';

/** The body of the "Client Ratings" card (the box that holds its height while loading). */
function ratingsBody(root: HTMLElement): HTMLElement | undefined {
  const heading = Array.from(root.querySelectorAll<HTMLElement>('h3')).find((h) =>
    h.textContent?.includes('Client Ratings'),
  );
  return (heading?.nextElementSibling as HTMLElement | null) ?? undefined;
}

describe('ShopDetails (the landing page shop cards)', () => {
  let fixture: ComponentFixture<ShopDetails>;
  let httpMock: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ShopDetails],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ShopDetails);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  const ratings = (r: { url: string }) => r.url.includes('/reviews/public/barber-ratings');
  const catalog = (r: { url: string }) => r.url.endsWith('/api/v1/catalog');

  /** Answers what the cards ask for on mount; the pieces a test cares about are passed in. */
  async function answer(
    options: { ratings?: object[]; catalog?: object[] | null; shop?: boolean } = {},
  ): Promise<void> {
    TestBed.tick();
    httpMock.match(ratings).forEach((r) => r.flush(options.ratings ?? []));
    httpMock
      .match(catalog)
      .forEach((r) =>
        options.catalog === null
          ? r.flush(null, { status: 500, statusText: 'Server Error' })
          : r.flush(options.catalog ?? []),
      );
    httpMock
      .match((r) => r.url.endsWith('/public/shop'))
      .forEach((r) => r.flush({ ...DEFAULT_SHOP_RULES, timeZone: 'UTC' }));
    httpMock.match((r) => r.url.endsWith('/catalog/products')).forEach((r) => r.flush([]));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('holds the ratings box empty (not "No reviews yet") until the ratings have answered', () => {
    // The prerendered page and a slow first load: nothing is known, so the card keeps its room.
    const body = ratingsBody(el());
    expect(body?.classList).toContain('min-h-12');
    expect(body?.textContent?.trim()).toBe('');
    httpMock.match(() => true);
  });

  it('shows the opening hours from the shop info', async () => {
    await answer();
    // DEFAULT_SHOP_RULES: Monday-Saturday 09:00-17:00.
    expect(el().textContent).toContain('Monday - Saturday');
    expect(el().textContent).toContain('9:00 AM - 5:00 PM');
    expect(el().textContent).toMatch(/Sunday\s*CLOSED/);
  });

  it('says so when nobody has been reviewed yet', async () => {
    await answer();
    expect(ratingsBody(el())?.textContent).toContain('No reviews yet');
  });

  it('shows the real shop rating instead of a hand-picked quote', async () => {
    await answer({
      ratings: [
        { barberName: 'Alex the Barber', averageRating: 4.5, reviewCount: 10 },
        { barberName: 'Sara the Stylist', averageRating: 5, reviewCount: 30 },
      ],
    });

    const text = ratingsBody(el())?.textContent?.replace(/\s+/g, ' ') ?? '';
    // (4.5 × 10 + 5 × 30) / 40 = 4.875
    expect(text).toContain('4.9 out of 5');
    expect(text).toContain('from 40 reviews');
    expect(text).toContain('Top rated: Sara the Stylist · 5.0');
    expect(el().textContent).not.toContain('Liam K.');
  });

  describe('failed menu load (FE-1)', () => {
    it('keeps the cards alive and offers a retry', async () => {
      await answer({ catalog: null });
      expect(el().textContent).toContain('Could not load service catalog.');
      expect(el().textContent).toContain('Grooming Menu');

      (el().querySelector('[role="alert"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      TestBed.tick();
      httpMock.match(catalog).forEach((r) => r.flush([]));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().textContent).not.toContain('Could not load service catalog.');
    });
  });
});

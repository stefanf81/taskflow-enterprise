import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RetailProducts } from './retail-products';

describe('RetailProducts (landing card rows)', () => {
  let fixture: ComponentFixture<RetailProducts>;
  let httpMock: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RetailProducts],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(RetailProducts);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  async function answer(body: object | null, status = 200): Promise<void> {
    const req = httpMock.expectOne('/api/v1/catalog/products');
    if (status === 200) req.flush(body);
    else req.flush({}, { status, statusText: 'Error' });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('holds three placeholder rows while loading, then lists the products in order', async () => {
    expect(el().querySelectorAll('[aria-hidden="true"] .h-4')).toHaveLength(3);

    await answer([
      { id: 1, name: 'Styling Fiber Clay', sizeLabel: '100ml', price: 24, sortOrder: 1 },
      { id: 2, name: 'Comb', price: 5, sortOrder: 2 },
    ]);

    const rows = Array.from(el().querySelectorAll('li')).map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toEqual(['Styling Fiber Clay (100ml)$24.00', 'Comb$5.00']);
  });

  it('says so when the shop lists no products', async () => {
    await answer([]);
    expect(el().textContent).toContain("Ask in the shop about today's products.");
  });

  it('shows an error with a retry that loads the list again', async () => {
    await answer(null, 500);
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load the products.',
    );

    (el().querySelector('[role="alert"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await answer([{ id: 1, name: 'Comb', price: 5, sortOrder: 1 }]);
    expect(el().textContent).toContain('Comb');
  });
});

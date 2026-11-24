import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminRetailProducts } from './admin-retail-products';

const URL = '/api/v1/catalog/products';
const clay = { id: 1, name: 'Styling Fiber Clay', sizeLabel: '100ml', price: 24, sortOrder: 1 };

describe('AdminRetailProducts', () => {
  let fixture: ComponentFixture<AdminRetailProducts>;
  let httpMock: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const buttons = () => Array.from(el().querySelectorAll('button'));
  const button = (label: string) =>
    buttons().find((b) => b.textContent?.trim().startsWith(label)) as HTMLButtonElement;
  const type = (id: string, value: string) => {
    const input = el().querySelector(`#${id}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [AdminRetailProducts],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AdminRetailProducts);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne({ method: 'GET', url: URL }).flush([clay]);
    await settle();
  });

  afterEach(() => httpMock.verify());

  it('lists the products with price and position', () => {
    expect(el().textContent).toContain('Styling Fiber Clay');
    expect(el().textContent).toContain('(100ml)');
    expect(el().textContent).toContain('$24.00');
    expect(el().textContent).toContain('position 1');
  });

  it('adds a product at the end of the list and reloads it', async () => {
    button('Add product').click();
    fixture.detectChanges();
    expect((el().querySelector('#product-position') as HTMLInputElement).value).toBe('2');

    type('product-name', '  Matte Paste ');
    type('product-size', ' ');
    type('product-price', '18.5');
    fixture.detectChanges();
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    const post = httpMock.expectOne({ method: 'POST', url: URL });
    expect(post.request.body).toEqual({ name: 'Matte Paste', price: 18.5, sortOrder: 2 });
    post.flush({ id: 2, name: 'Matte Paste', price: 18.5, sortOrder: 2 });
    TestBed.tick();
    httpMock.expectOne({ method: 'GET', url: URL }).flush([clay]);
    await settle();

    expect(el().querySelector('form')).toBeNull();
    expect(el().querySelector('[role="status"]')?.textContent).toContain('Matte Paste added.');
  });

  it('validates before sending', () => {
    button('Add product').click();
    fixture.detectChanges();
    type('product-price', '10');
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    httpMock.expectNone({ method: 'POST', url: URL });
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Product name is required');
  });

  it('edits a product and shows a server error', async () => {
    button('Edit').click();
    fixture.detectChanges();
    expect((el().querySelector('#product-name') as HTMLInputElement).value).toBe(
      'Styling Fiber Clay',
    );
    (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    httpMock
      .expectOne({ method: 'PUT', url: `${URL}/1` })
      .flush(
        { message: "A product named 'Styling Fiber Clay' already exists." },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('already exists');
  });

  it('asks before deleting', async () => {
    button('Delete').click();
    fixture.detectChanges();
    button('Keep').click();
    fixture.detectChanges();
    httpMock.expectNone({ method: 'DELETE', url: `${URL}/1` });

    button('Delete').click();
    fixture.detectChanges();
    button('Delete Styling Fiber Clay?').click();
    httpMock.expectOne({ method: 'DELETE', url: `${URL}/1` }).flush(null);
    TestBed.tick();
    httpMock.expectOne({ method: 'GET', url: URL }).flush([]);
    await settle();

    expect(el().textContent).toContain('Styling Fiber Clay removed.');
    expect(el().textContent).toContain('No retail products');
  });
});

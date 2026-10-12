import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminServicesTab } from './admin-services-tab';

describe('AdminServicesTab', () => {
  let fixture: ComponentFixture<AdminServicesTab>;
  let httpMock: HttpTestingController;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  async function respond(body: object, status = 200): Promise<void> {
    const req = httpMock.expectOne('/api/v1/catalog');
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
      imports: [AdminServicesTab],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminServicesTab);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

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
});

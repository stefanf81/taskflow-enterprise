import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SHOP_RULES } from '@taskflow/domain';
import { AnnouncementBarComponent } from './announcement-bar';

describe('AnnouncementBarComponent', () => {
  let fixture: ComponentFixture<AnnouncementBarComponent>;
  let httpMock: HttpTestingController;
  const bar = () => (fixture.nativeElement as HTMLElement).querySelector('div');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AnnouncementBarComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AnnouncementBarComponent);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  async function answer(announcement?: string): Promise<void> {
    httpMock
      .expectOne((r) => r.url.endsWith('/public/shop'))
      .flush({ ...DEFAULT_SHOP_RULES, timeZone: 'UTC', ...(announcement ? { announcement } : {}) });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('holds its room, invisibly, until the shop info is known (the prerendered state)', () => {
    expect(bar()?.classList).toContain('invisible');
    expect(bar()?.className).toContain('h-[69px]');
    expect(bar()?.textContent?.trim()).toBe('');
    httpMock.expectOne((r) => r.url.endsWith('/public/shop'));
  });

  it("shows the owner's text once known", async () => {
    await answer('Half-price beard trims on Tuesdays');
    expect(bar()?.classList).not.toContain('invisible');
    expect(bar()?.textContent?.trim()).toBe('Half-price beard trims on Tuesdays');
  });

  it('collapses when the owner has turned the strip off', async () => {
    await answer();
    expect(bar()).toBeNull();
  });
});

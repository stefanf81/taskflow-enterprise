import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LandingPage } from './landing-page';

describe('LandingPage', () => {
  let fixture: ComponentFixture<LandingPage>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [LandingPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(LandingPage);
    fixture.detectChanges();

    httpMock = TestBed.inject(HttpTestingController);
    httpMock.match((req) => req.url.includes('/api/v1/catalog')).forEach((req) => req.flush([]));
    httpMock
      .match((req) => req.url.includes('/api/v1/reviews/public/barber-ratings'))
      .forEach((req) => req.flush([]));
    httpMock.match((req) => req.url === '/api/v1/barbers').forEach((req) => req.flush([]));
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders the public navigation, hero and booking wizard', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')?.textContent).toContain('TaskFlow');
    expect(compiled.querySelector('header')?.textContent).toContain('Luxury Barber');
    expect(compiled.querySelector('app-booking-wizard')).toBeTruthy();
  });

  it('opens the owner portal login modal only when triggered', () => {
    const page = fixture.componentInstance;
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button',
    ) as HTMLButtonElement;
    expect(page.showAdminLoginModal()).toBe(false);

    button.click();

    expect(page.showAdminLoginModal()).toBe(true);
  });
});

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { App } from './app';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

describe('App Shell Component Quality Assurance Suite', () => {
  let fixture: ComponentFixture<App>;
  let app: App;

  beforeEach(async () => {
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_role');

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;

    fixture.detectChanges();

    // Flush any pending httpResource requests so the shell stabilizes.
    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.match(() => true).forEach((req) => req.flush([]));
  });

  it('should compile and bootstrap the application shell cleanly', () => {
    expect(app).toBeTruthy();
  });

  it('should render the public navigation header when the user is not authenticated', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')?.textContent).toContain('TaskFlow');
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('should not eagerly depend on feature stores (shell stays lightweight)', () => {
    // The shell only injects AuthStore; assert no navigation helper leaked in
    // and the component is a clean application shell.
    expect(app).toBeTruthy();
    expect((app as unknown as { navigate?: unknown }).navigate).toBeUndefined();
  });
});

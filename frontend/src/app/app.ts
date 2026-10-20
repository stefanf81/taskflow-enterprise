import { Component, OnInit, inject, DestroyRef } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthState } from './auth.state';
import { isServerRender } from './core/platform';

/**
 * Application shell.
 *
 * Restores the in-memory auth role from the HttpOnly session cookie once per
 * boot (deep-links are also covered by the route guard) and renders the active
 * route. All page-level UI lives in feature components.
 *
 * It deliberately does NOT navigate after the restore: that used to bounce every
 * signed-in user to their dashboard from ANY url (a customer deep-linking to
 * `/customer/book` landed on `/customer`). The landing page redirects signed-in
 * users from `/`, and the route guard handles protected deep-links.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly authState = inject(AuthState);
  private readonly destroyRef = inject(DestroyRef);
  private readonly prerendering = isServerRender();

  ngOnInit(): void {
    // Prerendering (build time) renders the guest view: there is no session and no backend. The
    // browser restores the session after hydration, as it did on a client-rendered first paint.
    if (this.prerendering) return;
    // A 401 ("no session") is handled inside AuthState.bootstrap(); the error is
    // swallowed here on purpose — clearing again could wipe a login that happened
    // while a slow /me was still in flight.
    this.authState
      .bootstrap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }
}

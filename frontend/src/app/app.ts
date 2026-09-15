import { Component, OnInit, inject, DestroyRef } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthState } from './auth.state';

/**
 * Application shell.
 *
 * Restores the in-memory auth role from the HttpOnly session cookie once per
 * boot (deep-links are also covered by the route guard) and renders the active
 * route. All page-level UI lives in feature components.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly authState = inject(AuthState);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.authState
      .bootstrap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (role) => {
          if (role) {
            this.router.navigateByUrl(this.authState.dashboardPathFor(role));
          }
        },
        error: () => {
          // No active session — stay logged out.
          this.authState.clear();
        },
      });
  }
}

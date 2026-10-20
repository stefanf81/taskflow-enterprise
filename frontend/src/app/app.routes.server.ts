import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // The guest landing is prerendered at build time: every first visit paints its HTML before the
  // JavaScript has loaded, and the bundle then hydrates it.
  { path: '', renderMode: RenderMode.Prerender },
  // Everything else depends on the session (guarded dashboards, the 404 redirect): the browser
  // renders it from index.csr.html, exactly as before.
  { path: '**', renderMode: RenderMode.Client },
];

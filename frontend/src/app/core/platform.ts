import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';

/**
 * True while the app renders on the server, which only happens when the guest landing is
 * prerendered at build time (app.routes.server.ts). Call it in an injection context.
 */
export function isServerRender(): boolean {
  return isPlatformServer(inject(PLATFORM_ID));
}

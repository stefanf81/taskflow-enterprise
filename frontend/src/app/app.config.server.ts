import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { HttpBackend } from '@angular/common/http';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { PrerenderBackend } from './core/http/prerender-backend';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: HttpBackend, useClass: PrerenderBackend },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

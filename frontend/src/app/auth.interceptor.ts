import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const token = sessionStorage.getItem('auth_token');
  
  // Skip attaching token if we are hitting the login endpoint
  if (req.url.includes('/api/v1/auth/login')) {
    return next(req);
  }

  let authReq = req;
  if (token) {
    authReq = req.clone({
      headers: req.headers.set('Authorization', token)
    });
  }

  return next(authReq).pipe(
    catchError(err => {
      if (err.status === 401) {
        sessionStorage.removeItem('auth_token');
        // Do not redirect to /login to prevent infinite routing loops on public endpoints
      }
      return throwError(() => err);
    })
  );
};

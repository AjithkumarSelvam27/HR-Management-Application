import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService, Role } from '../services/auth.service';

/** Requires a session; users who still must change their password are sent to /change-password. */
export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ready$.pipe(
    map(() => {
      const s = auth.session();
      if (!s) return router.createUrlTree(['/login'], { queryParams: { from: state.url } });
      if (s.must_change_password) return router.createUrlTree(['/change-password']);
      return true;
    }),
  );
};

/** Requires one of the given roles (UI convenience only — the server enforces access on every request). */
export const roleGuard = (...roles: Role[]): CanActivateFn => (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ready$.pipe(
    map(() => {
      const s = auth.session();
      if (!s) return router.createUrlTree(['/login'], { queryParams: { from: state.url } });
      if (s.must_change_password) return router.createUrlTree(['/change-password']);
      return roles.includes(s.role) ? true : router.createUrlTree(['/access-denied']);
    }),
  );
};

/** Auth pages (login etc.) bounce signed-in users to the dashboard. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ready$.pipe(map(() => (auth.session() ? router.createUrlTree(['/']) : true)));
};

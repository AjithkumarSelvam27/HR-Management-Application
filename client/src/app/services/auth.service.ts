import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, ReplaySubject, catchError, of, tap } from 'rxjs';

export type Role = 'super_admin' | 'hr_admin' | 'manager' | 'employee';

export interface Session {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  employee_id: number | null;
  must_change_password: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  readonly session = signal<Session | null>(null);
  readonly isHr = computed(() => ['super_admin', 'hr_admin'].includes(this.session()?.role ?? ''));
  readonly isSuper = computed(() => this.session()?.role === 'super_admin');
  readonly isManager = computed(() => this.session()?.role === 'manager');

  // ReplaySubject so a guard that subscribes after the first check resolved still gets the answer.
  private readonly readySubject = new ReplaySubject<void>(1);
  readonly ready$ = this.readySubject.asObservable();

  constructor() {
    this.refreshSession();
  }

  refreshSession(): void {
    this.http
      .get<Session | null>('/api/auth/session')
      .pipe(catchError(() => of(null)))
      .subscribe((s) => {
        this.session.set(s);
        this.readySubject.next();
      });
  }

  signIn(email: string, password: string): Observable<Session> {
    return this.http.post<Session>('/api/auth/signin', { email, password }).pipe(tap((s) => this.session.set(s)));
  }

  register(name: string, email: string, password: string): Observable<Session> {
    return this.http.post<Session>('/api/auth/register', { name, email, password }).pipe(tap((s) => this.session.set(s)));
  }

  signOut(): Observable<unknown> {
    return this.http.post('/api/auth/signout', {}).pipe(tap(() => this.session.set(null)));
  }

  changePassword(current_password: string, new_password: string): Observable<unknown> {
    return this.http
      .post('/api/auth/change-password', { current_password, new_password })
      .pipe(tap(() => this.session.update((s) => (s ? { ...s, must_change_password: false } : s))));
  }
}

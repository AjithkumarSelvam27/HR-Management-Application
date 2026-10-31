import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, errMsg } from '../services/api.service';
import { AuthService } from '../services/auth.service';

const HINT = 'At least 8 characters, with a letter and a number.';

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <form class="auth-card" (ngSubmit)="submit()">
        <h1>Reset your password</h1>
        @if (done()) {
          <div class="success">If the account exists, an email was sent.</div>
        } @else {
          @if (error()) { <div class="error">{{ error() }}</div> }
          <p class="muted">Enter your work email and we'll send a reset link.</p>
          <div class="field"><label for="e">Email</label><input id="e" name="email" type="email" [(ngModel)]="email" required /></div>
          <button type="submit" [disabled]="busy()">Send reset link</button>
        }
        <p style="margin-top:14px"><a routerLink="/login">Back to sign in</a></p>
      </form>
    </div>
  `,
})
export class ForgotPasswordComponent {
  private api = inject(ApiService);
  email = '';
  done = signal(false);
  busy = signal(false);
  error = signal('');
  submit() {
    this.busy.set(true);
    this.api.post('/auth/forgot-password', { email: this.email }).subscribe({
      next: () => { this.busy.set(false); this.done.set(true); },
      error: (e) => { this.busy.set(false); this.error.set(errMsg(e)); },
    });
  }
}

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <form class="auth-card" (ngSubmit)="submit()">
        <h1>Choose a new password</h1>
        @if (done()) {
          <div class="success">Password updated. You can now sign in.</div>
          <a routerLink="/login" class="btn">Go to sign in</a>
        } @else {
          @if (error()) { <div class="error">{{ error() }}</div> }
          <div class="field"><label for="p">New password</label>
            <input id="p" name="pw" type="password" [(ngModel)]="pw" required autocomplete="new-password" />
            <div class="muted">${HINT}</div></div>
          <button type="submit" [disabled]="busy()">Update password</button>
        }
      </form>
    </div>
  `,
})
export class ResetPasswordComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  pw = '';
  done = signal(false);
  busy = signal(false);
  error = signal('');
  submit() {
    this.busy.set(true);
    const token = this.route.snapshot.queryParamMap.get('token') || '';
    this.api.post('/auth/reset-password', { token, new_password: this.pw }).subscribe({
      next: () => { this.busy.set(false); this.done.set(true); },
      error: (e) => { this.busy.set(false); this.error.set(errMsg(e)); },
    });
  }
}

@Component({
  imports: [FormsModule],
  template: `
    <div class="auth-wrap">
      <form class="auth-card" (ngSubmit)="submit()">
        <h1>Change your password</h1>
        @if (auth.session()?.must_change_password) {
          <p class="muted">For security you must set a new password before continuing.</p>
        }
        @if (error()) { <div class="error">{{ error() }}</div> }
        <div class="field"><label for="c">Current (temporary) password</label>
          <input id="c" name="cur" type="password" [(ngModel)]="current" required autocomplete="current-password" /></div>
        <div class="field"><label for="n">New password</label>
          <input id="n" name="new" type="password" [(ngModel)]="next" required autocomplete="new-password" />
          <div class="muted">${HINT}</div></div>
        <button type="submit" [disabled]="busy()">Update password</button>
      </form>
    </div>
  `,
})
export class ChangePasswordComponent {
  protected auth = inject(AuthService);
  private router = inject(Router);
  current = '';
  next = '';
  busy = signal(false);
  error = signal('');
  submit() {
    this.busy.set(true);
    this.auth.changePassword(this.current, this.next).subscribe({
      next: () => { this.busy.set(false); this.router.navigateByUrl('/'); },
      error: (e) => { this.busy.set(false); this.error.set(errMsg(e)); },
    });
  }
}

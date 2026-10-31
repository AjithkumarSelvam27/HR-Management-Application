import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { errMsg } from '../services/api.service';
import { AuthService } from '../services/auth.service';

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <form class="auth-card" (ngSubmit)="submit()">
        <h1>HRMS sign in</h1>
        @if (error()) { <div class="error">{{ error() }}</div> }
        <div class="field"><label for="email">Email</label>
          <input id="email" name="email" type="email" [(ngModel)]="email" required autocomplete="username" /></div>
        <div class="field"><label for="pw">Password</label>
          <input id="pw" name="password" type="password" [(ngModel)]="password" required autocomplete="current-password" /></div>
        <button type="submit" [disabled]="busy()" style="width:100%">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
        <p style="margin-top:14px"><a routerLink="/forgot-password">Forgot password?</a></p>
        <p>New here? <a routerLink="/register">Create an account</a></p>
      </form>
    </div>
  `,
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  email = '';
  password = '';
  error = signal('');
  busy = signal(false);

  submit() {
    this.error.set('');
    this.busy.set(true);
    this.auth.signIn(this.email, this.password).subscribe({
      next: (s) => {
        this.busy.set(false);
        if (s.must_change_password) return void this.router.navigateByUrl('/change-password');
        this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('from') || '/');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errMsg(e));
      },
    });
  }
}

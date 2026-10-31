import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errMsg } from '../services/api.service';
import { AuthService } from '../services/auth.service';

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <form class="auth-card" (ngSubmit)="submit()">
        <h1>Create account</h1>
        @if (error()) { <div class="error">{{ error() }}</div> }
        <div class="field"><label for="name">Full name</label>
          <input id="name" name="name" [(ngModel)]="name" required autocomplete="name" /></div>
        <div class="field"><label for="email">Email</label>
          <input id="email" name="email" type="email" [(ngModel)]="email" required autocomplete="username" /></div>
        <div class="field"><label for="pw">Password</label>
          <input id="pw" name="password" type="password" [(ngModel)]="password" required autocomplete="new-password" />
          <div class="muted">At least 8 characters, with a letter and a number.</div></div>
        <div class="field"><label for="pw2">Confirm password</label>
          <input id="pw2" name="confirm" type="password" [(ngModel)]="confirm" required autocomplete="new-password" /></div>
        <button type="submit" [disabled]="busy()" style="width:100%">{{ busy() ? 'Creating…' : 'Register' }}</button>
        <p style="margin-top:14px">Already have an account? <a routerLink="/login">Sign in</a></p>
      </form>
    </div>
  `,
})
export class RegisterComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  name = '';
  email = '';
  password = '';
  confirm = '';
  error = signal('');
  busy = signal(false);

  submit() {
    this.error.set('');
    if (this.password !== this.confirm) return void this.error.set('Passwords do not match');
    this.busy.set(true);
    this.auth.register(this.name, this.email, this.password).subscribe({
      next: () => {
        this.busy.set(false);
        this.router.navigateByUrl('/');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errMsg(e));
      },
    });
  }
}

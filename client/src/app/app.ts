import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (auth.session() && !auth.session()!.must_change_password) {
      <div class="layout">
        <nav class="sidebar">
          <div class="brand">HRMS</div>
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Dashboard</a>
          @if (auth.session()!.employee_id) {
            <a [routerLink]="['/employees', auth.session()!.employee_id]" routerLinkActive="active">My profile</a>
          }
          @if (auth.isHr() || auth.isManager()) {
            <a routerLink="/employees" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Employees</a>
          }
          @if (auth.isHr()) {
            <a routerLink="/employees/new" routerLinkActive="active">Add employee</a>
            <a routerLink="/employees/import" routerLinkActive="active">Bulk import</a>
          }
          <div class="group">Organization</div>
          <a routerLink="/org/chart" routerLinkActive="active">Org chart</a>
          @if (auth.isHr()) {
            <a routerLink="/org/departments" routerLinkActive="active">Departments</a>
            <a routerLink="/org/designations" routerLinkActive="active">Designations</a>
            <a routerLink="/org/locations" routerLinkActive="active">Locations</a>
            <a routerLink="/org/settings" routerLinkActive="active">Holidays &amp; settings</a>
            <div class="group">Admin</div>
            <a routerLink="/admin/users" routerLinkActive="active">Users &amp; roles</a>
            <a routerLink="/admin/audit" routerLinkActive="active">Audit log</a>
          }
        </nav>
        <div class="main">
          <div class="topbar">
            <span>{{ auth.session()!.name || auth.session()!.email }} <span class="badge">{{ roleLabel() }}</span></span>
            <button class="secondary" (click)="signOut()">Sign out</button>
          </div>
          <div class="content"><router-outlet /></div>
        </div>
      </div>
    } @else {
      <router-outlet />
    }
  `,
})
export class App {
  protected auth = inject(AuthService);
  private router = inject(Router);

  protected roleLabel = computed(() => (this.auth.session()?.role ?? '').replace('_', ' '));

  signOut() {
    this.auth.signOut().subscribe(() => this.router.navigateByUrl('/login'));
  }
}

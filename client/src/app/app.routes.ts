import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent) },
  { path: 'register', canActivate: [guestGuard], loadComponent: () => import('./pages/register.component').then((m) => m.RegisterComponent) },
  { path: 'forgot-password', loadComponent: () => import('./pages/password.component').then((m) => m.ForgotPasswordComponent) },
  { path: 'reset-password', loadComponent: () => import('./pages/password.component').then((m) => m.ResetPasswordComponent) },
  { path: 'change-password', loadComponent: () => import('./pages/password.component').then((m) => m.ChangePasswordComponent) },
  { path: 'access-denied', loadComponent: () => import('./pages/denied.component').then((m) => m.DeniedComponent) },

  { path: '', pathMatch: 'full', canActivate: [authGuard], loadComponent: () => import('./pages/dashboard.component').then((m) => m.DashboardComponent) },
  { path: 'employees', canActivate: [roleGuard('super_admin', 'hr_admin', 'manager')], loadComponent: () => import('./pages/employee-list.component').then((m) => m.EmployeeListComponent) },
  { path: 'employees/new', canActivate: [roleGuard('super_admin', 'hr_admin')], loadComponent: () => import('./pages/employee-new.component').then((m) => m.EmployeeNewComponent) },
  { path: 'employees/import', canActivate: [roleGuard('super_admin', 'hr_admin')], loadComponent: () => import('./pages/employee-import.component').then((m) => m.EmployeeImportComponent) },
  { path: 'employees/:id', canActivate: [authGuard], loadComponent: () => import('./pages/employee-detail.component').then((m) => m.EmployeeDetailComponent) },
  { path: 'org/chart', canActivate: [authGuard], loadComponent: () => import('./pages/org-chart.component').then((m) => m.OrgChartComponent) },
  { path: 'org/:kind', canActivate: [roleGuard('super_admin', 'hr_admin')], loadComponent: () => import('./pages/org-manage.component').then((m) => m.OrgManageComponent) },
  { path: 'admin/users', canActivate: [roleGuard('super_admin', 'hr_admin')], loadComponent: () => import('./pages/users.component').then((m) => m.UsersComponent) },
  { path: 'admin/audit', canActivate: [roleGuard('super_admin', 'hr_admin')], loadComponent: () => import('./pages/audit.component').then((m) => m.AuditComponent) },
  { path: '**', redirectTo: '' },
];

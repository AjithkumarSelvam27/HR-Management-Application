import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg } from '../services/api.service';
import { AuthService } from '../services/auth.service';

@Component({
  imports: [FormsModule],
  template: `
    <h1>Users &amp; roles</h1>
    @if (error()) { <div class="error">{{ error() }}</div> }
    @if (msg()) { <div class="success">{{ msg() }}</div> }
    <div class="card" style="max-width:360px"><label for="q">Search</label><input id="q" [(ngModel)]="q" (keyup.enter)="load()" placeholder="Name or email" /></div>
    <table>
      <thead><tr><th>User</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>
        @for (u of users(); track u.id) {
          <tr>
            <td>{{ u.name }}<div class="muted">{{ u.email }}</div></td>
            <td>
              <select [ngModel]="u.role" (ngModelChange)="setRole(u, $event)" [disabled]="!canManage(u)">
                <option value="employee">Employee</option><option value="manager">Manager</option>
                <option value="hr_admin" [disabled]="!auth.isSuper()">HR Admin</option><option value="super_admin" [disabled]="!auth.isSuper()">Super Admin</option>
              </select>
            </td>
            <td>
              <span class="badge" [class]="'badge ' + (u.active ? 'active' : 'terminated')">{{ u.active ? 'active' : 'deactivated' }}</span>
              @if (u.locked_until) { <span class="badge offboarding">locked</span> }
              @if (u.must_change_password) { <span class="badge onboarding">invite pending</span> }
            </td>
            <td>
              @if (canManage(u)) {
                <button class="link" (click)="toggle(u)">{{ u.active ? 'Deactivate' : 'Reactivate' }}</button>
                <button class="link" style="margin-left:10px" (click)="unlock(u)">Unlock</button>
                <button class="link" style="margin-left:10px" (click)="resend(u)">Resend invite</button>
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class UsersComponent {
  protected auth = inject(AuthService);
  private api = inject(ApiService);
  users = signal<any[]>([]);
  error = signal('');
  msg = signal('');
  q = '';

  constructor() { this.load(); }

  canManage(u: any) { return this.auth.isSuper() || !['super_admin', 'hr_admin'].includes(u.role); }

  load() { this.api.get('/users', { q: this.q }).subscribe({ next: (u) => this.users.set(u), error: (e) => this.error.set(errMsg(e)) }); }

  private act(req: any, ok: string) {
    req.subscribe({ next: () => { this.error.set(''); this.msg.set(ok); this.load(); }, error: (e: any) => { this.msg.set(''); this.error.set(errMsg(e)); this.load(); } });
  }

  setRole(u: any, role: string) { this.act(this.api.patch(`/users/${u.id}`, { role }), 'Role updated.'); }
  toggle(u: any) {
    if (u.active && !confirm(`Deactivate ${u.email}? They will be signed out.`)) return;
    this.act(this.api.patch(`/users/${u.id}`, { active: !u.active }), 'User updated.');
  }
  unlock(u: any) { this.act(this.api.post(`/users/${u.id}/unlock`), 'User unlocked.'); }
  resend(u: any) { this.act(this.api.post(`/users/${u.id}/resend-invite`), 'New temporary password sent (see server console in dev).'); }
}

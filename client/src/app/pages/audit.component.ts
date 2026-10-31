import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg } from '../services/api.service';

@Component({
  imports: [FormsModule],
  template: `
    <h1>Audit log</h1>
    @if (error()) { <div class="error">{{ error() }}</div> }
    <div class="card"><div class="row">
      <div><label for="u">User email</label><input id="u" [(ngModel)]="f.user_email" /></div>
      <div><label for="a">Action</label><select id="a" [(ngModel)]="f.action"><option value="">All</option>@for (a of actions(); track a) { <option [value]="a">{{ a }}</option> }</select></div>
      <div><label for="df">From</label><input id="df" type="date" [(ngModel)]="f.date_from" /></div>
      <div><label for="dt">To</label><input id="dt" type="date" [(ngModel)]="f.date_to" /></div>
      <div class="row tight"><button (click)="reload()">Filter</button></div>
    </div></div>
    <table>
      <thead><tr><th>When (UTC)</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
      <tbody>
        @for (r of items(); track r.id) {
          <tr><td>{{ r.created_at }}</td><td>{{ r.user_email || 'system' }}</td><td>{{ r.action }}</td><td>{{ r.entity }} {{ r.entity_id }}</td><td class="muted">{{ r.detail }}</td></tr>
        } @empty { <tr><td colspan="5" class="muted">No events.</td></tr> }
      </tbody>
    </table>
    <div class="pager">
      <span class="muted">{{ total() }} event(s)</span>
      <button class="secondary" [disabled]="page() <= 1" (click)="go(-1)">Previous</button>
      <span>Page {{ page() }}</span>
      <button class="secondary" [disabled]="page() * 50 >= total()" (click)="go(1)">Next</button>
    </div>
  `,
})
export class AuditComponent {
  private api = inject(ApiService);
  f: Record<string, string> = { user_email: '', action: '', date_from: '', date_to: '' };
  items = signal<any[]>([]);
  actions = signal<string[]>([]);
  total = signal(0);
  page = signal(1);
  error = signal('');

  constructor() { this.load(); }

  reload() { this.page.set(1); this.load(); }
  go(d: number) { this.page.update((p) => p + d); this.load(); }

  load() {
    this.api.get('/audit-log', { ...this.f, page: this.page() }).subscribe({
      next: (r) => { this.items.set(r.items); this.total.set(r.total); this.actions.set(r.actions); },
      error: (e) => this.error.set(errMsg(e)),
    });
  }
}

import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, errMsg, saveBlob } from '../services/api.service';
import { AuthService } from '../services/auth.service';

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
      <h1 style="margin:0">Employees</h1>
      @if (auth.isHr()) {
        <div class="row tight">
          <button class="secondary" (click)="export()">Export CSV</button>
          <a class="btn secondary" routerLink="/employees/import">Bulk import</a>
          <a class="btn" routerLink="/employees/new">Add employee</a>
        </div>
      }
    </div>
    @if (error()) { <div class="error">{{ error() }}</div> }
    <div class="card">
      <div class="row">
        <div><label for="q">Search</label><input id="q" [(ngModel)]="f.q" (keyup.enter)="reload()" placeholder="Name, ID or email" /></div>
        <div><label for="dep">Department</label>
          <select id="dep" [(ngModel)]="f.department_id" (change)="reload()"><option value="">All</option>
            @for (d of departments(); track d.id) { <option [value]="d.id">{{ d.name }}</option> }</select></div>
        <div><label for="loc">Location</label>
          <select id="loc" [(ngModel)]="f.location_id" (change)="reload()"><option value="">All</option>
            @for (l of locations(); track l.id) { <option [value]="l.id">{{ l.name }}</option> }</select></div>
        <div><label for="st">Status</label>
          <select id="st" [(ngModel)]="f.status" (change)="reload()"><option value="">All</option>
            @for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }</select></div>
        <div><label for="ty">Type</label>
          <select id="ty" [(ngModel)]="f.employment_type" (change)="reload()"><option value="">All</option>
            @for (t of types; track t) { <option [value]="t">{{ t }}</option> }</select></div>
        <div><label for="so">Sort</label>
          <select id="so" [(ngModel)]="f.sort" (change)="reload()"><option value="name">Name</option><option value="join_date">Newest joiners</option><option value="code">Employee ID</option></select></div>
        <div class="row tight"><button (click)="reload()">Search</button></div>
      </div>
    </div>
    <table>
      <thead><tr><th>ID</th><th>Name</th><th>Department</th><th>Title</th><th>Manager</th><th>Status</th></tr></thead>
      <tbody>
        @for (e of items(); track e.id) {
          <tr class="click" [routerLink]="['/employees', e.id]">
            <td>{{ e.emp_code }}</td><td>{{ e.first_name }} {{ e.last_name }}<div class="muted">{{ e.email }}</div></td>
            <td>{{ e.department || '—' }}</td><td>{{ e.designation || '—' }}</td><td>{{ e.manager_name || '—' }}</td>
            <td><span class="badge" [class]="'badge ' + e.status">{{ e.status }}</span></td>
          </tr>
        } @empty { <tr><td colspan="6" class="muted">{{ loading() ? 'Loading…' : 'No employees match.' }}</td></tr> }
      </tbody>
    </table>
    <div class="pager">
      <span class="muted">{{ total() }} employee(s)</span>
      <button class="secondary" [disabled]="page() <= 1" (click)="go(-1)">Previous</button>
      <span>Page {{ page() }} / {{ pages() }}</span>
      <button class="secondary" [disabled]="page() >= pages()" (click)="go(1)">Next</button>
    </div>
  `,
})
export class EmployeeListComponent {
  protected auth = inject(AuthService);
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  statuses = ['onboarding', 'active', 'probation', 'offboarding', 'terminated'];
  types = ['full_time', 'part_time', 'contract', 'intern'];
  f: Record<string, any> = { q: '', department_id: '', location_id: '', status: '', employment_type: '', sort: 'name' };
  items = signal<any[]>([]);
  total = signal(0);
  page = signal(1);
  pages = signal(1);
  loading = signal(true);
  error = signal('');
  departments = signal<any[]>([]);
  locations = signal<any[]>([]);

  constructor() {
    const qp = this.route.snapshot.queryParamMap;
    for (const k of Object.keys(this.f)) if (qp.get(k)) this.f[k] = qp.get(k);
    this.api.get('/departments').subscribe((d) => this.departments.set(d));
    this.api.get('/locations').subscribe((l) => this.locations.set(l));
    this.load();
  }

  reload() {
    this.page.set(1);
    this.load();
  }

  go(delta: number) {
    this.page.update((p) => p + delta);
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.get('/employees', { ...this.f, page: this.page(), page_size: 20 }).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.total.set(r.total);
        this.pages.set(Math.max(1, Math.ceil(r.total / r.page_size)));
        this.loading.set(false);
        this.error.set('');
      },
      error: (e) => {
        this.loading.set(false);
        if (e.status === 403) this.router.navigateByUrl('/access-denied');
        else this.error.set(errMsg(e));
      },
    });
  }

  export() {
    this.api.blob('/employees/export').subscribe({
      next: (b) => saveBlob(b, 'employees.csv'),
      error: (e) => this.error.set(errMsg(e)),
    });
  }
}

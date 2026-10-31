import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService, errMsg } from '../services/api.service';

interface Kind {
  title: string;
  path: string;
  cols: { key: string; label: string }[];
  fields: { key: string; label: string; type?: string; ref?: string }[];
  blank: any;
}

const KINDS: Record<string, Kind> = {
  departments: {
    title: 'Departments', path: '/departments',
    cols: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'parent_name', label: 'Parent' }, { key: 'head_name', label: 'Head' }, { key: 'employee_count', label: 'Employees' }],
    fields: [{ key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'parent_id', label: 'Parent department', ref: 'departments' }, { key: 'head_employee_id', label: 'Department head', ref: 'employees' }],
    blank: { name: '', code: '', parent_id: null, head_employee_id: null, active: true },
  },
  designations: {
    title: 'Designations', path: '/designations',
    cols: [{ key: 'title', label: 'Title' }, { key: 'grade', label: 'Grade' }],
    fields: [{ key: 'title', label: 'Title' }, { key: 'grade', label: 'Grade / level' }, { key: 'department_id', label: 'Department (optional)', ref: 'departments' }],
    blank: { title: '', grade: '', department_id: null, active: true },
  },
  locations: {
    title: 'Locations', path: '/locations',
    cols: [{ key: 'name', label: 'Name' }, { key: 'country', label: 'Country' }, { key: 'timezone', label: 'Timezone' }],
    fields: [{ key: 'name', label: 'Name' }, { key: 'address', label: 'Address' }, { key: 'country', label: 'Country' }, { key: 'timezone', label: 'Timezone (e.g. UTC)' }],
    blank: { name: '', address: '', country: '', timezone: '', active: true },
  },
};

@Component({
  imports: [FormsModule],
  template: `
    @if (kind() === 'settings') {
      <h1>Holidays &amp; company settings</h1>
      @if (error()) { <div class="error">{{ error() }}</div> }
      @if (msg()) { <div class="success">{{ msg() }}</div> }
      <div class="grid cols-2">
        <div class="card"><h2>Company settings</h2>
          <div class="field"><label for="pm">Probation length (months)</label><input id="pm" type="number" min="0" [(ngModel)]="settings().probation_months" /></div>
          <div class="field"><label for="ww">Work week</label><input id="ww" [(ngModel)]="settings().work_week" /></div>
          <button (click)="saveSettings()">Save settings</button></div>
        <div class="card"><h2>Public holidays</h2>
          <div class="row" style="margin-bottom:10px"><div><label for="hn">Name</label><input id="hn" [(ngModel)]="hol.name" /></div>
            <div><label for="hd">Date</label><input id="hd" type="date" [(ngModel)]="hol.holiday_date" /></div>
            <div class="row tight"><button (click)="addHoliday()">Add</button></div></div>
          <table><tbody>
            @for (h of holidays(); track h.id) { <tr><td>{{ h.holiday_date }}</td><td>{{ h.name }}</td><td><button class="link" style="color:var(--danger)" (click)="delHoliday(h)">Remove</button></td></tr> }
            @empty { <tr><td class="muted">No holidays yet.</td></tr> }
          </tbody></table></div>
      </div>
    } @else if (cfg(); as cfg) {
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
        <h1 style="margin:0">{{ cfg.title }}</h1><button (click)="startNew()">+ New</button></div>
      @if (error()) { <div class="error">{{ error() }}</div> }
      @if (msg()) { <div class="success">{{ msg() }}</div> }
      @if (form(); as f) {
        <form class="card" (ngSubmit)="save()">
          <h2>{{ editingId() ? 'Edit' : 'New' }} {{ cfg.title.toLowerCase().slice(0, -1) }}</h2>
          <div class="row">
            @for (fld of cfg.fields; track fld.key) {
              <div class="field"><label [for]="fld.key">{{ fld.label }}</label>
                @if (fld.ref) {
                  <select [id]="fld.key" [name]="fld.key" [(ngModel)]="f[fld.key]"><option [ngValue]="null">—</option>
                    @for (o of refs()[fld.ref] ?? []; track o.id) { @if (o.id !== editingId() || fld.ref !== 'departments') { <option [ngValue]="o.id">{{ o.name }}</option> } }</select>
                } @else { <input [id]="fld.key" [name]="fld.key" [(ngModel)]="f[fld.key]" /> }
              </div>
            }
            <div class="field"><label for="act">Status</label>
              <select id="act" name="active" [(ngModel)]="f.active"><option [ngValue]="true">Active</option><option [ngValue]="false">Inactive</option></select></div>
          </div>
          <button type="submit">Save</button> <button type="button" class="secondary" (click)="form.set(null)">Cancel</button>
        </form>
      }
      <table>
        <thead><tr>@for (c of cfg.cols; track c.key) { <th>{{ c.label }}</th> }<th>Status</th><th></th></tr></thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr>@for (c of cfg.cols; track c.key) { <td>{{ r[c.key] ?? '—' }}</td> }
              <td><span class="badge" [class]="'badge ' + (r.active ? 'active' : 'terminated')">{{ r.active ? 'active' : 'inactive' }}</span></td>
              <td><button class="link" (click)="edit(r)">Edit</button>
                @if (kind() === 'departments') { <button class="link" style="margin-left:10px" (click)="reassign(r)">Reassign employees</button> }</td></tr>
          } @empty { <tr><td [attr.colspan]="cfg.cols.length + 2" class="muted">Nothing here yet.</td></tr> }
        </tbody>
      </table>
    }
  `,
})
export class OrgManageComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  kind = signal('');
  cfg = signal<Kind | null>(null);
  rows = signal<any[]>([]);
  refs = signal<Record<string, any[]>>({});
  form = signal<any>(null);
  editingId = signal<number | null>(null);
  error = signal('');
  msg = signal('');
  settings = signal<any>({});
  holidays = signal<any[]>([]);
  hol = { name: '', holiday_date: '' };

  constructor() {
    this.route.paramMap.subscribe((p) => {
      const k = p.get('kind') || '';
      this.kind.set(k);
      this.form.set(null);
      this.error.set('');
      this.msg.set('');
      if (k === 'settings') {
        this.api.get('/settings').subscribe((s) => this.settings.set(s));
        this.loadHolidays();
      } else if (KINDS[k]) {
        this.cfg.set(KINDS[k]);
        this.load();
        this.api.get('/departments').subscribe((d) => this.refs.update((r) => ({ ...r, departments: d.map((x: any) => ({ id: x.id, name: x.name })) })));
        this.api.get('/employees/options').subscribe((d) => this.refs.update((r) => ({ ...r, employees: d })));
      }
    });
  }

  load() {
    const cfg = this.cfg();
    if (cfg) this.api.get(cfg.path).subscribe({ next: (r) => this.rows.set(r), error: (e) => this.error.set(errMsg(e)) });
  }

  startNew() {
    this.editingId.set(null);
    this.form.set({ ...this.cfg()!.blank });
  }

  edit(r: any) {
    this.editingId.set(r.id);
    const f: any = {};
    for (const k of Object.keys(this.cfg()!.blank)) f[k] = k === 'active' ? !!r[k] : r[k] ?? (this.cfg()!.blank[k] === null ? null : '');
    this.form.set(f);
  }

  save() {
    const cfg = this.cfg()!;
    const body: any = {};
    for (const [k, v] of Object.entries(this.form())) body[k] = v === '' ? null : v;
    const id = this.editingId();
    const req = id ? this.api.put(`${cfg.path}/${id}`, body) : this.api.post(cfg.path, body);
    req.subscribe({
      next: () => { this.form.set(null); this.error.set(''); this.msg.set('Saved.'); this.load(); },
      error: (e) => this.error.set(errMsg(e)),
    });
  }

  reassign(r: any) {
    const others = this.rows().filter((d) => d.id !== r.id && d.active);
    const name = prompt(`Move all ${r.employee_count} active employee(s) of "${r.name}" to which department? Type the exact name:\n` + others.map((o) => o.name).join(', '));
    const target = others.find((o) => o.name.toLowerCase() === (name || '').trim().toLowerCase());
    if (!name) return;
    if (!target) return void this.error.set('No active department with that name.');
    this.api.post(`/departments/${r.id}/reassign`, { target_department_id: target.id }).subscribe({
      next: (res) => { this.error.set(''); this.msg.set(`Moved ${res.moved} employee(s).`); this.load(); },
      error: (e) => this.error.set(errMsg(e)),
    });
  }

  saveSettings() {
    this.api.put('/settings', Object.fromEntries(Object.entries(this.settings()).map(([k, v]) => [k, String(v)]))).subscribe({
      next: () => { this.error.set(''); this.msg.set('Settings saved.'); }, error: (e) => this.error.set(errMsg(e)) });
  }

  loadHolidays() { this.api.get('/holidays').subscribe((h) => this.holidays.set(h)); }

  addHoliday() {
    this.api.post('/holidays', this.hol).subscribe({
      next: () => { this.hol = { name: '', holiday_date: '' }; this.error.set(''); this.loadHolidays(); }, error: (e) => this.error.set(errMsg(e)) });
  }

  delHoliday(h: any) { this.api.delete(`/holidays/${h.id}`).subscribe(() => this.loadHolidays()); }
}

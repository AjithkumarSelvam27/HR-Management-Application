import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, errMsg, saveBlob } from '../services/api.service';
import { AuthService } from '../services/auth.service';

const PERSONAL = ['first_name', 'last_name', 'email', 'dob', 'gender', 'phone', 'address', 'emergency_contact_name', 'emergency_contact_phone', 'national_id'];
const SELF = ['phone', 'address', 'emergency_contact_name', 'emergency_contact_phone'];

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    @if (e(); as e) {
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
        <div>
          <h1 style="margin:0">{{ e.first_name }} {{ e.last_name }} <span class="badge" [class]="'badge ' + e.status">{{ e.status }}</span></h1>
          <div class="muted">{{ e.emp_code }} · {{ e.designation || 'No title' }} · {{ e.department || 'No department' }}</div>
        </div>
        @if (auth.isHr() || auth.isManager()) { <a class="btn secondary" routerLink="/employees">← Employees</a> }
      </div>
      @if (e.status === 'terminated') { <div class="error">This record is read-only: the employee has left the company.</div> }
      @if (msg()) { <div class="success">{{ msg() }}</div> }
      @if (error()) { <div class="error">{{ error() }}</div> }

      <div class="tabs">
        @for (t of tabs(); track t) { <button [class.on]="tab() === t" (click)="openTab(t)">{{ t }}</button> }
      </div>

      @if (tab() === 'Overview') {
        <div class="card"><dl class="dl">
          <dt>Employee ID</dt><dd>{{ e.emp_code }}</dd>
          <dt>Work email</dt><dd>{{ e.email }}</dd>
          <dt>Phone</dt><dd>{{ e.phone || '—' }}</dd>
          <dt>Department</dt><dd>{{ e.department || '—' }}</dd>
          <dt>Designation</dt><dd>{{ e.designation || '—' }}</dd>
          <dt>Location</dt><dd>{{ e.location || '—' }}</dd>
          <dt>Manager</dt><dd>
            @if (e.manager_id && auth.session()) { <a [routerLink]="['/employees', e.manager_id]">{{ e.manager_name }}</a> } @else { — }</dd>
          <dt>Employment type</dt><dd>{{ e.employment_type }}</dd>
          <dt>Joined</dt><dd>{{ e.join_date }}</dd>
        </dl></div>
      }

      @if (tab() === 'Job') {
        <div class="card"><dl class="dl">
          <dt>Department</dt><dd>{{ e.department || '—' }}</dd>
          <dt>Designation</dt><dd>{{ e.designation || '—' }}</dd>
          <dt>Location</dt><dd>{{ e.location || '—' }}</dd>
          <dt>Manager</dt><dd>{{ e.manager_name || '—' }}</dd>
          <dt>Employment type</dt><dd>{{ e.employment_type }}</dd>
          <dt>Join date</dt><dd>{{ e.join_date }}</dd>
          <dt>Probation ends</dt><dd>{{ e.probation_end_date || '—' }}</dd>
          @if (e.salary !== undefined) { <dt>Salary</dt><dd>{{ e.salary ?? '—' }}</dd> }
          @if (e.last_working_day) { <dt>Last working day</dt><dd>{{ e.last_working_day }}</dd><dt>Exit reason</dt><dd>{{ e.exit_reason }}</dd> }
        </dl></div>

        @if (auth.isHr() && e.status !== 'terminated') {
          <div class="card"><h2>Change job details</h2>
            <div class="row">
              <div><label for="ct">Change type</label>
                <select id="ct" [(ngModel)]="jc().change_type">
                  <option value="promotion">Promotion</option><option value="transfer">Transfer</option>
                  <option value="manager_change">Manager change</option><option value="salary_change">Salary change</option><option value="other">Other</option></select></div>
              <div><label for="ed">Effective date</label><input id="ed" type="date" [(ngModel)]="jc().effective_date" /></div>
            </div>
            <div class="row">
              <div><label for="jd">Department</label><select id="jd" [(ngModel)]="jc().department_id"><option [ngValue]="null">(no change)</option>
                @for (d of departments(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }</select></div>
              <div><label for="jg">Designation</label><select id="jg" [(ngModel)]="jc().designation_id"><option [ngValue]="null">(no change)</option>
                @for (d of designations(); track d.id) { <option [ngValue]="d.id">{{ d.title }}</option> }</select></div>
              <div><label for="jl">Location</label><select id="jl" [(ngModel)]="jc().location_id"><option [ngValue]="null">(no change)</option>
                @for (d of locations(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }</select></div>
            </div>
            <div class="row">
              <div><label for="jm">Manager</label><select id="jm" [(ngModel)]="jc().manager_id"><option [ngValue]="null">(no change)</option>
                @for (m of managers(); track m.id) { @if (m.id !== e.id) { <option [ngValue]="m.id">{{ m.name }}</option> } }</select></div>
              <div><label for="jt">Employment type</label><select id="jt" [(ngModel)]="jc().employment_type"><option [ngValue]="null">(no change)</option>
                <option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="intern">Intern</option></select></div>
              <div><label for="js">Salary</label><input id="js" type="number" min="0" [(ngModel)]="jc().salary" placeholder="(no change)" /></div>
            </div>
            <button (click)="submitJobChange(false)">Record change</button>
            @if (needsConfirm()) {
              <span style="margin-left:10px" class="muted">That date is in the past. </span>
              <button class="secondary" (click)="submitJobChange(true)">Confirm backdated change</button>
            }
          </div>

          <div class="card"><h2>Offboarding</h2>
            @if (e.status === 'offboarding') {
              <p>Last working day <strong>{{ e.last_working_day }}</strong> — {{ e.exit_reason }}. Access is disabled automatically on that day.</p>
              @for (c of e.exit_checklist; track c.key) {
                <div><label style="display:flex;gap:8px;align-items:center;color:var(--text)">
                  <input type="checkbox" style="width:auto" [checked]="c.done" (change)="toggleChecklist(c.key, $any($event.target).checked)" /> {{ c.label }}</label></div>
              }
              <button class="secondary" style="margin-top:8px" (click)="completeOffboarding()">Finish offboarding now (only on/after last day)</button>
            } @else {
              <div class="row">
                <div><label for="lw">Last working day</label><input id="lw" type="date" [(ngModel)]="off().last_working_day" /></div>
                <div><label for="xt">Exit type</label><select id="xt" [(ngModel)]="off().exit_type"><option value="resignation">Resignation</option><option value="termination">Termination</option><option value="retirement">Retirement</option><option value="contract_end">Contract end</option></select></div>
                <div><label for="xr">Reason</label><input id="xr" [(ngModel)]="off().reason" /></div>
              </div>
              <button class="danger" (click)="startOffboarding()">Start offboarding</button>
            }
          </div>
        }
      }

      @if (tab() === 'Personal') {
        <form class="card" (ngSubmit)="savePersonal()">
          <div class="row">
            @for (f of fields(); track f.key) {
              <div class="field"><label [for]="f.key">{{ f.label }}</label>
                <input [id]="f.key" [name]="f.key" [type]="f.type" [(ngModel)]="pf()[f.key]" [disabled]="!f.editable" /></div>
            }
          </div>
          @if (canEdit()) { <button type="submit">Save changes</button> }
          @else { <span class="muted">You can't edit this record.</span> }
          @if (!auth.isHr() && isSelf()) { <p class="muted">You can edit your contact details and emergency contact. Contact HR to change other details.</p> }
        </form>
      }

      @if (tab() === 'Documents') {
        <div class="card">
          @if (canEdit()) {
            <div class="row" style="margin-bottom:12px">
              <div><label for="dc">Category</label><select id="dc" [(ngModel)]="doc.category"><option value="contract">Contract</option><option value="id">ID</option><option value="certificate">Certificate</option><option value="other">Other</option></select></div>
              <div><label for="dx">Expiry date (optional)</label><input id="dx" type="date" [(ngModel)]="doc.expiry" /></div>
              <div><label for="df">File (PDF/JPG/PNG, max 5 MB)</label><input id="df" type="file" accept=".pdf,.jpg,.jpeg,.png" (change)="pickDoc($event)" /></div>
              <div class="row tight"><button (click)="upload()" [disabled]="!doc.file">Upload</button></div>
            </div>
          }
          <table><thead><tr><th>File</th><th>Category</th><th>Expires</th><th>Uploaded</th><th></th></tr></thead><tbody>
            @for (d of docs(); track d.id) {
              <tr><td><button class="link" (click)="download(d)">{{ d.filename }}</button></td><td>{{ d.category }}</td><td>{{ d.expiry_date || '—' }}</td>
                <td>{{ d.created_at }}</td><td>@if (auth.isHr()) { <button class="link" style="color:var(--danger)" (click)="removeDoc(d)">Delete</button> }</td></tr>
            } @empty { <tr><td colspan="5" class="muted">No documents.</td></tr> }
          </tbody></table>
        </div>
      }

      @if (tab() === 'History') {
        <div class="card">
          @if (pending().length) {
            <h2>Scheduled changes</h2>
            @for (p of pending(); track p.id) { <div>{{ p.effective_date }} — {{ p.change_type }}: {{ keys(p.changes) }}</div> }
            <hr />
          }
          <table><thead><tr><th>When</th><th>Change</th><th>Field</th><th>From → To</th><th>By</th></tr></thead><tbody>
            @for (h of history(); track h.id) {
              <tr><td>{{ h.created_at }}</td><td>{{ h.change_type }}@if (h.effective_date) { <div class="muted">eff. {{ h.effective_date }}</div> }</td>
                <td>{{ h.field }}</td><td>{{ h.old_value ?? '—' }} → {{ h.new_value ?? '—' }}</td><td>{{ h.changed_by_name || 'system' }}</td></tr>
            } @empty { <tr><td colspan="5" class="muted">No history yet.</td></tr> }
          </tbody></table>
        </div>
      }
    } @else if (error()) {
      <div class="error">{{ error() }}</div>
    }
  `,
})
export class EmployeeDetailComponent {
  protected auth = inject(AuthService);
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  id = 0;
  e = signal<any>(null);
  tab = signal('Overview');
  msg = signal('');
  error = signal('');
  history = signal<any[]>([]);
  pending = signal<any[]>([]);
  docs = signal<any[]>([]);
  departments = signal<any[]>([]);
  designations = signal<any[]>([]);
  locations = signal<any[]>([]);
  managers = signal<any[]>([]);
  pf = signal<Record<string, any>>({});
  jc = signal<any>(this.blankJc());
  off = signal<any>({ last_working_day: '', exit_type: 'resignation', reason: '' });
  needsConfirm = signal(false);
  doc: { category: string; expiry: string; file: File | null } = { category: 'other', expiry: '', file: null };

  isSelf = computed(() => this.auth.session()?.employee_id === this.id);
  canEdit = computed(() => this.e()?.status !== 'terminated' && (this.auth.isHr() || this.isSelf()));
  tabs = computed(() => {
    const t = ['Overview', 'Job', 'Personal'];
    if (this.auth.isHr() || this.isSelf()) t.push('Documents');
    t.push('History');
    return t;
  });
  fields = computed(() => {
    const labels: Record<string, string> = {
      first_name: 'First name', last_name: 'Last name', email: 'Work email', dob: 'Date of birth', gender: 'Gender', phone: 'Phone',
      address: 'Address', emergency_contact_name: 'Emergency contact name', emergency_contact_phone: 'Emergency contact phone', national_id: 'National ID',
    };
    const e = this.e();
    return PERSONAL.filter((k) => k !== 'national_id' || (e && e.national_id !== undefined)).map((key) => ({
      key, label: labels[key], type: key === 'dob' ? 'date' : 'text',
      editable: this.canEdit() && (this.auth.isHr() || SELF.includes(key)),
    }));
  });

  constructor() {
    this.route.paramMap.subscribe((p) => {
      this.id = Number(p.get('id'));
      this.tab.set('Overview');
      this.load();
    });
    if (this.auth.isHr()) {
      this.api.get('/departments').subscribe((d) => this.departments.set(d.filter((x: any) => x.active)));
      this.api.get('/designations').subscribe((d) => this.designations.set(d.filter((x: any) => x.active)));
      this.api.get('/locations').subscribe((d) => this.locations.set(d.filter((x: any) => x.active)));
      this.api.get('/employees/options').subscribe((d) => this.managers.set(d));
    }
  }

  blankJc() {
    return { change_type: 'promotion', effective_date: new Date().toISOString().slice(0, 10), department_id: null, designation_id: null,
      location_id: null, manager_id: null, employment_type: null, salary: null };
  }

  keys(o: any) { return Object.keys(o).join(', '); }

  load() {
    this.error.set('');
    this.api.get(`/employees/${this.id}`).subscribe({
      next: (e) => {
        this.e.set(e);
        const pf: Record<string, any> = {};
        for (const k of PERSONAL) pf[k] = e[k] ?? '';
        this.pf.set(pf);
      },
      error: (err) => {
        if (err.status === 403) this.router.navigateByUrl('/access-denied');
        else this.error.set(errMsg(err));
      },
    });
  }

  openTab(t: string) {
    this.tab.set(t);
    this.msg.set('');
    this.error.set('');
    if (t === 'History') this.api.get(`/employees/${this.id}/history`).subscribe((r) => { this.history.set(r.history); this.pending.set(r.pending); });
    if (t === 'Documents') this.loadDocs();
  }

  private ok(m: string) { this.msg.set(m); this.error.set(''); }
  private fail(e: any) { this.error.set(errMsg(e)); this.msg.set(''); }

  savePersonal() {
    const body: any = {};
    for (const f of this.fields()) if (f.editable) body[f.key] = this.pf()[f.key] === '' ? null : this.pf()[f.key];
    // first/last name and email cannot be blanked
    this.api.patch(`/employees/${this.id}`, body).subscribe({ next: (e) => { this.e.set(e); this.ok('Saved.'); }, error: (x) => this.fail(x) });
  }

  submitJobChange(confirm: boolean) {
    const body = { ...this.jc(), confirm_backdated: confirm };
    this.api.post(`/employees/${this.id}/job-change`, body).subscribe({
      next: (r) => {
        this.needsConfirm.set(false);
        this.jc.set(this.blankJc());
        this.ok(r.applied ? 'Change applied.' : `Change scheduled for ${r.effective_date}.`);
        this.load();
      },
      error: (x) => { this.needsConfirm.set(x.status === 409 && String(x.error?.error).includes('past')); this.fail(x); },
    });
  }

  startOffboarding() {
    const o = this.off();
    if (!o.last_working_day || !o.reason) return this.fail({ error: { error: 'Last working day and reason are required' } });
    if (!confirm('Start offboarding? Access will be disabled on the last working day.')) return;
    this.api.post(`/employees/${this.id}/offboarding`, o).subscribe({ next: (e) => { this.e.set(e); this.ok('Offboarding started.'); }, error: (x) => this.fail(x) });
  }

  toggleChecklist(key: string, done: boolean) {
    this.api.post(`/employees/${this.id}/offboarding/checklist`, { key, done }).subscribe({
      next: (r) => this.e.update((e) => ({ ...e, exit_checklist: r.exit_checklist })), error: (x) => this.fail(x) });
  }

  completeOffboarding() {
    this.api.post(`/employees/${this.id}/offboarding/complete`).subscribe({ next: (e) => { this.e.set(e); this.ok('Offboarding complete. Login disabled.'); }, error: (x) => this.fail(x) });
  }

  loadDocs() {
    this.api.get(`/employees/${this.id}/documents`).subscribe({ next: (d) => this.docs.set(d), error: (x) => this.fail(x) });
  }

  pickDoc(ev: Event) { this.doc.file = (ev.target as HTMLInputElement).files?.[0] ?? null; }

  upload() {
    if (!this.doc.file) return;
    const fd = new FormData();
    fd.append('file', this.doc.file);
    fd.append('category', this.doc.category);
    if (this.doc.expiry) fd.append('expiry_date', this.doc.expiry);
    this.api.post(`/employees/${this.id}/documents`, fd).subscribe({
      next: () => { this.doc = { category: 'other', expiry: '', file: null }; this.ok('Document uploaded.'); this.loadDocs(); }, error: (x) => this.fail(x) });
  }

  download(d: any) {
    this.api.blob(`/employees/documents/${d.id}/download`).subscribe({ next: (b) => saveBlob(b, d.filename), error: (x) => this.fail(x) });
  }

  removeDoc(d: any) {
    if (!confirm(`Delete ${d.filename}?`)) return;
    this.api.delete(`/employees/documents/${d.id}`).subscribe({ next: () => this.loadDocs(), error: (x) => this.fail(x) });
  }
}

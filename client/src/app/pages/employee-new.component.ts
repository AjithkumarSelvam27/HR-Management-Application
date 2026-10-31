import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errMsg } from '../services/api.service';
import { AuthService } from '../services/auth.service';

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <h1>Add employee</h1>
    @if (created(); as c) {
      <div class="success">
        <strong>{{ c.emp_code }}</strong> created ({{ c.status }}). A welcome email was sent (printed to the server console in dev).
        @if (c.temp_password) { <div style="margin-top:6px">Temporary password: <code>{{ c.temp_password }}</code> — shown once; they must change it on first login.</div> }
      </div>
      <a class="btn" [routerLink]="['/employees', c.id]">Open profile</a>
      <button class="secondary" style="margin-left:8px" (click)="reset()">Add another</button>
    } @else {
      <div class="tabs">
        @for (s of steps; track s; let i = $index) { <button type="button" [class.on]="step() === i" (click)="step.set(i)">{{ i + 1 }}. {{ s }}</button> }
      </div>
      @if (error()) { <div class="error">{{ error() }}</div> }
      <form class="card" (ngSubmit)="submit()">
        @if (step() === 0) {
          <div class="row">
            <div class="field"><label for="fn">First name *</label><input id="fn" name="fn" [(ngModel)]="m().first_name" /></div>
            <div class="field"><label for="ln">Last name *</label><input id="ln" name="ln" [(ngModel)]="m().last_name" /></div>
          </div>
          <div class="row">
            <div class="field"><label for="dob">Date of birth</label><input id="dob" name="dob" type="date" [(ngModel)]="m().dob" /></div>
            <div class="field"><label for="g">Gender</label>
              <select id="g" name="g" [(ngModel)]="m().gender"><option value="">—</option><option>Female</option><option>Male</option><option>Non-binary</option><option>Prefer not to say</option></select></div>
            <div class="field"><label for="ph">Phone</label><input id="ph" name="ph" [(ngModel)]="m().phone" /></div>
          </div>
          <div class="field"><label for="ad">Address</label><input id="ad" name="ad" [(ngModel)]="m().address" /></div>
          <div class="row">
            <div class="field"><label for="en">Emergency contact name</label><input id="en" name="en" [(ngModel)]="m().emergency_contact_name" /></div>
            <div class="field"><label for="ep">Emergency contact phone</label><input id="ep" name="ep" [(ngModel)]="m().emergency_contact_phone" /></div>
          </div>
          <div class="field" style="max-width:300px"><label for="nid">National ID</label><input id="nid" name="nid" [(ngModel)]="m().national_id" /></div>
        }
        @if (step() === 1) {
          <div class="row">
            <div class="field"><label for="dp">Department</label>
              <select id="dp" name="dp" [(ngModel)]="m().department_id"><option [ngValue]="null">—</option>
                @for (d of departments(); track d.id) { @if (d.active) { <option [ngValue]="d.id">{{ d.name }}</option> } }</select></div>
            <div class="field"><label for="ds">Designation</label>
              <select id="ds" name="ds" [(ngModel)]="m().designation_id"><option [ngValue]="null">—</option>
                @for (d of designations(); track d.id) { @if (d.active) { <option [ngValue]="d.id">{{ d.title }}</option> } }</select></div>
            <div class="field"><label for="lc">Location</label>
              <select id="lc" name="lc" [(ngModel)]="m().location_id"><option [ngValue]="null">—</option>
                @for (d of locations(); track d.id) { @if (d.active) { <option [ngValue]="d.id">{{ d.name }}</option> } }</select></div>
          </div>
          <div class="row">
            <div class="field"><label for="mg">Reporting manager</label>
              <select id="mg" name="mg" [(ngModel)]="m().manager_id"><option [ngValue]="null">— none —</option>
                @for (e of managers(); track e.id) { <option [ngValue]="e.id">{{ e.name }} ({{ e.emp_code }})</option> }</select></div>
            <div class="field"><label for="et">Employment type</label>
              <select id="et" name="et" [(ngModel)]="m().employment_type">
                <option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="intern">Intern</option></select></div>
            <div class="field"><label for="sl">Salary (annual)</label><input id="sl" name="sl" type="number" min="0" [(ngModel)]="m().salary" /></div>
          </div>
          <div class="row">
            <div class="field"><label for="jd">Join date *</label><input id="jd" name="jd" type="date" [(ngModel)]="m().join_date" /></div>
            <div class="field"><label for="pe">Probation end date</label><input id="pe" name="pe" type="date" [(ngModel)]="m().probation_end_date" /></div>
          </div>
        }
        @if (step() === 2) {
          <div class="row">
            <div class="field"><label for="em">Work email * (used to sign in)</label><input id="em" name="em" type="email" [(ngModel)]="m().email" /></div>
            <div class="field"><label for="rl">Role</label>
              <select id="rl" name="rl" [(ngModel)]="m().role">
                <option value="employee">Employee</option><option value="manager">Manager</option>
                @if (auth.isSuper()) { <option value="hr_admin">HR Admin</option><option value="super_admin">Super Admin</option> }</select></div>
          </div>
          <p class="muted">A temporary password is generated and emailed. The employee must change it at first login.</p>
        }
        <div class="row tight" style="margin-top:8px">
          @if (step() > 0) { <button type="button" class="secondary" (click)="step.set(step() - 1)">Back</button> }
          @if (step() < 2) { <button type="button" (click)="step.set(step() + 1)">Next</button> }
          @if (step() === 2) { <button type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Create employee' }}</button> }
        </div>
      </form>
    }
  `,
})
export class EmployeeNewComponent {
  protected auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);

  steps = ['Personal', 'Job', 'Account'];
  step = signal(0);
  busy = signal(false);
  error = signal('');
  created = signal<any>(null);
  departments = signal<any[]>([]);
  designations = signal<any[]>([]);
  locations = signal<any[]>([]);
  managers = signal<any[]>([]);
  m = signal<any>(this.blank());

  constructor() {
    this.api.get('/departments').subscribe((d) => this.departments.set(d));
    this.api.get('/designations').subscribe((d) => this.designations.set(d));
    this.api.get('/locations').subscribe((d) => this.locations.set(d));
    this.api.get('/employees/options').subscribe((d) => this.managers.set(d));
  }

  blank() {
    return {
      first_name: '', last_name: '', email: '', phone: '', dob: null, gender: '', address: '',
      emergency_contact_name: '', emergency_contact_phone: '', national_id: '', salary: null,
      department_id: null, designation_id: null, location_id: null, manager_id: null,
      employment_type: 'full_time', join_date: new Date().toISOString().slice(0, 10), probation_end_date: null, role: 'employee',
    };
  }

  reset() {
    this.created.set(null);
    this.m.set(this.blank());
    this.step.set(0);
  }

  submit() {
    const m = this.m();
    if (!m.first_name || !m.last_name) return this.fail('First and last name are required', 0);
    if (!m.join_date) return this.fail('Join date is required', 1);
    if (!m.email) return this.fail('Work email is required', 2);
    // Empty strings / empty dates -> null so the server stores NULL
    const body: any = {};
    for (const [k, v] of Object.entries(m)) body[k] = v === '' ? null : v;
    this.busy.set(true);
    this.error.set('');
    this.api.post('/employees', body).subscribe({
      next: (r) => { this.busy.set(false); this.created.set(r); },
      error: (e) => { this.busy.set(false); this.error.set(errMsg(e)); },
    });
  }

  private fail(msg: string, step: number) {
    this.error.set(msg);
    this.step.set(step);
  }
}

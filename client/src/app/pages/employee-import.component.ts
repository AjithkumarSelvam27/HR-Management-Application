import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errMsg, saveBlob } from '../services/api.service';

const TEMPLATE = 'first_name,last_name,email,join_date,phone,department,designation,location,employment_type,manager_email\n' +
  'Jane,Doe,jane.doe@company.com,2026-11-01,555-0100,Engineering,Software Engineer,Head Office,full_time,\n';

@Component({
  imports: [RouterLink],
  template: `
    <h1>Bulk import employees</h1>
    <div class="card">
      <p>Upload a CSV with columns <code>first_name, last_name, email, join_date</code> (YYYY-MM-DD) and optionally
        <code>phone, department, designation, location, employment_type, manager_email</code>.
        Department/designation/location must match existing names.</p>
      <div class="row tight">
        <button class="secondary" (click)="template()">Download template</button>
        <input type="file" accept=".csv,text/csv" (change)="pick($event)" />
        <button [disabled]="!file || busy()" (click)="run(false)">Validate</button>
      </div>
    </div>
    @if (error()) { <div class="error">{{ error() }}</div> }
    @if (result(); as r) {
      @if (r.imported !== undefined) {
        <div class="success">Imported {{ r.imported }} employee(s). <a routerLink="/employees">View list</a></div>
      } @else {
        <div class="card">
          <h2>Preview: {{ r.valid }} valid, {{ r.invalid }} with errors</h2>
          <table><thead><tr><th>Row</th><th>Email</th><th>Result</th></tr></thead><tbody>
            @for (p of r.preview; track p.row) {
              <tr><td>{{ p.row }}</td><td>{{ p.email }}</td>
                <td>@if (p.errors.length) { <span style="color:var(--danger)">{{ p.errors.join('; ') }}</span> } @else { OK }</td></tr>
            }
          </tbody></table>
          <div style="margin-top:12px">
            <button [disabled]="r.invalid > 0 || r.valid === 0 || busy()" (click)="run(true)">Confirm import of {{ r.valid }}</button>
            @if (r.invalid > 0) { <span class="muted"> Fix the errors and validate again.</span> }
          </div>
        </div>
      }
    }
  `,
})
export class EmployeeImportComponent {
  private api = inject(ApiService);
  file: File | null = null;
  busy = signal(false);
  error = signal('');
  result = signal<any>(null);

  template() {
    saveBlob(new Blob([TEMPLATE], { type: 'text/csv' }), 'employee-import-template.csv');
  }

  pick(ev: Event) {
    this.file = (ev.target as HTMLInputElement).files?.[0] ?? null;
    this.result.set(null);
  }

  run(confirm: boolean) {
    if (!this.file) return;
    const fd = new FormData();
    fd.append('file', this.file);
    fd.append('confirm', String(confirm));
    this.busy.set(true);
    this.error.set('');
    this.api.post('/employees/import', fd).subscribe({
      next: (r) => { this.busy.set(false); this.result.set(r); },
      error: (e) => { this.busy.set(false); this.error.set(errMsg(e)); },
    });
  }
}

import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errMsg } from '../services/api.service';
import { AuthService } from '../services/auth.service';

@Component({
  imports: [RouterLink, DatePipe],
  template: `
    <h1>Welcome, {{ auth.session()?.name || auth.session()?.email }}</h1>
    @if (error()) { <div class="error">{{ error() }}</div> }
    @if (d(); as d) {
      @if (d.kpis) {
        <div class="grid kpis" style="margin-bottom:16px">
          <a class="kpi" routerLink="/employees"><div class="v">{{ d.kpis.total }}</div><div class="l">Headcount</div></a>
          <a class="kpi" routerLink="/employees" [queryParams]="{ status: 'active' }"><div class="v">{{ d.kpis.active }}</div><div class="l">Active</div></a>
          <a class="kpi" routerLink="/employees" [queryParams]="{ status: 'probation' }"><div class="v">{{ d.kpis.probation }}</div><div class="l">On probation</div></a>
          <a class="kpi" routerLink="/employees" [queryParams]="{ status: 'onboarding' }"><div class="v">{{ d.kpis.onboarding }}</div><div class="l">Onboarding</div></a>
          <div class="kpi"><div class="v">{{ d.kpis.new_hires_month }}</div><div class="l">New hires this month</div></div>
          <div class="kpi"><div class="v">{{ d.kpis.exits_month }}</div><div class="l">Exits this month</div></div>
        </div>
        <div class="grid cols-2">
          <div class="card"><h2>Headcount by department</h2>
            @for (b of d.by_department; track b.label) {
              <div class="bar"><span class="name">{{ b.label }}</span>
                <span class="track"><span class="fill" style="display:block" [style.width.%]="pct(b.value, d.by_department)"></span></span>
                <span class="num">{{ b.value }}</span></div>
            } @empty { <p class="muted">No employees yet. <a routerLink="/employees/new">Add your first employee</a>.</p> }
          </div>
          <div class="card"><h2>Headcount by location</h2>
            @for (b of d.by_location; track b.label) {
              <div class="bar"><span class="name">{{ b.label }}</span>
                <span class="track"><span class="fill" style="display:block" [style.width.%]="pct(b.value, d.by_location)"></span></span>
                <span class="num">{{ b.value }}</span></div>
            } @empty { <p class="muted">No data yet.</p> }
          </div>
        </div>
        <div class="card"><h2>Hires vs. exits (last 12 months)</h2>
          <table><thead><tr><th>Month</th><th>Hires</th><th>Exits</th><th></th></tr></thead><tbody>
            @for (m of d.hires_vs_exits; track m.month) {
              <tr><td>{{ m.month }}</td><td>{{ m.hires }}</td><td>{{ m.exits }}</td>
                <td><span class="bar"><span class="track" style="width:160px"><span class="fill" style="display:block" [style.width.%]="m.hires * 10"></span></span></span></td></tr>
            }
          </tbody></table>
        </div>
        <div class="card"><h2>Pending actions</h2>
          @if (d.pending_actions; as p) {
            <ul>
              <li>{{ p.incomplete_profiles.length }} incomplete profile(s)
                @for (e of p.incomplete_profiles; track e.id) { · <a [routerLink]="['/employees', e.id]">{{ e.first_name }} {{ e.last_name }}</a> }</li>
              <li>{{ p.probation_ending.length }} probation(s) ending within 30 days
                @for (e of p.probation_ending; track e.id) { · <a [routerLink]="['/employees', e.id]">{{ e.first_name }} {{ e.last_name }}</a> ({{ e.probation_end_date }}) }</li>
              <li>{{ p.expiring_documents.length }} document(s) expiring within 30 days
                @for (x of p.expiring_documents; track x.id) { · <a [routerLink]="['/employees', x.employee_id]">{{ x.filename }}</a> ({{ x.expiry_date }}) }</li>
              <li>{{ p.missing_documents }} employee(s) with no documents on file</li>
            </ul>
          }
        </div>
      }

      @if (d.team) {
        <div class="card"><h2>My team ({{ d.team.headcount }})</h2>
          <table><tbody>
            @for (m of d.team.members; track m.id) {
              <tr class="click" [routerLink]="['/employees', m.id]"><td>{{ m.first_name }} {{ m.last_name }}</td><td class="muted">{{ m.department }}</td></tr>
            } @empty { <tr><td class="muted">No direct or indirect reports.</td></tr> }
          </tbody></table>
        </div>
      }

      @if (d.me) {
        <div class="grid cols-2">
          <div class="card"><h2>My job</h2>
            <dl class="dl">
              <dt>Employee ID</dt><dd>{{ d.me.emp_code }}</dd>
              <dt>Title</dt><dd>{{ d.me.designation || '—' }}</dd>
              <dt>Department</dt><dd>{{ d.me.department || '—' }}</dd>
              <dt>Manager</dt><dd>{{ d.me.manager || '—' }}</dd>
              <dt>Joined</dt><dd>{{ d.me.join_date }}</dd>
              <dt>Profile completeness</dt><dd>{{ d.me.profile_completeness }}%
                @if (d.me.profile_completeness < 100) { · <a [routerLink]="['/employees', auth.session()!.employee_id]">complete it</a> }</dd>
            </dl>
          </div>
          <div class="card"><h2>Upcoming holidays</h2>
            @for (h of d.holidays; track h.holiday_date) { <div>{{ h.holiday_date }} — {{ h.name }}</div> } @empty { <p class="muted">None scheduled.</p> }
          </div>
        </div>
      } @else {
        <div class="card"><h2>Upcoming holidays</h2>
          @for (h of d.holidays; track h.holiday_date) { <div>{{ h.holiday_date }} — {{ h.name }}</div> } @empty { <p class="muted">None scheduled.</p> }
        </div>
      }

      @if (d.birthdays || d.anniversaries || d.new_joiners) {
        <div class="grid cols-3">
          <div class="card"><h2>Birthdays (30 days)</h2>
            @for (p of d.birthdays; track p.id) { <div>{{ p.first_name }} {{ p.last_name }} <span class="muted">{{ p.dob | date: 'MMM d' }}</span></div> } @empty { <p class="muted">None.</p> }</div>
          <div class="card"><h2>Work anniversaries</h2>
            @for (p of d.anniversaries; track p.id) { <div>{{ p.first_name }} {{ p.last_name }} <span class="muted">{{ p.join_date | date: 'MMM d' }}</span></div> } @empty { <p class="muted">None.</p> }</div>
          <div class="card"><h2>New joiners</h2>
            @for (p of d.new_joiners; track p.id) { <div>{{ p.first_name }} {{ p.last_name }} <span class="muted">{{ p.join_date }}</span></div> } @empty { <p class="muted">None.</p> }</div>
        </div>
      }

      @if (d.setup) {
        <div class="grid cols-2">
          <div class="card"><h2>Setup checklist</h2>
            @for (s of d.setup; track s.label) {
              <div>{{ s.done ? '✅' : '⬜' }} <a [routerLink]="s.link">{{ s.label }}</a></div>
            }
          </div>
          <div class="card"><h2>Active users by role</h2>
            @for (r of d.users_by_role; track r.label) { <div>{{ r.label }}: <strong>{{ r.value }}</strong></div> }
            <h2 style="margin-top:16px">Recent audit events</h2>
            @for (a of d.recent_audit; track $index) { <div class="muted">{{ a.action }} — {{ a.user_email || 'system' }}</div> }
          </div>
        </div>
      }
    }
  `,
})
export class DashboardComponent {
  protected auth = inject(AuthService);
  private api = inject(ApiService);
  d = signal<any>(null);
  error = signal('');

  constructor() {
    this.api.get('/dashboard').subscribe({ next: (d) => this.d.set(d), error: (e) => this.error.set(errMsg(e)) });
  }

  pct(v: number, all: { value: number }[]) {
    const max = Math.max(1, ...all.map((a) => a.value));
    return (v / max) * 100;
  }
}

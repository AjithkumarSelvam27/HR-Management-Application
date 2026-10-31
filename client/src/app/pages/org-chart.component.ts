import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errMsg } from '../services/api.service';

@Component({
  selector: 'app-org-node',
  imports: [RouterLink],
  template: `
    <li>
      @if (n().children.length) { <button class="link" (click)="open = !open">{{ open ? '▾' : '▸' }}</button> }
      <span class="node" [style.background]="n().hit ? '#fff4c2' : '#fff'">
        <a [routerLink]="['/employees', n().id]"><strong>{{ n().name }}</strong></a>
        <span class="muted"> {{ n().designation || '' }}{{ n().department ? ' · ' + n().department : '' }}</span>
      </span>
      @if (open && n().children.length) { <ul>@for (c of n().children; track c.id) { <app-org-node [n]="c" /> }</ul> }
    </li>
  `,
})
export class OrgNodeComponent {
  n = input.required<any>();
  open = true;
}

@Component({
  imports: [FormsModule, OrgNodeComponent],
  template: `
    <h1>Org chart</h1>
    @if (error()) { <div class="error">{{ error() }}</div> }
    <div class="card" style="max-width:340px"><label for="s">Search</label><input id="s" [(ngModel)]="q" (ngModelChange)="mark()" placeholder="Highlight a name…" /></div>
    <div class="card tree">
      @if (roots().length > 1) { <div class="muted" style="margin-bottom:8px">{{ roots().length }} people have no manager. Normally only the top executive should.</div> }
      <ul style="padding-left:0;border:0">@for (r of roots(); track r.id) { <app-org-node [n]="r" /> } @empty { <li class="muted">No employees yet.</li> }</ul>
    </div>
  `,
})
export class OrgChartComponent {
  private api = inject(ApiService);
  roots = signal<any[]>([]);
  error = signal('');
  q = '';

  constructor() {
    this.api.get('/org-chart').subscribe({ next: (r) => { this.roots.set(r); this.mark(); }, error: (e) => this.error.set(errMsg(e)) });
  }

  mark() {
    const q = this.q.trim().toLowerCase();
    const walk = (n: any) => { n.hit = !!q && n.name.toLowerCase().includes(q); n.children.forEach(walk); };
    this.roots().forEach(walk);
    this.roots.update((r) => [...r]);
  }
}

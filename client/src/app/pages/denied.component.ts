import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  imports: [RouterLink],
  template: `
    <div class="card" style="max-width:480px;margin:60px auto">
      <h1>Access denied</h1>
      <p class="muted">You don't have permission to view this page.</p>
      <a routerLink="/" class="btn">Back to dashboard</a>
    </div>
  `,
})
export class DeniedComponent {}

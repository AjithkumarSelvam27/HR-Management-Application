import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** Pull the server's `{error: string}` message out of an HttpErrorResponse. */
export function errMsg(e: any): string {
  return e?.error?.error || (e?.status === 0 ? 'Cannot reach the server' : e?.message) || 'Something went wrong';
}

/** Thin HttpClient wrapper. Dev and prod are same-origin, so no CORS / withCredentials is needed. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  private params(p?: Record<string, any>): HttpParams {
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(p ?? {})) {
      if (v !== null && v !== undefined && v !== '') hp = hp.set(k, String(v));
    }
    return hp;
  }

  get<T = any>(url: string, params?: Record<string, any>): Observable<T> {
    return this.http.get<T>('/api' + url, { params: this.params(params) });
  }
  post<T = any>(url: string, body: any = {}): Observable<T> {
    return this.http.post<T>('/api' + url, body);
  }
  put<T = any>(url: string, body: any = {}): Observable<T> {
    return this.http.put<T>('/api' + url, body);
  }
  patch<T = any>(url: string, body: any = {}): Observable<T> {
    return this.http.patch<T>('/api' + url, body);
  }
  delete<T = any>(url: string): Observable<T> {
    return this.http.delete<T>('/api' + url);
  }
  blob(url: string): Observable<Blob> {
    return this.http.get('/api' + url, { responseType: 'blob' });
  }
}

/** Save a Blob as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

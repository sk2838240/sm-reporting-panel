import supabase from './supabase';

export async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

export async function api(path, opts = {}) {
  const headers = { ...(await authHeaders()), ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const msg = body?.error || res.statusText || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
export const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = (path, body) => api(path, { method: 'DELETE', body: JSON.stringify(body) });

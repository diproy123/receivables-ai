const BASE = '';
export async function api(url, opts = {}) {
  try {
    const token = localStorage.getItem('al_token');
    const headers = { ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetch(BASE + url, { ...opts, headers });
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: r.statusText }));
      return { _err: true, ...e };
    }
    return await r.json();
  } catch (e) {
    console.error('[api]', url, e);
    return { _err: true, detail: e.message };
  }
}
export async function post(url, body) {
  return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
export async function postForm(url, formData) {
  return api(url, { method: 'POST', body: formData });
}

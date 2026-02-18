let token = null, onExpire = null;
export const setToken = t => { token = t; };
export const getToken = () => token;
export const onAuthExpire = fn => { onExpire = fn; };

export async function api(path, opts = {}) {
  const h = { ...opts.headers };
  if (token) h['Authorization'] = 'Bearer ' + token;
  try {
    const r = await fetch(path, { ...opts, headers: h });
    if (r.status === 401) { token = null; sessionStorage.removeItem('al_token'); sessionStorage.removeItem('al_user'); onExpire?.(); return null; }
    const j = await r.json();
    if (!r.ok) return { _err: true, status: r.status, detail: j.detail || 'Failed' };
    return j;
  } catch (e) { return { _err: true, detail: 'Network error' }; }
}

export const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const postForm = (path, fd) => api(path, { method: 'POST', body: fd });

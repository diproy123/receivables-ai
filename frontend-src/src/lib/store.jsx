import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { api, setToken, onAuthExpire } from './api';

const Ctx = createContext();
const init = {
  user: null, token: null,
  dash: {}, docs: [], matches: [], anomalies: [], vendors: [], triageData: {}, casesData: [],
  policy: {}, policyHistory: [], ps: {}, intel: {},
  tab: 'dashboard', sel: null, proc: null, toast: null, loading: true,
  ft: { status: null, loading: false },
};

function reducer(s, a) {
  switch (a.type) {
    case 'AUTH': return { ...s, user: a.user, token: a.token };
    case 'LOGOUT': return { ...s, user: null, token: null };
    case 'DATA': return { ...s, ...a.d, loading: false };
    case 'TAB': return { ...s, tab: a.tab, contractId: a.contractId || null };
    case 'SEL': return { ...s, sel: a.doc };
    case 'PROC': return { ...s, proc: a.d };
    case 'TOAST': return { ...s, toast: a.msg ? { msg: a.msg, t: a.t || 'info' } : null };
    case 'POLICY': return { ...s, policy: a.p };
    case 'FT': return { ...s, ft: { ...s.ft, ...a.d } };
    default: return s;
  }
}

export function Store({ children }) {
  const [s, d] = useReducer(reducer, init);
  const tt = useRef();

  useEffect(() => {
    const t = sessionStorage.getItem('al_token'), u = sessionStorage.getItem('al_user');
    if (t && u) { setToken(t); d({ type: 'AUTH', token: t, user: JSON.parse(u) }); }
    onAuthExpire(() => d({ type: 'LOGOUT' }));
  }, []);

  const toast = useCallback((msg, t) => {
    d({ type: 'TOAST', msg, t }); clearTimeout(tt.current);
    tt.current = setTimeout(() => d({ type: 'TOAST', msg: null }), 3500);
  }, []);

  const load = useCallback(async () => {
    const [da, dc, m, an, vn, tr, po, ca, ph, hl] = await Promise.all([
      api('/api/dashboard'), api('/api/documents'), api('/api/matches'), api('/api/anomalies'),
      api('/api/vendors'), api('/api/triage'), api('/api/policy'), api('/api/cases'), api('/api/policy/history'),
      api('/api/health'),
    ]);
    const hs = hl?.stats || {};
    d({ type: 'DATA', d: {
      dash: da || {}, docs: dc?.documents || [], matches: m?.matches || [], anomalies: an?.anomalies || [],
      vendors: vn?.vendors || [], triageData: tr || {}, policy: po?.policy || {},
      casesData: ca?.cases || [], policyHistory: ph?.history || [],
      intel: da?.intelligence || {},
      ps: { v: hl?.version || '', rc: hs.anomaly_rule_count || 0, rules: hs.anomaly_rules || [],
        opp: hs.opportunity_flags || [], lc: hs.language_count || 0, sla: hs.sla_targets || {},
        auth: hs.authority_tiers || [], mp: hs.models?.primary || '', ms: hs.models?.secondary || '',
        ml: hs.models?.primary ? (hs.models.primary + ' + ' + hs.models.secondary + (hs.models.custom_enabled ? ' + ' + hs.models.custom_label : '')) : '' },
    }});
  }, []);

  const login = useCallback(async (email, pw) => {
    const r = await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
    if (r?._err) return r.detail;
    if (r?.success) { setToken(r.token); sessionStorage.setItem('al_token', r.token); sessionStorage.setItem('al_user', JSON.stringify(r.user)); d({ type: 'AUTH', token: r.token, user: r.user }); return null; }
    return 'Login failed';
  }, []);

  const register = useCallback(async (email, pw, name, role) => {
    const r = await api('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, name, role }) });
    if (r?._err) return r.detail;
    if (r?.success) { setToken(r.token); sessionStorage.setItem('al_token', r.token); sessionStorage.setItem('al_user', JSON.stringify(r.user)); d({ type: 'AUTH', token: r.token, user: r.user }); return null; }
    return 'Registration failed';
  }, []);

  const logout = useCallback(() => {
    setToken(null); sessionStorage.removeItem('al_token'); sessionStorage.removeItem('al_user');
    d({ type: 'LOGOUT' });
  }, []);

  return <Ctx.Provider value={{ s, d, toast, load, login, register, logout }}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);

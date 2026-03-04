import { createContext, useContext, useReducer, useCallback, useRef } from 'react';
import { api, post } from './api';

const Ctx = createContext();

function reducer(s, a) {
  switch (a.type) {
    case 'SET': return { ...s, ...a.data };
    case 'TOAST': return { ...s, toast: a.msg ? { msg: a.msg, type: a.t || 'info' } : null };
    case 'SEL': return { ...s, sel: a.doc };
    case 'PAGE': return { ...s, page: a.page };
    case 'TAB': return { ...s, tab: a.tab, tabKey: (s.tabKey || 0) + 1 };
    default: return s;
  }
}

const initial = { page: 'dashboard', tab: 'dashboard', tabKey: 0, toast: null, sel: null, loaded: false };

export function StoreProvider({ children }) {
  const [s, d] = useReducer(reducer, initial);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      // Single round trip instead of 15 separate API calls
      const r = await api('/api/bootstrap');
      if (r && !r._err) {
        d({ type: 'SET', data: {
          invoices: r.invoices || [],
          anomalies: r.anomalies || [],
          matches: r.matches || [],
          purchaseOrders: r.purchaseOrders || [],
          cases: r.cases || [], casesData: r.cases || [],
          triage: r.triage?.summary || {},
          triageData: r.triage || {},
          vendors: r.vendors || [],
          contracts: r.contracts || [],
          policy: r.policy,
          users: r.users || [],
          activityLog: r.activity || [],
          documents: r.documents || [],
          docs: r.documents || [],
          togetherStatus: r.togetherStatus,
          policyHistory: r.policy?.history || [],
          vendorProfiles: r.vendors || [],
          loaded: true,
        }});
      }
      // Fetch dashboard & intel in background (non-blocking)
      Promise.all([
        api('/api/dashboard').then(dr => { if (dr && !dr._err) d({ type: 'SET', data: { dash: dr } }); }),
        api('/api/intelligence/summary').then(ir => { if (ir && !ir._err) d({ type: 'SET', data: { intel: ir } }); }),
      ]).catch(() => {});
    } catch (e) { console.error('Load failed', e); }
    loading.current = false;
  }, []);

  const toast = useCallback((msg, type) => {
    d({ type: 'TOAST', msg, t: type });
    setTimeout(() => d({ type: 'TOAST', msg: null }), 3000);
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const res = await post('/api/auth/login', { email, password });
      if (res._err) return res.detail || 'Login failed';
      localStorage.setItem('al_token', res.token);
      d({ type: 'SET', data: { user: res.user, token: res.token } });
      return null;
    } catch (e) { return e.message || 'Login failed'; }
  }, []);

  const register = useCallback(async (email, password, name, role) => {
    try {
      const res = await post('/api/auth/register', { email, password, name, role });
      if (res._err) return res.detail || 'Registration failed';
      localStorage.setItem('al_token', res.token);
      d({ type: 'SET', data: { user: res.user, token: res.token } });
      return null;
    } catch (e) { return e.message || 'Registration failed'; }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('al_token');
    d({ type: 'SET', data: { user: null, token: null, loaded: false } });
  }, []);

  return <Ctx.Provider value={{ s, d, load, toast, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useStore() { return useContext(Ctx); }

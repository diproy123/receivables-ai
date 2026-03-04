import { createContext, useContext, useReducer, useCallback, useRef } from 'react';
import { api } from './api';

const Ctx = createContext();

function reducer(s, a) {
  switch (a.type) {
    case 'SET': return { ...s, ...a.data };
    case 'TOAST': return { ...s, toast: a.msg ? { msg: a.msg, type: a.t || 'info' } : null };
    case 'SEL': return { ...s, sel: a.doc };
    case 'PAGE': return { ...s, page: a.page };
    default: return s;
  }
}

const initial = { page: 'dashboard', toast: null, sel: null, loaded: false };

export function StoreProvider({ children }) {
  const [s, d] = useReducer(reducer, initial);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const [info, invR, anomR, matchR, poR, caseR, triR, venR, conR, polR, usrR, actR, docR, tgtR] = await Promise.all([
        api('/api/system-info'),
        api('/api/invoices'), api('/api/anomalies'), api('/api/matches'), api('/api/purchase-orders'),
        api('/api/cases'), api('/api/triage'), api('/api/vendors'), api('/api/contracts'),
        api('/api/policy'), api('/api/users'), api('/api/activity'),
        api('/api/documents'), api('/api/together/status'),
      ]);
      d({ type: 'SET', data: {
        info, invoices: invR?.invoices || invR || [], anomalies: anomR?.anomalies || anomR || [],
        matches: matchR?.matches || matchR || [], purchaseOrders: poR?.purchase_orders || poR || [],
        cases: caseR?.cases || caseR || [], triage: triR?.summary || triR || {},
        triageItems: triR?.items || [], vendors: venR?.vendors || venR || [],
        contracts: conR?.contracts || conR || [], policy: polR, users: usrR?.users || usrR || [],
        activityLog: actR?.activity || actR || [], documents: docR?.documents || docR || [],
        togetherStatus: tgtR, policyHistory: polR?.history || [],
        vendorProfiles: venR?.vendor_profiles || [], loaded: true,
      }});
    } catch (e) { console.error('Load failed', e); }
    loading.current = false;
  }, []);

  const toast = useCallback((msg, type) => {
    d({ type: 'TOAST', msg, t: type });
    setTimeout(() => d({ type: 'TOAST', msg: null }), 3000);
  }, []);

  return <Ctx.Provider value={{ s, d, load, toast }}>{children}</Ctx.Provider>;
}

export function useStore() { return useContext(Ctx); }

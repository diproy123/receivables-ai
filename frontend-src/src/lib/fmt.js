export const $ = (v, cur = 'USD') => {
  const n = parseFloat(v) || 0;
  const sym = { USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', CNY: '¥', KRW: '₩', BRL: 'R$', AED: 'د.إ', SAR: '﷼' }[cur] || cur + ' ';
  return sym + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const $f = (v, cur = 'USD') => {
  const n = parseFloat(v) || 0;
  if (n >= 1e6) return $(n / 1e6, cur).replace(/\.00$/, '') + 'M';
  if (n >= 1e3) return $(n / 1e3, cur).replace(/\.00$/, '') + 'K';
  return $(n, cur);
};
export const num = v => (parseFloat(v) || 0).toLocaleString();
export const pct = v => (parseFloat(v) || 0).toFixed(1) + '%';
export const date = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
export const dateTime = d => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const cn = (...args) => args.filter(Boolean).join(' ');
export const sevColor = s => ({ critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#3b82f6', info: '#6366f1' }[s] || '#94a3b8');
export const laneLabel = l => ({ auto: 'Auto-Approved', review: 'Needs Review', blocked: 'Blocked', pending: 'Pending' }[l] || l || 'Unknown');
export const laneColor = l => ({ auto: '#10b981', review: '#f59e0b', blocked: '#ef4444', pending: '#94a3b8' }[l] || '#94a3b8');
export const docLabel = t => ({ invoice: 'Invoice', purchase_order: 'PO', contract: 'Contract', credit_note: 'Credit Note', debit_note: 'Debit Note', goods_receipt: 'GRN' }[t] || t || 'Doc');
export const docColor = t => ({ invoice: '#3b82f6', purchase_order: '#8b5cf6', contract: '#0891b2', credit_note: '#10b981', debit_note: '#f97316', goods_receipt: '#6366f1' }[t] || '#94a3b8');
export const short = (s, n = 30) => s && s.length > n ? s.slice(0, n) + '…' : (s || '—');

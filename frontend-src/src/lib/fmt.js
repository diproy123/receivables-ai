const CF = {};
export function $(n, cur = 'USD') {
  if (n == null || isNaN(n)) return '—';
  if (!CF[cur]) try { CF[cur] = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0 }); } catch { CF[cur] = CF.USD; }
  return CF[cur].format(n);
}
export function $f(n, cur = 'USD') {
  if (n == null || isNaN(n)) return '—';
  if (!CF[cur+'f']) try { CF[cur+'f'] = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch { CF[cur+'f'] = CF.USDf; }
  return CF[cur+'f'].format(n);
}
export const num = n => n == null ? '—' : new Intl.NumberFormat('en-US').format(n);
export const pct = n => n == null ? '—' : Math.round(n) + '%';
export const date = d => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d; } };
export const dateTime = d => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return d; } };
export const cn = (...c) => c.filter(Boolean).join(' ');
export const sevColor = s => s === 'high' ? 'err' : s === 'medium' ? 'warn' : 'ok';
export const laneLabel = l => ({ AUTO_APPROVE: '✓ Approved', MANAGER_REVIEW: 'Manager Review', VP_REVIEW: 'VP Review', CFO_REVIEW: 'CFO Review', BLOCK: '⛔ Blocked' })[l] || l;
export const laneColor = l => l === 'AUTO_APPROVE' ? 'ok' : l === 'BLOCK' ? 'err' : 'warn';
export const docLabel = t => ({ invoice: 'Invoice', purchase_order: 'PO', contract: 'Contract', goods_receipt: 'GRN', credit_note: 'Credit Note', debit_note: 'Debit Note' })[t] || t;
export const docColor = t => ({ invoice: 'info', purchase_order: 'warn', contract: 'muted', goods_receipt: 'ok', credit_note: 'err', debit_note: 'err' })[t] || 'muted';
export const short = (n, cur) => { n = Number(n) || 0; const s = { USD: '$', EUR: '€', GBP: '£', INR: '₹', AED: 'د.إ', JPY: '¥' }[cur] || cur + ' '; if (Math.abs(n) >= 1e6) return s + (n / 1e6).toFixed(1) + 'M'; if (Math.abs(n) >= 1e4) return s + (n / 1e3).toFixed(1) + 'K'; return s + n.toLocaleString(); };

import { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from './lib/store';
import { api, post, postForm } from './lib/api';
import { $, $f, num, pct, date, dateTime, cn, sevColor, laneLabel, laneColor, docLabel, docColor, short } from './lib/fmt';
import {
  LayoutDashboard, FileText, Zap, ClipboardList, AlertTriangle, Link2, Building2, FileCheck,
  Settings, Brain, Upload, Database, Trash2, LogOut, Shield, ChevronRight, Search,
  CheckCircle2, XCircle, Clock, TrendingUp, Eye, Edit3, X, UploadCloud, FileUp,
  ArrowUpRight, ArrowDownRight, RotateCcw, Check, Filter, RefreshCw, AlertCircle,
  CircleDot, ExternalLink
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

/* ═══════════════════════════════════════════════════
   BADGE / STAT CARD / TABLE PRIMITIVES
   ═══════════════════════════════════════════════════ */
const Badge = ({ children, c = 'muted' }) => <span className={`badge badge-${c}`}>{children}</span>;

function StatCard({ icon: Icon, label, value, sub, color = '#3b82f6' }) {
  return (
    <div className="card p-5 animate-fade-in">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md" style={{ background: `linear-gradient(135deg, ${color}, ${color}dd)`, boxShadow: `0 4px 12px ${color}30` }}>
          <Icon className="w-5 h-5 text-white" strokeWidth={2} />
        </div>
      </div>
      <div className="text-[26px] font-extrabold tracking-tight text-slate-900 leading-none">{value}</div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-1.5">{label}</div>
      {sub && <div className="text-[12px] text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function Table({ cols, rows, onRow }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50/80">
              {cols.map((c, i) => <th key={i} className={cn('px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider', c.right && 'text-right')}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.id || i} onClick={() => onRow?.(r)} className={cn('transition-colors', onRow && 'cursor-pointer hover:bg-slate-50')}>
                {cols.map((c, j) => <td key={j} className={cn('px-4 py-3', c.right && 'text-right', c.mono && 'font-mono')}>{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={cols.length} className="px-4 py-12 text-center text-slate-400">No data yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConfidenceRing({ score, size = 40 }) {
  const r = (size - 4) / 2, c = 2 * Math.PI * r, o = c * (1 - score / 100);
  const cl = score >= 85 ? '#10b981' : score >= 65 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="3" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={cl} strokeWidth="3" strokeDasharray={c} strokeDashoffset={o} strokeLinecap="round" />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central" fill={cl} fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono'" style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>{Math.round(score)}</text>
    </svg>
  );
}

const PageHeader = ({ title, sub, children }) => (
  <div className="flex items-start justify-between mb-6">
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{title}</h1>
      {sub && <p className="text-sm text-slate-500 mt-1">{sub}</p>}
    </div>
    {children && <div className="flex items-center gap-2">{children}</div>}
  </div>
);

/* ═══════════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════════ */
function Toast() {
  const { s } = useStore();
  if (!s.toast) return null;
  const colors = { success: 'bg-emerald-600', warning: 'bg-amber-500', danger: 'bg-red-600', info: 'bg-accent-600' };
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-slide-up">
      <div className={`${colors[s.toast.t] || colors.info} text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3`}>
        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
        <span className="text-sm font-medium">{s.toast.msg}</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════ */
const RL = { analyst: 0, manager: 1, vp: 2, cfo: 3 };

function Sidebar() {
  const { s, d, logout, toast, load } = useStore();
  const role = s.user?.role || 'analyst';
  const lvl = RL[role] || 0;
  const oa = (s.anomalies || []).filter(a => a.status === 'open').length;
  const rm = (s.matches || []).filter(m => m.status === 'pending_review').length;
  const tri = s.dash?.triage || {};

  const nav = [
    { section: 'Inbox', items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'documents', label: 'Documents', icon: FileText },
      { id: 'triage', label: 'Triage', icon: Zap, badge: tri.blocked, bc: 'err' },
      { id: 'cases', label: 'Cases', icon: ClipboardList, badge: s.dash?.cases?.active, bc: 'warn' },
    ]},
    { section: 'Audit', items: [
      { id: 'anomalies', label: 'Anomalies', icon: AlertTriangle, badge: oa, bc: 'err' },
      { id: 'matching', label: 'PO Matching', icon: Link2, badge: rm, bc: 'warn' },
    ]},
    { section: 'Master Data', items: [
      { id: 'vendors', label: 'Vendors', icon: Building2, badge: s.dash?.vendor_risk?.high_risk, bc: 'err' },
      { id: 'contracts', label: 'Contracts', icon: FileCheck },
    ]},
    ...(lvl >= 1 ? [{ section: 'Configure', items: [
      { id: 'settings', label: 'AP Policy', icon: Settings },
      { id: 'training', label: 'Model Training', icon: Brain },
    ]}] : []),
  ];

  async function seed() {
    const r = await api('/api/seed-demo', { method: 'POST', headers: s.token ? { Authorization: 'Bearer ' + s.token } : {} });
    const j = r; if (j?.success) { await load(); toast('Demo data loaded', 'success'); } else toast('Seed failed', 'danger');
  }
  async function reset() {
    if (!confirm('Clear all data?')) return;
    await api('/api/reset', { method: 'POST', headers: s.token ? { Authorization: 'Bearer ' + s.token } : {} });
    await load(); toast('Data cleared', 'success');
  }

  return (
    <aside className="w-[258px] bg-white border-r border-slate-200/60 flex flex-col fixed inset-y-0 left-0 z-40 shadow-[1px_0_8px_rgba(0,0,0,.02)]">
      <div className="flex items-center gap-3 px-5 pt-6 pb-5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center shadow-md shadow-red-200/50">
          <Shield className="w-[18px] h-[18px] text-white" strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-[17px] font-extrabold tracking-tight">AuditLens</div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[.12em]">AP Intelligence</div>
        </div>
      </div>
      <div className="px-3 mb-3">
        <button onClick={() => d({ type: 'TAB', tab: 'upload' })} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent-600 text-white font-bold text-sm shadow-sm shadow-blue-200/60 hover:bg-accent-700 transition-all active:scale-[.98]">
          <Upload className="w-4 h-4" /> Upload Document
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {nav.map(sec => (
          <div key={sec.section}>
            <div className="text-[10px] font-bold text-accent-600/80 uppercase tracking-[.1em] px-3 pt-5 pb-2">{sec.section}</div>
            {sec.items.map(it => {
              const on = s.tab === it.id; const Ic = it.icon;
              return (
                <button key={it.id} onClick={() => d({ type: 'TAB', tab: it.id })}
                  className={cn('w-full flex items-center gap-3 px-3 py-[9px] rounded-xl text-[13.5px] font-medium transition-all mb-0.5',
                    on ? 'bg-accent-50 text-accent-700 font-semibold' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800')}>
                  <Ic className={cn('w-[18px] h-[18px]', on ? 'text-accent-600' : 'text-slate-400')} strokeWidth={on ? 2.2 : 1.8} />
                  {it.label}
                  {it.badge > 0 && <span className={`badge badge-${it.bc} ml-auto`}>{it.badge}</span>}
                </button>
              );
            })}
          </div>
        ))}
        {lvl >= 2 && (
          <div>
            <div className="text-[10px] font-bold text-accent-600/80 uppercase tracking-[.1em] px-3 pt-5 pb-2">Admin</div>
            <button onClick={seed} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] text-emerald-600 hover:bg-emerald-50 font-medium"><Database className="w-4 h-4" /> Load Sample Data</button>
            <button onClick={reset} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] text-red-500 hover:bg-red-50 font-medium"><Trash2 className="w-4 h-4" /> Clear All Data</button>
          </div>
        )}
      </nav>
      {s.user && (
        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-accent-600 text-white flex items-center justify-center text-xs font-bold">{(s.user.name||'?')[0].toUpperCase()}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold truncate">{s.user.name}</div>
              <div className="text-[10px] text-slate-400 truncate">{s.user.email}</div>
            </div>
            <button onClick={logout} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      )}
    </aside>
  );
}

/* ═══════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════ */
const PIE_C = ['#10b981', '#f59e0b', '#ef4444'];

function Dashboard() {
  const { s } = useStore();
  const d = s.dash || {}, sb = d.summary_bar || {}, ag = d.aging || {}, tri = d.triage || {};
  const vr = d.vendor_risk || {};
  const sp = d.processing_speed || {};
  const svb = d.savings_breakdown || {};
  const tv = d.top_vendors || [];
  const sv = d.savings_discovered || 0;
  const oa = (s.anomalies || []).filter(a => a.status === 'open');
  const pie = [
    { name: 'Auto-Approved', value: tri.auto_approved || 0 },
    { name: 'In Review', value: tri.in_review || 0 },
    { name: 'Blocked', value: tri.blocked || 0 },
  ].filter(d => d.value > 0);
  const aging = [{ name: '0-30d', v: ag['0-30'] || 0 }, { name: '31-60d', v: ag['31-60'] || 0 }, { name: '61-90d', v: ag['61-90'] || 0 }, { name: '90d+', v: ag['90+'] || 0 }];

  return (
    <div className="page-enter space-y-6">
      <PageHeader title="Dashboard" sub="Real-time AP audit intelligence" />

      {/* ── Savings Discovered Banner ── */}
      {sv > 0 && (
        <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <div className="text-sm font-medium opacity-85 mb-1">✔ Total Savings Discovered</div>
              <div className="text-4xl font-extrabold tracking-tight">{$(sv)}</div>
              <div className="text-sm opacity-70 mt-1">Across {num(d.total_documents || 0)} documents</div>
            </div>
            <div className="flex gap-6 flex-wrap">
              {svb.overcharges > 0 && <div className="text-center"><div className="text-xl font-bold">{$(svb.overcharges)}</div><div className="text-xs opacity-75">Overcharges</div></div>}
              {svb.duplicates_prevented > 0 && <div className="text-center"><div className="text-xl font-bold">{$(svb.duplicates_prevented)}</div><div className="text-xs opacity-75">Duplicates</div></div>}
              {svb.contract_violations > 0 && <div className="text-center"><div className="text-xl font-bold">{$(svb.contract_violations)}</div><div className="text-xs opacity-75">Contract</div></div>}
              {svb.unauthorized_items > 0 && <div className="text-center"><div className="text-xl font-bold">{$(svb.unauthorized_items)}</div><div className="text-xs opacity-75">Unauthorized</div></div>}
              {svb.early_payment_opportunities > 0 && <div className="text-center"><div className="text-xl font-bold">{$(svb.early_payment_opportunities)}</div><div className="text-xs opacity-75">Early Pay</div></div>}
            </div>
          </div>
        </div>
      )}

      {/* ── Processing Speed Banner ── */}
      {sp.documents_with_timing > 0 && (
        <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #1e40af, #3b82f6)' }}>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <div className="text-sm font-medium opacity-85 mb-1">⚡ Processing Speed</div>
              <div className="text-3xl font-extrabold tracking-tight">{sp.avg_total_seconds || 0}s <span className="text-base opacity-75">avg per document</span></div>
              <div className="text-sm opacity-70 mt-1">vs 15 min manual — <strong>{sp.speedup_factor || 0}x faster</strong></div>
            </div>
            <div className="flex gap-5 flex-wrap">
              <div className="text-center"><div className="text-lg font-bold">{sp.avg_extraction_ms || 0}ms</div><div className="text-xs opacity-75">Extraction</div></div>
              <div className="text-center"><div className="text-lg font-bold">{sp.avg_matching_ms || 0}ms</div><div className="text-xs opacity-75">Matching</div></div>
              <div className="text-center"><div className="text-lg font-bold">{sp.avg_anomaly_ms || 0}ms</div><div className="text-xs opacity-75">Anomaly</div></div>
              <div className="text-center"><div className="text-lg font-bold">{sp.avg_triage_ms || 0}ms</div><div className="text-xs opacity-75">Triage</div></div>
            </div>
          </div>
        </div>
      )}

      {/* ── Primary Stat Cards (original 4) ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Total Invoices" value={num(sb.total_invoices || 0)} color="#3b82f6" />
        <StatCard icon={Zap} label="Auto-Approved" value={pct(sb.auto_approve_rate)} sub={`${tri.auto_approved || 0} invoices`} color="#10b981" />
        <StatCard icon={AlertTriangle} label="Open Anomalies" value={oa.length} sub={`${short(sb.total_risk || 0, 'USD')} at risk`} color="#ef4444" />
        <StatCard icon={Shield} label="Avg Confidence" value={pct(sb.avg_confidence)} color="#8b5cf6" />
      </div>

      {/* ── Extended Stat Cards (from old app.js) ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={FileCheck} label="Total Outstanding" value={$(d.total_ap || 0)} sub={`${num(d.unpaid_count || 0)} unpaid`} color="#3b82f6" />
        <StatCard icon={Link2} label="Auto-Matched" value={num(d.auto_matched || 0)} sub={`${d.review_needed || 0} need review`} color="#10b981" />
        <StatCard icon={Building2} label="High Risk Vendors" value={num(vr.high_risk || 0)} sub={vr.worsening ? `${vr.worsening} worsening` : 'All stable'} color="#f59e0b" />
        <StatCard icon={Brain} label="AI Pipeline" value={num(d.correction_patterns || 0)} sub={d.correction_patterns ? 'learned patterns' : 'Ensemble + RAG'} color="#7c3aed" />
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-6">
          <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-5">Triage Distribution</h3>
          {pie.length > 0 ? (
            <div className="flex items-center gap-8">
              <div className="w-36 h-36"><ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" cx="50%" cy="50%" outerRadius={60} innerRadius={38} strokeWidth={2}>{pie.map((_, i) => <Cell key={i} fill={PIE_C[i]} />)}</Pie></PieChart></ResponsiveContainer></div>
              <div className="space-y-3">{pie.map((p, i) => <div key={p.name} className="flex items-center gap-3"><div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_C[i] }} /><span className="text-sm text-slate-600">{p.name}</span><span className="font-bold text-sm ml-auto font-mono">{p.value}</span></div>)}</div>
            </div>
          ) : <div className="text-center py-10 text-slate-400 text-sm">Upload invoices to begin</div>}
        </div>
        <div className="card p-6">
          <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-5">Invoice Aging</h3>
          {aging.some(d => d.v > 0) ? (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={aging}><XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 8px 32px rgba(0,0,0,.1)', fontSize: 13 }} /><Bar dataKey="v" fill="#3b82f6" radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          ) : <div className="text-center py-10 text-slate-400 text-sm">No aging data</div>}
        </div>
      </div>

      {/* ── Top Vendors by Spend ── */}
      {tv.length > 0 && (
        <div className="card p-6">
          <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-5">Top Vendors by Spend</h3>
          <div className="space-y-3">{tv.map((v, i) => {
            const p = tv[0]?.spend > 0 ? (v.spend / tv[0].spend) * 100 : 0;
            return (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600 font-medium">{v.vendor || 'Unknown'}</span>
                  <span className="font-mono font-semibold">{$(v.spend)}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${p}%`, background: 'linear-gradient(90deg, #3b82f6, #7c3aed)' }} />
                </div>
              </div>
            );
          })}</div>
        </div>
      )}

      {/* ── Recent Anomalies ── */}
      {oa.length > 0 && (
        <div className="card p-6">
          <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-4">Recent Anomalies</h3>
          <div className="space-y-2">{oa.slice(0, 5).map(a => (
            <div key={a.id} className="flex items-center gap-4 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
              <div className={cn('w-2 h-2 rounded-full', a.severity === 'high' ? 'bg-red-500' : a.severity === 'medium' ? 'bg-amber-500' : 'bg-emerald-500')} />
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{a.description}</div><div className="text-xs text-slate-400">{a.invoiceNumber} · {a.vendor}</div></div>
              <div className="text-sm font-bold text-red-600 font-mono">{$(Math.abs(a.amount_at_risk || 0))}</div>
            </div>
          ))}</div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   DOCUMENTS
   ═══════════════════════════════════════════════════ */
function Documents() {
  const { s, d } = useStore();
  const [q, setQ] = useState('');
  const docs = (s.docs || []).filter(x => !q || JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page-enter">
      <PageHeader title="Documents" sub={`${s.docs.length} documents extracted`}>
        <div className="relative"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp pl-9 w-64" placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} /></div>
        <button onClick={() => d({ type: 'TAB', tab: 'upload' })} className="btn-p"><Upload className="w-4 h-4" /> Upload</button>
      </PageHeader>
      <Table
        cols={[
          { label: 'Document', render: r => <div><div className="font-semibold text-slate-900">{r.invoiceNumber || r.poNumber || r.documentNumber || r.id}</div><div className="text-xs text-slate-400">{r.vendor}</div></div> },
          { label: 'Type', render: r => <Badge c={docColor(r.type)}>{docLabel(r.type)}</Badge> },
          { label: 'Amount', right: true, mono: true, render: r => <span className="font-semibold">{$(r.amount, r.currency)}</span> },
          { label: 'Date', render: r => <span className="text-slate-500">{date(r.issueDate)}</span> },
          { label: 'Confidence', render: r => <ConfidenceRing score={r.confidence || 0} /> },
          { label: 'Status', render: r => <Badge c={r.status === 'paid' ? 'ok' : r.status === 'disputed' ? 'err' : r.status === 'approved' ? 'ok' : 'warn'}>{(r.status || '').replace(/_/g, ' ')}</Badge> },
        ]}
        rows={docs}
        onRow={r => d({ type: 'SEL', doc: r })}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ANOMALIES
   ═══════════════════════════════════════════════════ */
function Anomalies() {
  const { s, toast, load } = useStore();
  const anoms = s.anomalies || [];
  async function resolve(id) { const n = prompt('Resolution notes:'); if (n) { await post(`/api/anomalies/${id}/resolve`, { resolution: n }); await load(); toast('Resolved', 'success'); } }
  async function dismiss(id) { const n = prompt('Reason:'); if (n) { await post(`/api/anomalies/${id}/dismiss`, { reason: n }); await load(); toast('Dismissed', 'success'); } }
  return (
    <div className="page-enter">
      <PageHeader title="Anomalies" sub={`${anoms.filter(a => a.status === 'open').length} open anomalies`} />
      <Table
        cols={[
          { label: 'Anomaly', render: r => <div><div className="font-semibold">{r.description?.slice(0, 60)}</div><div className="text-xs text-slate-400">{r.invoiceNumber} · {r.vendor}</div></div> },
          { label: 'Severity', render: r => <Badge c={sevColor(r.severity) === 'err' ? 'err' : sevColor(r.severity) === 'warn' ? 'warn' : 'ok'}>{r.severity}</Badge> },
          { label: 'Risk', right: true, mono: true, render: r => <span className="text-red-600 font-semibold">{$(Math.abs(r.amount_at_risk || 0))}</span> },
          { label: 'Type', render: r => <span className="text-xs text-slate-500">{(r.type || '').replace(/_/g, ' ')}</span> },
          { label: 'Status', render: r => <Badge c={r.status === 'open' ? 'warn' : r.status === 'resolved' ? 'ok' : 'muted'}>{r.status}</Badge> },
          { label: '', render: r => r.status === 'open' && (
            <div className="flex gap-1">
              <button onClick={e => { e.stopPropagation(); resolve(r.id); }} className="btn-g text-xs px-2 py-1"><Check className="w-3 h-3" /> Resolve</button>
              <button onClick={e => { e.stopPropagation(); dismiss(r.id); }} className="btn-g text-xs px-2 py-1"><X className="w-3 h-3" /></button>
            </div>
          )},
        ]}
        rows={anoms}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PO MATCHING
   ═══════════════════════════════════════════════════ */
function Matching() {
  const { s, toast, load } = useStore();
  const matches = s.matches || [];
  async function approve(id) { await post(`/api/matches/${id}/approve`, {}); await load(); toast('Match approved', 'success'); }
  async function reject(id) { await post(`/api/matches/${id}/reject`, {}); await load(); toast('Match rejected', 'warning'); }
  return (
    <div className="page-enter">
      <PageHeader title="PO Matching" sub={`${matches.length} matches`} />
      <Table
        cols={[
          { label: 'Invoice → PO', render: r => <div><span className="font-semibold">{r.invoiceNumber}</span><span className="text-slate-400 mx-2">→</span><span className="font-semibold text-accent-600">{r.poNumber}</span></div> },
          { label: 'Vendor', render: r => <span className="text-slate-600">{r.vendor}</span> },
          { label: 'Δ Amount', right: true, render: r => { const d = r.amountDifference || 0; return <span className={cn('font-mono font-semibold', Math.abs(d) > 0 ? 'text-red-600' : 'text-emerald-600')}>{d > 0 ? '+' : ''}{$f(d)}</span>; }},
          { label: 'Match', render: r => <ConfidenceRing score={r.matchScore || 0} /> },
          { label: 'Status', render: r => <Badge c={r.status === 'matched' ? 'ok' : r.status === 'mismatch' ? 'err' : 'warn'}>{r.status}</Badge> },
          { label: '', render: r => r.status === 'pending_review' && (
            <div className="flex gap-1">
              <button onClick={e => { e.stopPropagation(); approve(r.id); }} className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded-lg transition-all"><Check className="w-4 h-4" /></button>
              <button onClick={e => { e.stopPropagation(); reject(r.id); }} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-all"><X className="w-4 h-4" /></button>
            </div>
          )},
        ]}
        rows={matches}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TRIAGE
   ═══════════════════════════════════════════════════ */
function Triage() {
  const { s } = useStore();
  const tri = s.triageData || {};
  const lanes = ['AUTO_APPROVE', 'MANAGER_REVIEW', 'VP_REVIEW', 'CFO_REVIEW', 'BLOCK'];
  const laneIcons = { AUTO_APPROVE: CheckCircle2, BLOCK: XCircle, MANAGER_REVIEW: Eye, VP_REVIEW: Eye, CFO_REVIEW: Eye };

  const bgMap = { AUTO_APPROVE: 'bg-emerald-50 border-b border-emerald-100', BLOCK: 'bg-red-50 border-b border-red-100', MANAGER_REVIEW: 'bg-amber-50 border-b border-amber-100', VP_REVIEW: 'bg-amber-50 border-b border-amber-100', CFO_REVIEW: 'bg-amber-50 border-b border-amber-100' };
  const icMap = { AUTO_APPROVE: 'text-emerald-600', BLOCK: 'text-red-600', MANAGER_REVIEW: 'text-amber-600', VP_REVIEW: 'text-amber-600', CFO_REVIEW: 'text-amber-600' };
  const txtMap = { AUTO_APPROVE: 'text-emerald-900', BLOCK: 'text-red-900', MANAGER_REVIEW: 'text-amber-900', VP_REVIEW: 'text-amber-900', CFO_REVIEW: 'text-amber-900' };

  return (
    <div className="page-enter space-y-6">
      <PageHeader title="Triage" sub="Policy-driven invoice routing" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {lanes.map(lane => {
          const items = tri[lane] || [];
          if (items.length === 0 && lane !== 'AUTO_APPROVE' && lane !== 'BLOCK') return null;
          const Ic = laneIcons[lane] || Eye;
          return (
            <div key={lane} className="card overflow-hidden">
              <div className={cn('px-5 py-3.5 flex items-center gap-3', bgMap[lane])}>
                <Ic className={cn('w-5 h-5', icMap[lane])} />
                <div className="flex-1"><div className={cn('text-sm font-bold', txtMap[lane])}>{laneLabel(lane)}</div></div>
                <span className={`badge badge-${laneColor(lane)}`}>{items.length}</span>
              </div>
              <div className="divide-y divide-slate-50 max-h-[320px] overflow-y-auto">
                {items.length === 0 && <div className="p-6 text-center text-sm text-slate-400">No invoices</div>}
                {items.map(inv => (
                  <div key={inv.id} className="px-5 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-sm">{inv.invoiceNumber || inv.id}</div>
                      <span className="text-sm font-bold font-mono">{$(inv.amount, inv.currency)}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{inv.vendor} · {pct(inv.confidence)} conf</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   CASES
   ═══════════════════════════════════════════════════ */
function Cases() {
  const { s, toast, load } = useStore();
  const cases = s.casesData || [];
  const [detail, setDetail] = useState(null);
  const priColor = { critical: 'err', high: 'warn', medium: 'info', low: 'muted' };

  async function viewCase(c) { const r = await api(`/api/cases/${c.id}`); if (r && !r._err) setDetail(r); }
  async function resolve(id) { const n = prompt('Resolution notes (required):'); if (n?.trim()) { await post(`/api/cases/${id}/transition`, { status: 'resolved', reason: n.trim() }); await load(); setDetail(null); toast('Case resolved', 'success'); } }
  async function escalate(id) { const n = prompt('Escalation reason:'); if (n) { await post(`/api/cases/${id}/escalate`, { reason: n, escalatedTo: '' }); await load(); setDetail(null); toast('Case escalated', 'warning'); } }
  async function assign(id) { const n = prompt('Assign to (name):'); if (n) { await post(`/api/cases/${id}/assign`, { assignedTo: n }); await load(); const r = await api(`/api/cases/${id}`); if (r && !r._err) setDetail(r); toast('Assigned to ' + n, 'success'); } }
  async function addNote(id) { const n = prompt('Add note:'); if (n) { await post(`/api/cases/${id}/note`, { text: n }); const r = await api(`/api/cases/${id}`); if (r && !r._err) setDetail(r); toast('Note added', 'success'); } }
  async function createCase() { const title = prompt('Case title:'); if (title) { const desc = prompt('Description:') || ''; const r = await post('/api/cases', { title, description: desc, type: 'general_investigation', priority: 'medium' }); if (r?.success) { await load(); toast('Case created: ' + r.case.id, 'success'); } } }

  return (
    <div className="page-enter">
      <PageHeader title="Cases" sub={`${cases.filter(c => c.status !== 'closed').length} active cases`}>
        <button onClick={createCase} className="btn-p"><ClipboardList className="w-4 h-4" /> Create Case</button>
      </PageHeader>
      <Table
        cols={[
          { label: 'Case', render: r => <div><div className="font-semibold">{r.title || r.id}</div><div className="text-xs text-slate-400">{r.id}</div></div> },
          { label: 'Priority', render: r => <Badge c={priColor[r.priority] || 'muted'}>{r.priority}</Badge> },
          { label: 'Status', render: r => <Badge c={r.status === 'resolved' ? 'ok' : r.status === 'escalated' ? 'err' : 'warn'}>{(r.status || '').replace(/_/g, ' ')}</Badge> },
          { label: 'Invoice', render: r => <span className="text-xs font-mono text-slate-500">{r.invoiceId || '—'}</span> },
          { label: 'Assigned', render: r => <span className="text-sm text-slate-600">{r.assignedTo || '—'}</span> },
          { label: 'Created', render: r => <span className="text-sm text-slate-500">{date(r.createdAt)}</span> },
        ]}
        rows={cases}
        onRow={viewCase}
      />
      {/* Case Detail Modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setDetail(null)}>
          <div className="card w-full max-w-[640px] max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="text-lg font-bold">{detail.title}</div>
                <div className="text-xs text-slate-400 font-mono mt-1">{detail.id}</div>
              </div>
              <button onClick={() => setDetail(null)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div><div className="text-[10px] font-semibold text-slate-400 uppercase">Priority</div><Badge c={priColor[detail.priority] || 'muted'}>{detail.priority}</Badge></div>
              <div><div className="text-[10px] font-semibold text-slate-400 uppercase">Status</div><Badge c={detail.status === 'resolved' ? 'ok' : 'warn'}>{(detail.status || '').replace(/_/g, ' ')}</Badge></div>
              <div><div className="text-[10px] font-semibold text-slate-400 uppercase">Assigned</div><div className="text-sm font-medium">{detail.assignedTo || '—'}</div></div>
              <div><div className="text-[10px] font-semibold text-slate-400 uppercase">Created</div><div className="text-sm">{dateTime(detail.createdAt)}</div></div>
            </div>
            {detail.description && <div className="p-3 bg-slate-50 rounded-xl text-sm text-slate-600 mb-4">{detail.description}</div>}
            {/* Notes */}
            {detail.notes?.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] font-bold text-slate-900 uppercase tracking-wider mb-2">Notes</div>
                <div className="space-y-2">{detail.notes.map((n, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-xl">
                    <div className="text-sm">{n.text}</div>
                    <div className="text-[10px] text-slate-400 mt-1">{n.addedBy} · {dateTime(n.addedAt)}</div>
                  </div>
                ))}</div>
              </div>
            )}
            {/* Actions */}
            <div className="flex gap-2 flex-wrap pt-2 border-t border-slate-100">
              {detail.status !== 'resolved' && detail.status !== 'closed' && (
                <>
                  <button onClick={() => resolve(detail.id)} className="btn bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs"><Check className="w-3 h-3" /> Resolve</button>
                  <button onClick={() => escalate(detail.id)} className="btn bg-red-50 text-red-700 hover:bg-red-100 text-xs"><ArrowUpRight className="w-3 h-3" /> Escalate</button>
                  <button onClick={() => assign(detail.id)} className="btn-o text-xs">Assign</button>
                </>
              )}
              <button onClick={() => addNote(detail.id)} className="btn-o text-xs">Add Note</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   VENDORS
   ═══════════════════════════════════════════════════ */
function Vendors() {
  const { s } = useStore();
  const vendors = s.vendors || [];
  return (
    <div className="page-enter">
      <PageHeader title="Vendors" sub={`${vendors.length} vendors tracked`} />
      <Table
        cols={[
          { label: 'Vendor', render: r => <div className="font-semibold">{r.name}</div> },
          { label: 'Risk', render: r => <Badge c={r.riskLevel === 'high' ? 'err' : r.riskLevel === 'medium' ? 'warn' : 'ok'}>{r.riskLevel} · {Math.round(r.riskScore || 0)}</Badge> },
          { label: 'Invoices', render: r => <span className="font-mono">{r.invoiceCount || 0}</span> },
          { label: 'Total', right: true, render: r => <span className="font-semibold font-mono">{$(r.totalAmount || 0)}</span> },
          { label: 'Anomaly Rate', render: r => <span className={cn('font-mono text-sm', (r.anomalyRate || 0) > 20 ? 'text-red-600' : 'text-slate-600')}>{pct(r.anomalyRate)}</span> },
        ]}
        rows={vendors}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   CONTRACTS
   ═══════════════════════════════════════════════════ */
function Contracts() {
  const { s, d } = useStore();
  const contracts = (s.docs || []).filter(x => x.type === 'contract');
  return (
    <div className="page-enter">
      <PageHeader title="Contracts" sub={`${contracts.length} vendor contracts`}>
        <button onClick={() => d({ type: 'TAB', tab: 'upload' })} className="btn-o"><Upload className="w-4 h-4" /> Upload Contract</button>
      </PageHeader>
      <Table
        cols={[
          { label: 'Contract', render: r => <div><div className="font-semibold">{r.contractNumber || r.id}</div><div className="text-xs text-slate-400">{r.vendor}</div></div> },
          { label: 'Value', right: true, render: r => <span className="font-semibold font-mono">{$(r.amount, r.currency)}</span> },
          { label: 'Start', render: r => <span className="text-slate-500">{date(r.issueDate)}</span> },
          { label: 'End', render: r => <span className="text-slate-500">{date(r.endDate)}</span> },
          { label: 'Confidence', render: r => <ConfidenceRing score={r.confidence || 0} /> },
        ]}
        rows={contracts}
        onRow={r => d({ type: 'SEL', doc: r })}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   SETTINGS (AP POLICY)
   ═══════════════════════════════════════════════════ */
function SettingsPage() {
  const { s, toast, load } = useStore();
  const p = s.policy || {};

  async function save() {
    const u = {};
    document.querySelectorAll('[data-pk]').forEach(el => {
      const k = el.dataset.pk;
      u[k] = el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
    });
    await post('/api/policy', u); await load(); toast('Policy saved', 'success');
  }
  async function toggle(k) { await post('/api/policy', { [k]: !p[k] }); await load(); toast(`${k}: ${!p[k] ? 'ON' : 'OFF'}`, 'success'); }
  async function preset(name) { await api(`/api/policy/preset/${name}`, { method: 'POST' }); await load(); toast(`Applied ${name}`, 'success'); }

  const Row = ({ label, k, type, opts }) => {
    const v = p[k];
    if (type === 'toggle') return (
      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl mb-2">
        <span className="text-sm font-semibold">{label}</span>
        <button onClick={() => toggle(k)} className={cn('btn text-xs px-4 py-1.5 rounded-lg font-bold', v ? 'bg-accent-600 text-white' : 'bg-slate-200 text-slate-500')}>{v ? 'ON' : 'OFF'}</button>
      </div>
    );
    if (type === 'select') return (
      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl mb-2">
        <span className="text-sm font-semibold">{label}</span>
        <select data-pk={k} defaultValue={v} className="inp w-auto min-w-[200px]">{opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
      </div>
    );
    return (
      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl mb-2">
        <span className="text-sm font-semibold">{label}</span>
        <input data-pk={k} type="number" defaultValue={v || 0} step={type === 'pct' ? 0.5 : 1} className="inp w-24 text-right font-mono font-semibold" />
      </div>
    );
  };

  const history = (s.policyHistory || []).slice(0, 10);

  return (
    <div className="page-enter space-y-6">
      <PageHeader title="AP Policy Configuration" sub="Configure matching, thresholds, and triage rules">
        <button onClick={save} className="btn-p"><Check className="w-4 h-4" /> Save Policy</button>
        <button onClick={() => preset('enterprise_default')} className="btn-o"><RotateCcw className="w-4 h-4" /> Reset</button>
      </PageHeader>

      {/* Presets */}
      <div className="flex gap-2 flex-wrap">
        {['manufacturing', 'services', 'enterprise_default', 'strict_audit'].map(pr => (
          <button key={pr} onClick={() => preset(pr)} className="btn-o text-xs capitalize">{pr.replace(/_/g, ' ')}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Matching Mode</h3>
            <Row label="Matching Mode" k="matching_mode" type="select" opts={[{v:'two_way',l:'Two-Way (PO + Invoice)'},{v:'three_way',l:'Three-Way (PO + GRN + Invoice)'},{v:'flexible',l:'Flexible'}]} />
            <Row label="Require GRN for Auto-Approve" k="require_grn_for_auto_approve" type="toggle" />
            <Row label="Require PO for Auto-Approve" k="require_po_for_auto_approve" type="toggle" />
          </div>
          <div className="card p-5">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Tolerances</h3>
            <Row label="Amount Tolerance" k="amount_tolerance_pct" type="pct" />
            <Row label="Price Tolerance" k="price_tolerance_pct" type="pct" />
            <Row label="Over-Invoice Threshold" k="over_invoice_pct" type="pct" />
            <Row label="Tax Tolerance" k="tax_tolerance_pct" type="pct" />
            <Row label="GRN Qty Tolerance" k="grn_qty_tolerance_pct" type="pct" />
            <Row label="GRN Amount Tolerance" k="grn_amount_tolerance_pct" type="pct" />
            <Row label="Short Shipment Flag" k="short_shipment_threshold_pct" type="pct" />
          </div>
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Auto-Approve Thresholds</h3>
            <Row label="Min Confidence" k="auto_approve_min_confidence" type="pct" />
            <Row label="Max Vendor Risk" k="auto_approve_max_vendor_risk" type="pct" />
            <Row label="Block Above Risk" k="block_min_vendor_risk" type="pct" />
            <Row label="Duplicate Window (days)" k="duplicate_window_days" type="int" />
          </div>
          <div className="card p-5">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Invoice Controls</h3>
            <Row label="Flag Round Numbers" k="flag_round_number_invoices" type="toggle" />
            <Row label="Flag Weekend Invoices" k="flag_weekend_invoices" type="toggle" />
            <Row label="Early Payment Discount" k="early_payment_discount_flag" type="toggle" />
            <Row label="Max Invoice Age (days)" k="max_invoice_age_days" type="int" />
          </div>
          <div className="card p-5">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">SLA Targets</h3>
            <Row label="Critical (hours)" k="sla_critical_hours" type="int" />
            <Row label="High (hours)" k="sla_high_hours" type="int" />
            <Row label="Medium (hours)" k="sla_medium_hours" type="int" />
            <Row label="Low (hours)" k="sla_low_hours" type="int" />
          </div>
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="card p-5">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Change History</h3>
          <div className="space-y-2">{history.map(h => (
            <div key={h.id} className="p-3 bg-slate-50 rounded-xl border-l-3 border-accent-500">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span className="font-semibold text-slate-700">{h.action === 'policy_preset_applied' ? `Preset: ${h.preset}` : 'Policy updated'}</span>
                <span>{h.performedBy} · {dateTime(h.timestamp)}</span>
              </div>
              {h.changes && Object.keys(h.changes).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">{Object.entries(h.changes).map(([k, v]) => (
                  <span key={k} className="text-[11px] font-mono"><span className="text-slate-600 font-semibold">{k}</span> <span className="text-red-400 line-through">{String(v.old)}</span> → <span className="text-emerald-600 font-bold">{String(v.new)}</span></span>
                ))}</div>
              )}
            </div>
          ))}</div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   UPLOAD
   ═══════════════════════════════════════════════════ */
function UploadPage() {
  const { s, d, toast, load } = useStore();
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState([]);
  const [docType, setDocType] = useState('auto');
  const [showManual, setShowManual] = useState(false);
  const [procStep, setProcStep] = useState(-1);
  const fileRef = useRef();
  const importRef = useRef();

  const procSteps = ['Reading document', 'Extracting fields & line items', 'Matching to purchase orders', 'Cross-referencing contracts', 'Running anomaly detection', 'Computing confidence score'];

  async function handleFiles(files) {
    setUploading(true);
    const res = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Animate processing steps
      for (let step = 0; step < procSteps.length; step++) {
        setProcStep(step);
        await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
      }
      const fd = new FormData(); fd.append('file', file);
      if (docType !== 'auto') fd.append('document_type', docType);
      try {
        const r = await postForm('/api/upload', fd);
        res.push({ name: file.name, ok: !r?._err, ...(r?._err ? { error: r.detail } : r) });
      } catch { res.push({ name: file.name, ok: false, error: 'Upload failed' }); }
    }
    setResults(res); setUploading(false); setProcStep(-1); await load();
    const ok = res.filter(r => r.ok).length;
    if (ok) toast(`${ok} document${ok > 1 ? 's' : ''} extracted`, 'success');
  }

  async function manualSave(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { type: fd.get('type'), documentNumber: fd.get('documentNumber'), vendor: fd.get('vendor'),
      amount: parseFloat(fd.get('amount')) || 0, currency: fd.get('currency') || 'USD',
      issueDate: fd.get('issueDate') || new Date().toISOString().slice(0, 10),
      poReference: fd.get('poReference') || '', notes: fd.get('notes') || '' };
    if (!body.documentNumber || !body.vendor || !body.amount) { toast('Fill required fields', 'warning'); return; }
    const r = await post('/api/documents/manual', body);
    if (r && !r._err) { await load(); setShowManual(false); toast('Document created', 'success'); }
    else toast(r?.detail || 'Failed', 'danger');
  }

  async function exportDb() {
    const r = await api('/api/export');
    if (r) {
      const b = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(b);
      a.download = 'auditlens_backup_' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
      toast('Database exported', 'success');
    }
  }

  async function importDb() { importRef.current?.click(); }
  async function handleImport(e) {
    const file = e.target.files?.[0]; if (!file) return;
    if (!confirm('This will replace all current data. Continue?')) return;
    const fd = new FormData(); fd.append('file', file);
    const r = await api('/api/import', { method: 'POST', body: fd });
    if (r?.success) { await load(); toast(r.message || 'Imported', 'success'); }
    else toast(r?.error || 'Import failed', 'danger');
  }

  function onDrop(e) { e.preventDefault(); handleFiles(e.dataTransfer.files); }

  const types = [['auto','Auto-Detect'],['invoice','Invoice'],['purchase_order','PO'],['contract','Contract'],['goods_receipt','GRN'],['credit_note','Credit Note'],['debit_note','Debit Note']];

  return (
    <div className="page-enter space-y-6">
      <PageHeader title="Upload Document" sub="Upload invoices, POs, GRNs, contracts, or credit/debit notes">
        <button onClick={() => setShowManual(!showManual)} className="btn-o"><Edit3 className="w-4 h-4" /> Manual Entry</button>
        <button onClick={exportDb} className="btn-g text-xs">Export DB</button>
        <button onClick={importDb} className="btn-g text-xs">Import DB</button>
        <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
      </PageHeader>

      {/* Manual Entry Form */}
      {showManual && (
        <div className="card p-6 animate-slide-up">
          <form onSubmit={manualSave}>
            <div className="text-sm font-bold mb-4">✏️ Manual Document Entry</div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Document Type *</label><select name="type" className="inp"><option value="invoice">Invoice</option><option value="purchase_order">Purchase Order</option><option value="goods_receipt">Goods Receipt</option><option value="contract">Contract</option><option value="credit_note">Credit Note</option><option value="debit_note">Debit Note</option></select></div>
              <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Document Number *</label><input name="documentNumber" placeholder="e.g. INV-2024-001" className="inp" required /></div>
              <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Vendor *</label><input name="vendor" placeholder="Vendor name" className="inp" required /></div>
              <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Amount *</label><input name="amount" type="number" step="0.01" placeholder="0.00" className="inp" required /></div>
              <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Currency</label><select name="currency" className="inp"><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="INR">INR</option><option value="AED">AED</option><option value="JPY">JPY</option></select></div>
              <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Issue Date</label><input name="issueDate" type="date" className="inp" /></div>
              <div><label className="text-xs font-semibold text-slate-500 mb-1 block">PO Reference</label><input name="poReference" placeholder="PO number (if any)" className="inp" /></div>
              <div className="col-span-2"><label className="text-xs font-semibold text-slate-500 mb-1 block">Notes</label><textarea name="notes" rows="2" placeholder="Additional context" className="inp" /></div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button type="button" onClick={() => setShowManual(false)} className="btn-g text-xs">Cancel</button>
              <button type="submit" className="btn-p text-xs"><Check className="w-3 h-3" /> Save Document</button>
            </div>
          </form>
        </div>
      )}

      {/* Doc Type Selection */}
      <div className="flex gap-2 flex-wrap">{types.map(([v, l]) => (
        <button key={v} onClick={() => setDocType(v)} className={cn('btn text-xs', docType === v ? 'btn-p' : 'btn-o')}>{l}</button>
      ))}</div>

      {/* Drop Zone / Processing */}
      <div
        className="card border-2 border-dashed border-slate-300 hover:border-accent-400 transition-colors p-12 text-center cursor-pointer"
        onClick={() => !uploading && fileRef.current?.click()}
        onDragOver={e => e.preventDefault()} onDrop={onDrop}
      >
        {uploading ? (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-full border-4 border-accent-200 border-t-accent-600 animate-spin mx-auto" />
            <div className="text-sm font-semibold text-slate-600">Processing documents...</div>
            <div className="space-y-2 max-w-xs mx-auto">
              {procSteps.map((step, i) => (
                <div key={i} className={cn('flex items-center gap-2 text-xs transition-all', i < procStep ? 'text-emerald-600' : i === procStep ? 'text-accent-600 font-bold' : 'text-slate-300')}>
                  {i < procStep ? <CheckCircle2 className="w-3.5 h-3.5" /> : i === procStep ? <div className="w-3.5 h-3.5 rounded-full border-2 border-accent-200 border-t-accent-600 animate-spin" /> : <CircleDot className="w-3.5 h-3.5" />}
                  {step}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <UploadCloud className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <div className="text-lg font-bold text-slate-700 mb-2">Drop files here or click to upload</div>
            <div className="text-sm text-slate-400">PDF, JPEG, PNG — single or multiple files</div>
            <div className="flex items-center justify-center gap-2 mt-4"><Badge c="info">AI Extraction Active</Badge></div>
          </>
        )}
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="card p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider">Upload Results</h3>
            <button onClick={() => setResults([])} className="btn-g text-xs"><X className="w-3 h-3" /> Clear</button>
          </div>
          <div className="space-y-2">{results.map((r, i) => (
            <div key={i} className={cn('flex items-center gap-4 p-3 rounded-xl', r.ok ? 'bg-emerald-50' : 'bg-red-50')}>
              {r.ok ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <XCircle className="w-5 h-5 text-red-600" />}
              <div className="flex-1"><div className="text-sm font-semibold">{r.name}</div>{!r.ok && <div className="text-xs text-red-500">{r.error}</div>}</div>
              {r.ok && <Badge c={docColor(r.type)}>{docLabel(r.type)}</Badge>}
              {r.ok && <span className="font-mono text-sm">{pct(r.confidence)}</span>}
            </div>
          ))}</div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MODEL TRAINING (stub)
   ═══════════════════════════════════════════════════ */
function Training() {
  const { s, toast } = useStore();
  const [ft, setFt] = useState(null);
  const [preview, setPreview] = useState(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);

  async function refresh() { const r = await api('/api/together/status'); if (r && !r._err) setFt(r); }
  useEffect(() => { refresh(); return () => clearInterval(pollRef.current); }, []);

  async function startFinetune() {
    if (!confirm('Start fine-tuning? This uses your Together.ai credits.')) return;
    const r = await post('/api/together/finetune', {});
    if (r?.success) { toast('Fine-tuning started', 'success'); refresh(); startPolling(r.job_id); }
    else toast(r?.detail || 'Failed to start', 'danger');
  }

  function startPolling(jobId) {
    setPolling(true);
    pollRef.current = setInterval(async () => {
      const r = await api('/api/together/job/' + (jobId || ft?.active_job?.job_id));
      if (r && !r._err) {
        setFt(prev => ({ ...prev, active_job: r }));
        if (r.status === 'completed' || r.status === 'failed') {
          clearInterval(pollRef.current); setPolling(false); refresh();
          toast(r.status === 'completed' ? 'Fine-tuning complete!' : 'Fine-tuning failed', r.status === 'completed' ? 'success' : 'danger');
        }
      }
    }, 5000);
  }

  async function deactivate() {
    if (!confirm('Deactivate custom model? Will revert to default.')) return;
    await api('/api/together/deactivate', { method: 'POST' }); toast('Model deactivated', 'warning'); refresh();
  }

  async function loadPreview() { const r = await api('/api/together/training-data/preview'); if (r && !r._err) setPreview(r); else toast('Preview failed', 'danger'); }

  const cfg = ft?.configured; const corr = ft?.corrections_available || 0; const req = ft?.corrections_required || 50;
  const job = ft?.active_job; const hasModel = !!ft?.active_custom_model;
  const canTrain = cfg && corr >= req && (!job || job.status === 'completed' || job.status === 'failed');

  return (
    <div className="page-enter space-y-6">
      <PageHeader title="Model Training" sub="Fine-tune extraction model on your correction data">
        <button onClick={refresh} className="btn-o"><RefreshCw className="w-4 h-4" /> Refresh</button>
      </PageHeader>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Settings} label="Together.ai" value={cfg ? '✓ Configured' : '✗ Not Set'} color={cfg ? '#10b981' : '#ef4444'} />
        <StatCard icon={Database} label="Corrections" value={`${corr}/${req}`} sub={corr >= req ? 'Ready to train' : `Need ${req - corr} more`} color={corr >= req ? '#10b981' : '#f59e0b'} />
        <StatCard icon={Brain} label="Custom Model" value={hasModel ? '🤖 Active' : '— None'} sub={ft?.active_custom_model || ''} color={hasModel ? '#8b5cf6' : '#94a3b8'} />
        <StatCard icon={Zap} label="Job Status" value={job ? (job.status || 'idle').replace(/_/g, ' ') : 'Idle'} color={job?.status === 'completed' ? '#10b981' : job?.status === 'running' ? '#3b82f6' : '#94a3b8'} />
      </div>

      {/* Progress */}
      <div className="card p-6">
        <h3 className="text-sm font-bold mb-3">Training Readiness</h3>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-accent-600 rounded-full transition-all" style={{ width: Math.min(100, (corr / req) * 100) + '%' }} /></div>
        <div className="flex justify-between text-xs text-slate-500 mt-2">
          <span>{corr} corrections collected</span>
          <span>{req} minimum needed</span>
        </div>
      </div>

      {/* Active Job */}
      {job && (
        <div className={cn('card p-6 border-l-4', job.status === 'completed' ? 'border-emerald-500' : job.status === 'failed' ? 'border-red-500' : 'border-blue-500')}>
          <h3 className="text-sm font-bold mb-2">Active Job: {job.job_id}</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><span className="text-slate-400">Status:</span> <span className="font-semibold capitalize">{job.status}</span></div>
            <div><span className="text-slate-400">Model:</span> <span className="font-mono text-xs">{job.model || '—'}</span></div>
            <div><span className="text-slate-400">Events:</span> <span>{job.events?.length || 0}</span></div>
          </div>
          {polling && <div className="mt-3 text-xs text-accent-600 flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 border-accent-200 border-t-accent-600 animate-spin" /> Polling every 5s...</div>}
          {!polling && (job.status === 'running' || job.status === 'pending') && (
            <button onClick={() => startPolling(job.job_id)} className="btn-o text-xs mt-3"><RefreshCw className="w-3 h-3" /> Resume Polling</button>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <button onClick={startFinetune} disabled={!canTrain} className="btn-p"><Brain className="w-4 h-4" /> Start Fine-Tuning</button>
        <button onClick={loadPreview} className="btn-o"><Eye className="w-4 h-4" /> Preview Training Data</button>
        {hasModel && <button onClick={deactivate} className="btn-d text-sm"><X className="w-4 h-4" /> Deactivate Model</button>}
      </div>

      {/* Preview */}
      {preview && (
        <div className="card p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold">Training Data Preview ({preview.total_examples || preview.length || 0} examples)</h3>
            <button onClick={() => setPreview(null)} className="btn-g text-xs"><X className="w-3 h-3" /> Close</button>
          </div>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {(preview.examples || preview.sample || []).slice(0, 10).map((ex, i) => (
              <div key={i} className="p-3 bg-slate-50 rounded-xl text-xs font-mono overflow-hidden">
                <pre className="whitespace-pre-wrap">{typeof ex === 'string' ? ex : JSON.stringify(ex, null, 2).slice(0, 300)}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   DOCUMENT MODAL
   ═══════════════════════════════════════════════════ */
function DocModal() {
  const { s, d, toast, load } = useStore();
  const doc = s.sel; if (!doc) return null;
  const cur = doc.currency || 'USD';
  const anoms = (s.anomalies || []).filter(a => a.invoiceId === doc.id && a.status === 'open');
  const hasFile = !!doc.uploadedFile;
  const fileUrl = hasFile ? `/api/uploads/${encodeURIComponent(doc.uploadedFile)}` : '';
  const isPdf = hasFile && doc.uploadedFile.toLowerCase().endsWith('.pdf');
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({});
  const [view, setView] = useState(hasFile ? 'split' : 'data');

  async function setStatus(st) { await post(`/api/invoices/${doc.id}/status`, { status: st }); await load(); toast(`Status: ${st}`, 'success'); d({ type: 'SEL', doc: null }); }
  async function markPaid() { await api(`/api/invoices/${doc.id}/mark-paid`, { method: 'POST' }); await load(); toast('Marked paid', 'success'); d({ type: 'SEL', doc: null }); }
  async function overrideTriage(lane) { const fd = new FormData(); fd.append('lane', lane); fd.append('reason', 'Manual override'); await postForm(`/api/invoices/${doc.id}/override-triage`, fd); await load(); toast(`Triage → ${lane}`, 'success'); d({ type: 'SEL', doc: null }); }
  async function saveEdits() {
    const updates = { ...fields };
    // Collect line item edits
    const lis = (doc.lineItems || []).map((li, i) => ({
      ...li,
      description: fields[`li_${i}_desc`] ?? li.description,
      quantity: parseFloat(fields[`li_${i}_qty`]) || li.quantity,
      unitPrice: parseFloat(fields[`li_${i}_price`]) || li.unitPrice,
    }));
    const payload = {};
    ['vendor', 'subtotal', 'issueDate', 'dueDate', 'deliveryDate', 'paymentTerms', 'currency', 'poReference'].forEach(k => {
      if (fields[k] !== undefined) payload[k] = fields[k];
    });
    payload.lineItems = lis;
    await post(`/api/documents/${doc.id}/edit-fields`, payload);
    await load(); setEditing(false); setFields({}); toast('Document updated', 'success');
  }

  const Field = ({ label, val, k, type = 'text' }) => {
    if (editing && k) return (
      <div>
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">{label}</div>
        <input type={type} defaultValue={val || ''} onChange={e => setFields(f => ({ ...f, [k]: e.target.value }))}
          className="inp text-sm py-1.5 border-accent-300 bg-accent-50/30" />
      </div>
    );
    return (
      <div><div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">{label}</div><div className="text-sm font-semibold text-slate-800">{val || '—'}</div></div>
    );
  };

  const ens = doc.ensembleData;
  const fc = doc.confidenceFactors;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => { d({ type: 'SEL', doc: null }); setEditing(false); setFields({}); }}>
      <div className={cn('card w-full max-h-[90vh] overflow-hidden flex flex-col', hasFile && view === 'split' ? 'max-w-[1100px]' : 'max-w-[680px]')} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge c={docColor(doc.type)}>{docLabel(doc.type)}</Badge>
            <span className="text-lg font-bold">{doc.invoiceNumber || doc.poNumber || doc.contractNumber || doc.id}</span>
            {doc.triageLane && <Badge c={laneColor(doc.triageLane)}>{laneLabel(doc.triageLane)}</Badge>}
            {doc.manuallyVerified && <Badge c="ok">✓ Verified</Badge>}
            {hasFile && (
              <div className="flex gap-1 ml-2">
                <button onClick={() => setView('split')} className={cn('text-xs px-2 py-1 rounded-lg', view === 'split' ? 'bg-accent-100 text-accent-700' : 'text-slate-400 hover:bg-slate-100')}>🔍 Verify</button>
                <button onClick={() => setView('data')} className={cn('text-xs px-2 py-1 rounded-lg', view === 'data' ? 'bg-accent-100 text-accent-700' : 'text-slate-400 hover:bg-slate-100')}>📋 Data</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button onClick={saveEdits} className="btn-p text-xs"><Check className="w-3 h-3" /> Save</button>
                <button onClick={() => { setEditing(false); setFields({}); }} className="btn-g text-xs"><X className="w-3 h-3" /> Cancel</button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="btn-o text-xs"><Edit3 className="w-3 h-3" /> Edit</button>
            )}
            <button onClick={() => { d({ type: 'SEL', doc: null }); setEditing(false); }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
          </div>
        </div>
        {editing && <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 text-xs text-accent-700 font-medium">✏️ Edit mode — modify fields and save to re-run anomaly detection</div>}

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {hasFile && view === 'split' && (
            <div className="w-1/2 border-r border-slate-100 flex flex-col">
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Original</span>
                <a href={fileUrl} target="_blank" rel="noreferrer" className="text-xs text-accent-600 hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Open</a>
              </div>
              <div className="flex-1 overflow-auto bg-slate-50">
                {isPdf ? <iframe src={fileUrl} className="w-full h-full border-none min-h-[500px]" title="Document" /> : <img src={fileUrl} className="w-full h-auto" alt="Document" />}
              </div>
            </div>
          )}
          <div className={cn('overflow-y-auto p-6 space-y-5', hasFile && view === 'split' ? 'w-1/2' : 'w-full')}>
            {view === 'split' && <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Extracted Data — {pct(doc.confidence)} confidence</div>}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Vendor" val={doc.vendor} k="vendor" />
              <Field label="Amount" val={$f(doc.amount, cur)} />
              <Field label="Subtotal" val={$f(doc.subtotal, cur)} k="subtotal" type="number" />
              <Field label="Tax" val={doc.totalTax ? `${$f(doc.totalTax, cur)} (${(doc.taxDetails || []).map(t => t.type + ' ' + t.rate + '%').join(', ')})` : '—'} />
              <Field label="Issued" val={date(doc.issueDate)} k="issueDate" type="date" />
              <Field label={doc.type === 'invoice' ? 'Due' : 'Delivery'} val={date(doc.dueDate || doc.deliveryDate)} k={doc.type === 'invoice' ? 'dueDate' : 'deliveryDate'} type="date" />
              <Field label="Confidence" val={pct(doc.confidence)} />
              <Field label="Status" val={(doc.status || '').replace(/_/g, ' ').toUpperCase()} />
              <Field label="PO Reference" val={doc.poReference} k="poReference" />
              <Field label="Terms" val={doc.paymentTerms} k="paymentTerms" />
              <Field label="Uploaded By" val={doc.uploadedBy} />
              <Field label="Uploaded At" val={dateTime(doc.extractedAt)} />
            </div>

            {/* Confidence Breakdown */}
            {fc && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="text-[10px] font-bold text-slate-900 uppercase tracking-wider mb-2">Confidence Breakdown</div>
                {Object.entries(fc).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between py-1 text-xs border-b border-slate-100 last:border-0">
                    <span className="text-slate-600">{k.replace(/_/g, ' ')} <span className="text-slate-400">({pct(v.weight * 100)})</span></span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: v.score + '%', background: v.score >= 80 ? '#10b981' : v.score >= 50 ? '#f59e0b' : '#ef4444' }} /></div>
                      <span className="font-mono font-bold w-6 text-right" style={{ color: v.score >= 80 ? '#10b981' : v.score >= 50 ? '#f59e0b' : '#ef4444' }}>{v.score}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Ensemble Data */}
            {ens && ens.fields_agreed != null && (
              <div className={cn('p-3 rounded-xl border', ens.ensemble_confidence === 'high' ? 'bg-emerald-50 border-emerald-200' : ens.ensemble_confidence === 'medium' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200')}>
                <div className="text-[10px] font-bold text-slate-900 uppercase tracking-wider mb-2">🤝 Ensemble Verification</div>
                <div className="grid grid-cols-3 gap-3 mb-2 text-center">
                  <div><div className="text-lg font-bold text-emerald-600">{ens.fields_agreed || 0}</div><div className="text-[10px] text-slate-400">Agreed</div></div>
                  <div><div className="text-lg font-bold" style={{ color: (ens.fields_disputed || 0) > 0 ? '#ef4444' : '#10b981' }}>{ens.fields_disputed || 0}</div><div className="text-[10px] text-slate-400">Disputed</div></div>
                  <div><div className="text-lg font-bold" style={{ color: (ens.agreement_rate || 0) >= 90 ? '#10b981' : '#f59e0b' }}>{pct(ens.agreement_rate)}</div><div className="text-[10px] text-slate-400">Agreement</div></div>
                </div>
                {ens.resolution_applied && <div className="text-xs text-accent-700">✔ Disputes auto-resolved ({ens.fields_resolved?.join(', ')})</div>}
                <div className="text-[10px] text-slate-400 mt-1">Models: {ens.models_used?.map(m => m.split('-').slice(0, 2).join(' ')).join(' + ') || 'N/A'} · {ens.total_latency_ms || 0}ms</div>
              </div>
            )}

            {/* Early payment */}
            {doc.earlyPaymentDiscount && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-medium">
                💰 Early payment: {doc.earlyPaymentDiscount.discount_percent}% off within {doc.earlyPaymentDiscount.days} days (save {$f((doc.subtotal || doc.amount) * (doc.earlyPaymentDiscount.discount_percent / 100), cur)})
              </div>
            )}

            {/* Triage */}
            {doc.triageLane && doc.triageReasons && (
              <div className={cn('p-3 rounded-xl border', doc.triageLane === 'AUTO_APPROVE' ? 'bg-emerald-50 border-emerald-200' : doc.triageLane === 'BLOCK' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200')}>
                <div className="flex items-center gap-2 mb-1"><Badge c={laneColor(doc.triageLane)}>{laneLabel(doc.triageLane)}</Badge><span className="text-xs text-slate-400">{pct(doc.triageConfidence)} confidence</span></div>
                {doc.triageReasons.map((r, i) => <div key={i} className="text-sm text-slate-600 mt-0.5">• {r}</div>)}
                {!editing && doc.type === 'invoice' && (
                  <div className="flex gap-1 mt-2">{['AUTO_APPROVE', 'REVIEW', 'BLOCK'].filter(l => l !== doc.triageLane).map(l => (
                    <button key={l} onClick={() => overrideTriage(l)} className="btn-g text-[10px] px-2 py-1">{laneLabel(l)}</button>
                  ))}</div>
                )}
              </div>
            )}

            {/* Anomalies */}
            {anoms.length > 0 && (
              <div>
                <div className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-2">⚠ {anoms.length} Anomalies</div>
                {anoms.map(a => (
                  <div key={a.id} className="p-3 bg-red-50 border border-red-200 rounded-xl mb-2">
                    <div className="flex justify-between mb-1"><Badge c="err">{a.severity} · {(a.type || '').replace(/_/g, ' ')}</Badge><span className="font-mono font-bold text-red-600">{$(Math.abs(a.amount_at_risk || 0))}</span></div>
                    <div className="text-sm text-slate-600">{a.description}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Line Items */}
            <div>
              <div className="text-[10px] font-bold text-slate-900 uppercase tracking-wider mb-2">Line Items {editing && <span className="text-accent-600 font-normal">(click values to edit)</span>}</div>
              <div className="rounded-xl overflow-hidden border border-slate-100">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50"><th className="px-3 py-2 text-left text-[10px] text-slate-400 uppercase">Item</th><th className="px-3 py-2 text-right text-[10px] text-slate-400 uppercase">Qty</th><th className="px-3 py-2 text-right text-[10px] text-slate-400 uppercase">Price</th><th className="px-3 py-2 text-right text-[10px] text-slate-400 uppercase">Total</th></tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {(doc.lineItems || []).map((li, i) => {
                      const q = fields[`li_${i}_qty`] ?? li.quantity;
                      const pr = fields[`li_${i}_price`] ?? li.unitPrice;
                      const tot = (parseFloat(q) || 0) * (parseFloat(pr) || 0);
                      if (!editing) return (
                        <tr key={i}><td className="px-3 py-2">{li.description}</td><td className="px-3 py-2 text-right font-mono">{li.quantity}</td><td className="px-3 py-2 text-right font-mono">{$f(li.unitPrice, cur)}</td><td className="px-3 py-2 text-right font-mono font-semibold">{$f(li.total || li.quantity * li.unitPrice, cur)}</td></tr>
                      );
                      return (
                        <tr key={i}>
                          <td className="px-3 py-2"><input defaultValue={li.description} onChange={e => setFields(f => ({ ...f, [`li_${i}_desc`]: e.target.value }))} className="inp text-xs py-1" /></td>
                          <td className="px-2 py-2"><input type="number" defaultValue={q} onChange={e => setFields(f => ({ ...f, [`li_${i}_qty`]: e.target.value }))} className="inp text-xs py-1 w-16 text-right font-mono" /></td>
                          <td className="px-2 py-2"><input type="number" step="any" defaultValue={pr} onChange={e => setFields(f => ({ ...f, [`li_${i}_price`]: e.target.value }))} className="inp text-xs py-1 w-20 text-right font-mono" /></td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">{$f(tot, cur)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tax breakdown */}
            {doc.taxDetails?.length > 0 && (
              <div className="p-3 bg-slate-50 rounded-xl">
                {doc.taxDetails.map((t, i) => <div key={i} className="flex justify-between text-sm text-slate-600"><span>{t.type} @ {t.rate}%</span><span className="font-mono">{$f(t.amount, cur)}</span></div>)}
                <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-slate-200"><span>Total</span><span className="font-mono">{$f(doc.amount, cur)}</span></div>
              </div>
            )}

            {/* Actions */}
            {!editing && doc.type === 'invoice' && (
              <div className="flex gap-2 flex-wrap pt-2">
                {doc.status !== 'paid' && <button onClick={markPaid} className="btn bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs"><Check className="w-3 h-3" /> Mark Paid</button>}
                {doc.status === 'unpaid' && <button onClick={() => setStatus('under_review')} className="btn-o text-xs">Under Review</button>}
                {(doc.status === 'under_review' || doc.status === 'on_hold') && <button onClick={() => setStatus('approved')} className="btn bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs"><Check className="w-3 h-3" /> Approve</button>}
                {doc.status !== 'disputed' && doc.status !== 'paid' && <button onClick={() => setStatus('disputed')} className="btn bg-red-50 text-red-700 hover:bg-red-100 text-xs"><AlertCircle className="w-3 h-3" /> Dispute</button>}
                {doc.status === 'disputed' && <button onClick={() => setStatus('unpaid')} className="btn-o text-xs">Re-open</button>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   LOGIN SCREEN
   ═══════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════
   LANDING PAGE
   ═══════════════════════════════════════════════════ */
function LandingPage({ onGo }) {
  const { s } = useStore();
  const ps = s.ps || {};
  const rc = ps.rc || 17, lc = ps.lc || 10, ml = ps.ml || '';
  const authTiers = ps.auth || [];
  const sla = ps.sla || {};
  const ver = ps.v || '';
  const ruleNames = (ps.rules || []).map(r => r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace('Po', 'PO').replace('Grn', 'GRN').replace('Qty', 'QTY'));
  const oppNames = (ps.opp || []).map(r => r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

  const features = [
    { icon: Zap, title: 'Ensemble Extraction', desc: 'Two frontier models extract in parallel. Consensus engine merges with field-level confidence scoring. A third custom model joins after fine-tuning.', tag: 'AI', color: '#4f46e5' },
    { icon: Brain, title: 'Agentic Dispute Resolution', desc: 'When models disagree on critical fields, a third AI call re-examines the document with vendor context and PO data to break the tie.', tag: 'AI', color: '#4f46e5' },
    { icon: Shield, title: 'RAG Anomaly Detection', desc: `${rc} rule-based checks plus an AI auditor that cross-references past anomalies, corrections, and contract clauses from a vector store.`, tag: 'AI + RULES', color: '#d97706' },
    { icon: Link2, title: '3-Way + Smart Matching', desc: 'Deterministic PO-GRN-Invoice matching. For unmatched invoices, AI reasons across all POs by vendor, amount, line items, and dates.', tag: 'ALGORITHMIC + AI', color: '#059669' },
    { icon: FileText, title: 'Investigation Briefs', desc: 'Auto-generated case narratives citing exact dollar amounts, contract clauses, and vendor history. Every fact traced to source data.', tag: 'AI', color: '#4f46e5' },
    { icon: CheckCircle2, title: 'Plain English Anomalies', desc: 'Translates technical flags into one-sentence explanations a finance manager can act on, with post-validated amounts.', tag: 'AI', color: '#4f46e5' },
    { icon: Building2, title: 'Vendor Communication Drafts', desc: 'AI drafts dispute letters referencing your specific contract terms, PO prices, and dollar amounts. You review before sending.', tag: 'AI · HUMAN CONFIRMS', color: '#0369a1' },
    { icon: TrendingUp, title: 'Payment Prioritization', desc: 'Optimizes weekly payment runs: capture early payment discounts, hold disputed invoices, respect cash flow constraints.', tag: 'AI', color: '#4f46e5' },
    { icon: Eye, title: 'Anomaly Pattern Insights', desc: 'Identifies recurring vendor issues from statistical analysis. Only surfaces patterns meeting significance thresholds.', tag: 'AI + STATS', color: '#d97706' },
    { icon: ClipboardList, title: 'Smart Case Routing', desc: 'Algorithm scores team members by expertise, workload, and authority. AI explains the recommendation. You approve the assignment.', tag: 'ALGORITHMIC + AI', color: '#059669' },
    { icon: Settings, title: 'Natural Language Policy', desc: 'Configure AP rules in plain English. AI translates to parameters. You preview every change before applying.', tag: 'AI · HUMAN CONFIRMS', color: '#0369a1' },
    { icon: Brain, title: 'Custom Model Fine-Tuning', desc: 'Your corrections train LoRA adapters on vendor-specific layouts. Gets faster, cheaper, and more accurate over time.', tag: 'AI + LoRA', color: '#6d28d9' },
  ];

  const pipeline = [
    { n: '1', t: 'Fact Injection', d: 'All data from your invoices, POs, and contracts as structured JSON' },
    { n: '2', t: 'Constrained Generation', d: 'Scoped prompts with explicit anti-fabrication instructions' },
    { n: '3', t: 'Post-Validation', d: 'Every dollar amount and reference checked against source records' },
    { n: '4', t: 'Deterministic Fallback', d: 'Template-based output if AI fails — users never see errors' },
  ];

  const apStats = [
    { label: 'Manual Review', val: '2–3', unit: 'invoices/hr', sub: 'Per analyst', color: '#ef4444', bg: 'rgba(239,68,68,.1)' },
    { label: 'AuditLens', val: '450+', unit: 'invoices/hr', sub: 'Fully automated', color: '#22c55e', bg: 'rgba(34,197,94,.1)' },
    { label: 'Exception Rate', val: '5–15%', unit: 'flagged', sub: 'Only true anomalies', color: '#60a5fa', bg: 'rgba(96,165,250,.1)' },
    { label: 'Coverage', val: '100%', unit: 'of invoices', sub: 'Zero sampling gaps', color: '#a78bfa', bg: 'rgba(167,139,250,.1)' },
  ];

  const deployOptions = [
    { title: 'Managed Cloud', desc: 'Anthropic API with Zero Data Retention. Fastest setup — add API key and go. Your data is never used for training.', tag: 'DEFAULT', color: '#1a56db', border: '#bfdbfe', bg: 'linear-gradient(135deg,#fafafe,#eff6ff)', checks: ['Zero Data Retention', 'Frontier model accuracy', '5-minute setup', 'SOC 2 Type II compliant'], prov: 'Anthropic Claude API' },
    { title: 'Private Cloud (VPC)', desc: 'Claude runs inside your AWS or Google Cloud account. Financial data never leaves your VPC boundary.', tag: 'ENTERPRISE', color: '#059669', border: '#bbf7d0', bg: 'linear-gradient(135deg,#fafffe,#f0fdf4)', checks: ['Data stays in your VPC', 'Choose your AWS/GCP region', 'Frontier model accuracy', 'HIPAA / GDPR compatible'], prov: 'AWS Bedrock · Google Vertex AI' },
    { title: 'On-Premise / Air-Gapped', desc: 'Run open-weight models on your own hardware. Fully air-gapped — zero network calls to external services.', tag: 'AIR-GAPPED', color: '#6d28d9', border: '#e9d5ff', bg: 'linear-gradient(135deg,#fdfaff,#faf5ff)', checks: ['Zero data leaves your network', 'Your hardware, your models', 'Fine-tune on your invoices', 'Defense / regulated sectors'], prov: 'vLLM · Ollama · TGI · Together' },
  ];

  const defaultAuth = [
    { r: 'AP Analyst', l: 'Configurable' },
    { r: 'AP Manager', l: 'Configurable' },
    { r: 'VP Finance', l: 'Configurable' },
    { r: 'CFO', l: 'Unlimited' },
  ];
  const authColors = ['#166534', '#15803d', '#ca8a04', '#dc2626'];

  const langs = [['EN','#64748b'],['CN','#ef4444'],['JP','#f97316'],['KR','#3b82f6'],['HI','#eab308'],['DE','#22c55e'],['FR','#6366f1'],['ES','#a855f7'],['PT','#14b8a6'],['AR','#8b5cf6']];
  const taxSystems = ['VAT','GST','MwSt','TVA','IVA','增值税','消費税','ICMS'];
  const trustBadges = ['RBAC', 'JWT Auth', 'SOX-Ready', 'Audit Trail', 'SLA Tracking', `${rc} Rules`];

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-extrabold tracking-tight">AuditLens</span>
          </div>
          <div className="flex gap-3">
            <button onClick={onGo} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Sign In</button>
            <button onClick={onGo} className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg hover:shadow-lg hover:shadow-blue-500/25 transition-all">Get Started →</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold mb-6">
            <Zap className="w-3.5 h-3.5" /> AI-Powered AP Automation
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.1] mb-6">
            Audit every invoice<br /><span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">before you pay.</span>
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto mb-10 leading-relaxed">
            AuditLens audits every invoice against your POs, contracts, and vendor history — automatically. AI extracts, matches, and flags anomalies in under 8 seconds. Your team investigates only what matters.
          </p>
          <div className="flex gap-4 justify-center">
            <button onClick={onGo} className="px-8 py-3.5 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl hover:shadow-xl hover:shadow-blue-500/25 transition-all">Start Auditing →</button>
            <button className="px-8 py-3.5 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">Talk to Sales</button>
          </div>
          {ml && <p className="text-xs text-slate-400 mt-6">Powered by {ml}</p>}
        </div>
      </section>

      {/* Pipeline */}
      <section className="py-16 bg-slate-50 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <div className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">LIVE DEMO</div>
            <h2 className="text-3xl font-extrabold tracking-tight">⚡ How AuditLens Processes Every Invoice</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {pipeline.map(s => (
              <div key={s.n} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold mb-4">{s.n}</div>
                <h3 className="text-sm font-bold text-slate-900 mb-2">{s.t}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The AP Problem */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-3xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a, #1e293b)' }}>
            <div className="p-10">
              <div className="text-xs font-bold text-red-400 uppercase tracking-widest mb-3">The AP Problem</div>
              <h2 className="text-2xl font-extrabold text-white mb-4">AP teams lose 1–3% of spend to undetected overcharges, duplicates, and contract violations.</h2>
              <p className="text-sm text-slate-400 leading-relaxed mb-8">Manual review catches a fraction. Sampling audits miss systematic issues. By the time errors surface, the money is gone. AuditLens checks every invoice, every line item, every time — before payment.</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {apStats.map(s => (
                  <div key={s.label} className="rounded-xl p-4 text-center" style={{ background: s.bg, border: `1px solid ${s.color}20` }}>
                    <div className="text-2xl font-extrabold font-mono" style={{ color: s.color }}>{s.val}</div>
                    <div className="text-[11px] text-slate-400 font-semibold mt-1">{s.unit}</div>
                    <div className="text-[10px] text-slate-500 mt-1">{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AI Intelligence Layer */}
      <section className="py-16 bg-slate-50 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold tracking-tight">AI Intelligence Layer</h2>
            <p className="text-slate-500 mt-2 max-w-xl mx-auto">AI where it matters. Rules where you need control. Every AI output is grounded in your actual invoices, POs, and contracts.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => (
              <div key={f.title} className="bg-white rounded-2xl p-6 border border-slate-100 hover:shadow-lg hover:shadow-slate-200/50 transition-all">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: f.color + '12' }}>
                    <f.icon className="w-4 h-4" style={{ color: f.color }} />
                  </div>
                  <span className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ color: f.color, background: f.color + '12', letterSpacing: '.05em' }}>{f.tag}</span>
                </div>
                <h3 className="text-sm font-bold text-slate-900 mb-1.5">{f.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Enterprise Trust */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold tracking-tight">Enterprise-Grade Trust</h2>
            <p className="text-slate-500 mt-2">Every number verified. Every decision auditable.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Grounded AI */}
            <div className="bg-gradient-to-br from-slate-50 to-violet-50 rounded-2xl p-7 border border-violet-100">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center"><Shield className="w-4 h-4 text-indigo-600" /></div>
                <h3 className="text-base font-bold">Grounded AI Architecture</h3>
              </div>
              <p className="text-[13px] text-slate-500 leading-relaxed mb-5">Every AI output passes through a 4-stage verification pipeline. Claude reasons over your data — the system verifies every claim before it reaches your team.</p>
              <div className="space-y-2">
                {pipeline.map(x => (
                  <div key={x.n} className="flex gap-3 items-start p-2.5 bg-white rounded-lg border border-violet-100">
                    <div className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">{x.n}</div>
                    <div><div className="text-xs font-bold text-slate-900">{x.t}</div><div className="text-[11px] text-slate-500">{x.d}</div></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              {/* Delegation of Authority */}
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-7 border border-emerald-200">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center"><Shield className="w-4 h-4 text-emerald-600" /></div>
                  <h3 className="text-base font-bold">Delegation of Authority</h3>
                </div>
                <div className="space-y-2">
                  {(authTiers.length ? authTiers : defaultAuth).map((a, i) => (
                    <div key={i} className="flex justify-between items-center p-2.5 bg-white rounded-lg border border-emerald-100">
                      <span className="text-xs font-semibold" style={{ color: authColors[i] || '#64748b' }}>{a.tier || a.r}</span>
                      <span className="text-xs text-slate-500 font-mono">{a.limit || a.l}</span>
                    </div>
                  ))}
                </div>
                {Object.keys(sla).length > 0 && (
                  <div className="mt-4 pt-4 border-t border-emerald-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">SLA Targets</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(sla).map(([k, v]) => (
                        <span key={k} className="text-[11px] px-2 py-1 rounded bg-white border border-emerald-100 text-slate-600">{k.replace(/_/g, ' ')}: <strong>{v}</strong></span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* What We Catch */}
              <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-2xl p-7 border border-red-100">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-red-500" /></div>
                  <h3 className="text-base font-bold">What We Catch</h3>
                </div>
                <p className="text-[12.5px] text-slate-500 leading-relaxed mb-4">{rc} detection rules covering overcharges, duplicate invoices, quantity mismatches, unauthorized line items, contract rate violations, stale invoices, tax anomalies, short shipments, and more.</p>
                {ruleNames.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {ruleNames.map(r => (
                      <span key={r} className="text-[9.5px] px-2 py-0.5 rounded bg-white border border-red-100 text-red-700 font-medium">{r}</span>
                    ))}
                  </div>
                )}
                {oppNames.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {oppNames.map(r => (
                      <span key={r} className="text-[9.5px] px-2 py-0.5 rounded bg-white border border-amber-200 text-amber-700 font-medium">💡 {r}</span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {trustBadges.map(t => (
                    <span key={t} className="text-[9.5px] px-2 py-0.5 rounded bg-white border border-blue-200 text-blue-700 font-semibold">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Global Ready */}
      <section className="py-16 px-6" style={{ background: 'linear-gradient(135deg, #0f172a, #1e293b)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <div className="flex items-center gap-2 mb-3"><CircleDot className="w-4 h-4 text-blue-400" /><span className="text-xs font-bold uppercase tracking-widest text-blue-400">Global Ready</span></div>
              <h2 className="text-2xl font-extrabold text-white mb-4">Process invoices in {lc} languages</h2>
              <p className="text-sm text-slate-400 leading-relaxed mb-5">Auto-detect document language, normalize regional number and date formats, and validate against local tax systems.</p>
              <div className="flex flex-wrap gap-2">
                {taxSystems.map(t => (
                  <span key={t} className="px-3 py-1 rounded-lg text-[11px] font-semibold text-blue-300" style={{ background: 'rgba(96,165,250,.1)', border: '1px solid rgba(96,165,250,.2)' }}>{t}</span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {langs.map(([code, clr]) => (
                <div key={code} className="rounded-lg p-3 text-center" style={{ background: clr + '15', border: `1px solid ${clr}30` }}>
                  <div className="text-sm font-bold" style={{ color: clr }}>{code}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Deploy Anywhere */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold tracking-tight">Deploy Anywhere</h2>
            <p className="text-slate-500 mt-2 max-w-xl mx-auto">Your data. Your infrastructure. Your rules. AuditLens is model-agnostic by design. Choose the deployment that matches your security posture.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
            {deployOptions.map(f => (
              <div key={f.title} className="rounded-2xl p-6 relative" style={{ background: f.bg, border: `1px solid ${f.border}` }}>
                <div className="absolute top-4 right-4 px-2.5 py-1 rounded-md text-white text-[9.5px] font-bold tracking-wider" style={{ background: f.color }}>{f.tag}</div>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-5" style={{ background: f.color + '12' }}>
                  <Database className="w-5 h-5" style={{ color: f.color }} />
                </div>
                <h3 className="text-base font-extrabold text-slate-900 mb-2">{f.title}</h3>
                <p className="text-[12.5px] text-slate-500 leading-relaxed mb-5">{f.desc}</p>
                <div className="space-y-2 mb-5">
                  {f.checks.map(c => (
                    <div key={c} className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="font-bold" style={{ color: f.color }}>✓</span> {c}
                    </div>
                  ))}
                </div>
                <div className="pt-4 border-t" style={{ borderColor: f.border }}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Provider</div>
                  <div className="text-xs font-semibold text-slate-700">{f.prov}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Config snippet */}
          <div className="max-w-lg mx-auto text-center">
            <p className="text-sm font-bold text-slate-900 mb-3">One Config Change. Zero Code Changes.</p>
            <div className="bg-slate-900 rounded-xl p-4 text-left font-mono text-sm">
              <span className="text-emerald-400">LLM_PROVIDER</span><span className="text-slate-400">=</span><span className="text-amber-300">bedrock</span>
            </div>
            <p className="text-xs text-slate-400 mt-3">and your region. Same extraction, same anomaly detection, same audit trail.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 bg-slate-50">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold tracking-tight mb-4">See what your AP team is missing.</h2>
          <p className="text-slate-500 mb-8">Upload your first invoice and AuditLens will extract, match, and audit it in under 8 seconds.</p>
          <button onClick={onGo} className="px-10 py-4 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl hover:shadow-xl hover:shadow-blue-500/25 transition-all">Start Free →</button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-slate-100">
        <div className="max-w-6xl mx-auto flex justify-between items-center text-xs text-slate-400">
          <span>© 2026 AuditLens{ver ? ` · v${ver}` : ''}</span>
          <span>Enterprise AP Automation · SOX-Ready</span>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   LOGIN / REGISTER
   ═══════════════════════════════════════════════════ */
function LoginScreen() {
  const { login, register } = useStore();
  const [mode, setMode] = useState('login');
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault(); setLoading(true); setErr(null);
    const fd = new FormData(e.target);
    let result;
    if (mode === 'login') result = await login(fd.get('email'), fd.get('password'));
    else result = await register(fd.get('email'), fd.get('password'), fd.get('name'), fd.get('role'));
    if (result) setErr(result);
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex">
      <div className="flex-1 flex flex-col justify-center px-12 max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center shadow-lg shadow-red-200/50"><Shield className="w-5 h-5 text-white" strokeWidth={2.5} /></div>
          <span className="text-xl font-extrabold tracking-tight">AuditLens</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight mb-2">{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
        <p className="text-sm text-slate-500 mb-8">{mode === 'login' ? 'Sign in to your AP dashboard' : 'Start auditing invoices in minutes'}</p>
        <div className="flex mb-6 rounded-xl overflow-hidden border border-slate-200">
          <button onClick={() => { setMode('login'); setErr(null); }} className={cn('flex-1 py-2.5 text-sm font-semibold transition-all', mode === 'login' ? 'bg-accent-50 text-accent-700' : 'bg-white text-slate-400')}>Sign In</button>
          <button onClick={() => { setMode('register'); setErr(null); }} className={cn('flex-1 py-2.5 text-sm font-semibold transition-all', mode === 'register' ? 'bg-accent-50 text-accent-700' : 'bg-white text-slate-400')}>Register</button>
        </div>
        {err && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-medium mb-4 border border-red-100">{err}</div>}
        <form onSubmit={submit} className="space-y-4">
          {mode === 'register' && <input name="name" placeholder="Full name" className="inp" required />}
          <input name="email" type="email" placeholder="name@company.com" className="inp" required />
          <input name="password" type="password" placeholder="••••••••" className="inp" required />
          {mode === 'register' && (
            <select name="role" className="inp"><option value="analyst">AP Analyst</option><option value="manager">AP Manager</option><option value="vp">VP Finance</option><option value="cfo">CFO</option></select>
          )}
          <button type="submit" disabled={loading} className="btn-p w-full py-3 text-[15px]">{loading ? 'Authenticating...' : mode === 'login' ? 'Sign In →' : 'Create Account →'}</button>
        </form>
      </div>
      <div className="flex-1 hidden lg:flex items-center justify-center bg-slate-50 border-l border-slate-200 p-12">
        <div className="max-w-sm text-center">
          <div className="text-5xl mb-6">🛡️</div>
          <div className="text-2xl font-extrabold mb-4 tracking-tight">Enterprise AP Automation</div>
          <div className="text-sm text-slate-500 leading-relaxed mb-8">Ensemble AI extraction, anomaly detection, and policy-driven triage — end-to-end AP audit automation.</div>
          <div className="space-y-3 text-left">
            {['15+ anomaly detectors', 'SOX-compliant audit trail', '3-way PO-GRN matching', '10 language support'].map(t => (
              <div key={t} className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="text-slate-600">{t}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   APP SHELL
   ═══════════════════════════════════════════════════ */
function AppShell() {
  const { s, load } = useStore();

  useEffect(() => { load(); }, [load]);

  if (s.loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-4 border-accent-200 border-t-accent-600 animate-spin mx-auto mb-4" />
        <div className="text-sm font-semibold text-slate-500">Loading AuditLens...</div>
      </div>
    </div>
  );

  const pages = {
    dashboard: Dashboard, documents: Documents, triage: Triage, cases: Cases,
    anomalies: Anomalies, matching: Matching, vendors: Vendors, contracts: Contracts,
    settings: SettingsPage, training: Training, upload: UploadPage,
  };
  const Page = pages[s.tab] || Dashboard;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 ml-[258px] p-8 max-w-[1280px]">
        <Page />
      </main>
      <DocModal />
      <Toast />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ROOT
   ═══════════════════════════════════════════════════ */
export default function App() {
  const { s, load } = useStore();
  const [view, setView] = useState(s.user || s.token ? 'app' : 'landing');

  useEffect(() => {
    if (view === 'landing') load();
  }, [view, load]);

  useEffect(() => {
    if (s.user && s.token) setView('app');
  }, [s.user, s.token]);

  // FIX: transition back to landing on logout
  useEffect(() => {
    if (!s.user && !s.token && view === 'app') setView('landing');
  }, [s.user, s.token, view]);

  if (view === 'landing') return <LandingPage onGo={() => setView('login')} />;
  if (view === 'login' && !s.user) return <LoginScreen />;
  return <AppShell />;
}

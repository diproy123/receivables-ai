import { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from './lib/store';
import { api, post, postForm } from './lib/api';
import { $, $f, num, pct, date, dateTime, cn, sevColor, laneLabel, laneColor, docLabel, docColor, short } from './lib/fmt';
import {
  LayoutDashboard, FileText, Zap, ClipboardList, AlertTriangle, Link2, Building2, FileCheck,
  Settings, Brain, Upload, Database, Trash2, LogOut, Shield, ChevronRight, ChevronDown, Search,
  CheckCircle2, XCircle, Clock, TrendingUp, Eye, Edit3, X, UploadCloud, FileUp,
  ArrowUpRight, ArrowDownRight, RotateCcw, Check, Filter, RefreshCw, AlertCircle,
  CircleDot, ExternalLink, Download, Send, Activity, Bell, Users
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
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mt-1.5">{label}</div>
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
              {cols.map((c, i) => <th key={i} className={cn('px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider', c.right && 'text-right', c.center && 'text-center')}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.id || i} onClick={() => onRow?.(r)} className={cn('transition-colors', onRow && 'cursor-pointer hover:bg-slate-50')}>
                {cols.map((c, j) => <td key={j} className={cn('px-4 py-3', c.right && 'text-right', c.center && 'text-center', c.mono && 'font-mono')}>{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={cols.length} className="px-4 py-12 text-center text-slate-500">No data yet</td></tr>}
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

  const intelBadges = {
    expiring: (s.intel || {}).expiring_count || 0,
    critical: (s.intel || {}).critical_contracts || 0,
    highRiskClauses: (s.intel || {}).high_risk_clauses || 0,
  };
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
      { id: 'audit_trail', label: 'Audit Trail', icon: Activity },
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
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-[.12em]">AP Intelligence</div>
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
            <div className="text-[11px] font-bold text-accent-600/80 uppercase tracking-[.1em] px-3 pt-5 pb-2">{sec.section}</div>
            {sec.items.map(it => {
              const on = s.tab === it.id; const Ic = it.icon;
              return (
                <button key={it.id} onClick={() => d({ type: 'TAB', tab: it.id })}
                  className={cn('w-full flex items-center gap-3 px-3 py-[9px] rounded-xl text-[13.5px] font-medium transition-all mb-0.5',
                    on ? 'bg-accent-50 text-accent-700 font-semibold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
                  <Ic className={cn('w-[18px] h-[18px]', on ? 'text-accent-600' : 'text-slate-500')} strokeWidth={on ? 2.2 : 1.8} />
                  {it.label}
                  {it.badge > 0 && <span className={`badge badge-${it.bc} ml-auto`}>{it.badge}</span>}
                </button>
              );
            })}
          </div>
        ))}
        {lvl >= 2 && (
          <div>
            <div className="text-[11px] font-bold text-accent-600/80 uppercase tracking-[.1em] px-3 pt-5 pb-2">Admin</div>
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
              <div className="text-[11px] text-slate-400 truncate">{s.user.email}</div>
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

      {/* ── Savings Discovered Banner (only confirmed/resolved anomalies) ── */}
      {sv > 0 && (
        <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <div className="text-sm font-medium opacity-85 mb-1">✔ Confirmed Savings</div>
              <div className="text-4xl font-extrabold tracking-tight">{$(sv)}</div>
              <div className="text-sm opacity-70 mt-1">From {num(d.total_documents || 0)} documents processed</div>
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

      {/* ── Extended Stat Cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={FileCheck} label="Total Outstanding" value={$(d.total_ap || 0)} sub={`${num(d.unpaid_count || 0)} unpaid`} color="#3b82f6" />
        <StatCard icon={Link2} label="Auto-Matched" value={num(d.auto_matched || 0)} sub={`${d.review_needed || 0} need review`} color="#10b981" />
        <StatCard icon={Building2} label="High Risk Vendors" value={num(vr.high_risk || 0)} sub={vr.worsening ? `${vr.worsening} worsening` : 'All stable'} color="#f59e0b" />
        <StatCard icon={Brain} label="AI Pipeline" value={num(d.correction_patterns || 0)} sub={d.correction_patterns ? 'learned patterns' : 'Ensemble + RAG'} color="#7c3aed" />
      </div>

      {/* ── Intelligence Stat Cards ── */}
      {(() => {
        const il = s.intel || {};
        const ch = il.contract_health || [];
        const hasAnyIntel = ch.length > 0 || il.grn_count > 0;
        if (!hasAnyIntel) return null;
        const healthy = ch.filter(c => c.health_level === 'good').length;
        const warning = ch.filter(c => c.health_level === 'warning').length;
        const critical = ch.filter(c => c.health_level === 'critical').length;
        return (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard icon={FileCheck} label="Contract Health" value={`${healthy}/${ch.length}`} sub={critical > 0 ? `${critical} critical` : warning > 0 ? `${warning} warning` : 'All healthy'} color={critical > 0 ? '#ef4444' : warning > 0 ? '#f59e0b' : '#10b981'} />
            <StatCard icon={Shield} label="Clause Risks" value={num(il.high_risk_clauses || 0)} sub="High-risk clauses" color={il.high_risk_clauses > 0 ? '#dc2626' : '#10b981'} />
            <StatCard icon={Clock} label="Expiring Contracts" value={num(il.expiring_count || 0)} sub={il.expiring_count > 0 ? `within 90 days` : 'None expiring'} color={il.expiring_count > 0 ? '#f59e0b' : '#10b981'} />
            <StatCard icon={TrendingUp} label="Delivery Tracking" value={num(il.grn_count || 0)} sub={il.grn_open_anomalies > 0 ? `${il.grn_open_anomalies} open alerts` : 'Deliveries tracked'} color={il.grn_open_anomalies > 0 ? '#ef4444' : '#3b82f6'} />
          </div>
        );
      })()}

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-6">
          <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-5">Triage Distribution</h3>
          {pie.length > 0 ? (
            <div className="flex items-center gap-8">
              <div className="w-36 h-36"><ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" cx="50%" cy="50%" outerRadius={60} innerRadius={38} strokeWidth={2}>{pie.map((_, i) => <Cell key={i} fill={PIE_C[i]} />)}</Pie></PieChart></ResponsiveContainer></div>
              <div className="space-y-3">{pie.map((p, i) => <div key={p.name} className="flex items-center gap-3"><div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_C[i] }} /><span className="text-sm text-slate-600">{p.name}</span><span className="font-bold text-sm ml-auto font-mono">{p.value}</span></div>)}</div>
            </div>
          ) : <div className="text-center py-10 text-slate-500 text-sm">Upload invoices to begin</div>}
        </div>
        <div className="card p-6">
          <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-5">Invoice Aging</h3>
          {aging.some(d => d.v > 0) ? (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={aging}><XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 8px 32px rgba(0,0,0,.1)', fontSize: 13 }} /><Bar dataKey="v" fill="#3b82f6" radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          ) : <div className="text-center py-10 text-slate-500 text-sm">No aging data</div>}
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
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{a.description}</div><div className="text-xs text-slate-500">{a.invoiceNumber} · {a.vendor}</div></div>
              <div className="text-sm font-bold text-red-600 font-mono">{$(Math.abs(a.amount_at_risk || 0))}</div>
            </div>
          ))}</div>
        </div>
      )}

      {/* ── AI Intelligence Insights ── */}
      {(() => {
        const intel = s.intel || {};
        const exp = intel.expiring_contracts || [];
        const ch = intel.contract_health || [];
        const criticalContracts = ch.filter(c => c.health_level === 'critical');
        const warningContracts = ch.filter(c => c.health_level === 'warning');
        const hasIntel = exp.length > 0 || criticalContracts.length > 0 || intel.grn_open_anomalies > 0;
        if (!hasIntel) return null;
        return (
          <div className="space-y-4">
            <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Brain className="w-4 h-4 text-indigo-500" /> AI Intelligence Insights
            </h3>

            {/* Expiring Contracts Alert */}
            {exp.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center"><FileCheck className="w-4 h-4 text-amber-600" /></div>
                  <div>
                    <div className="text-sm font-bold text-amber-900">{exp.length} Contract{exp.length > 1 ? 's' : ''} Expiring Soon</div>
                    <div className="text-xs text-amber-600">{exp.filter(e => e.urgency === 'critical').length} need immediate action</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {exp.slice(0, 3).map(e => (
                    <div key={e.id} className="flex items-center justify-between p-2.5 bg-white/60 rounded-xl border border-amber-100">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{e.vendor}</div>
                        <div className="text-xs text-slate-500">{e.number} · {$(e.amount)}</div>
                      </div>
                      <div className="text-right">
                        <div className={cn('text-sm font-bold', e.days_left <= 30 ? 'text-red-600' : 'text-amber-600')}>{e.days_left}d left</div>
                        {e.notice_overdue && <div className="text-[11px] text-red-500 font-bold">⚠ OPT-OUT OVERDUE</div>}
                        {e.auto_renewal && !e.notice_overdue && <div className="text-[11px] text-amber-500">Auto-renews</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Contract Health + GRN stats row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Contract Health Summary */}
              {ch.length > 0 && (
                <div className="card p-5">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Contract Health</div>
                  <div className="flex items-center gap-4 mb-3">
                    <div className="text-center"><div className="text-2xl font-extrabold text-emerald-600">{ch.filter(c => c.health_level === 'good').length}</div><div className="text-[11px] text-slate-400">Good</div></div>
                    <div className="text-center"><div className="text-2xl font-extrabold text-amber-500">{warningContracts.length}</div><div className="text-[11px] text-slate-400">Warning</div></div>
                    <div className="text-center"><div className="text-2xl font-extrabold text-red-500">{criticalContracts.length}</div><div className="text-[11px] text-slate-400">Critical</div></div>
                  </div>
                  {criticalContracts.length > 0 && (
                    <div className="space-y-1">
                      {criticalContracts.slice(0, 2).map(c => (
                        <div key={c.id} className="text-xs p-2 bg-red-50 rounded-lg border border-red-100 text-red-700">
                          {c.vendor}: {c.high_risk_clauses} high-risk clause{c.high_risk_clauses !== 1 ? 's' : ''}
                          {c.days_to_expiry != null && c.days_to_expiry < 0 && ` · Expired ${Math.abs(c.days_to_expiry)}d ago`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* High Risk Clauses */}
              {intel.high_risk_clauses > 0 && (
                <div className="card p-5">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Clause Risk Analysis</div>
                  <div className="text-3xl font-extrabold text-red-600 mb-1">{intel.high_risk_clauses}</div>
                  <div className="text-xs text-slate-500">High-risk clauses across {ch.length} contracts</div>
                  <div className="text-xs text-slate-400 mt-2">Missing liability caps, restrictive auto-renewal, no SLA terms</div>
                </div>
              )}

              {/* GRN / Delivery */}
              {intel.grn_count > 0 && (
                <div className="card p-5">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Delivery Intelligence</div>
                  <div className="flex items-center gap-4">
                    <div><div className="text-2xl font-extrabold text-blue-600">{intel.grn_count}</div><div className="text-[11px] text-slate-400">Deliveries Tracked</div></div>
                    {intel.grn_open_anomalies > 0 && <div><div className="text-2xl font-extrabold text-red-500">{intel.grn_open_anomalies}</div><div className="text-[11px] text-slate-400">Open Alerts</div></div>}
                  </div>
                  {intel.top_vendor_concentration > 25 && (
                    <div className="text-xs text-amber-600 mt-2 p-2 bg-amber-50 rounded-lg">⚠ Top vendor = {pct(intel.top_vendor_concentration)} of spend</div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}
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
          { label: 'Document', render: r => <div><div className="font-semibold text-slate-900">{r.contractNumber || r.invoiceNumber || r.poNumber || r.grnNumber || r.documentNumber || r.id}</div><div className="text-xs text-slate-500">{r.vendor}</div></div> },
          { label: 'Type', center: true, render: r => <Badge c={docColor(r.type)}>{docLabel(r.type)}</Badge> },
          { label: 'Amount', center: true, mono: true, render: r => r.type === 'contract' && (!r.amount || r.amount === 0) ? <span className="text-sm font-semibold text-blue-600">Rate Contract</span> : <span className="font-semibold">{$(r.amount, r.currency)}</span> },
          { label: 'Date', center: true, render: r => <span className="text-slate-500">{date(r.issueDate || r.effectiveDate || r.startDate)}</span> },
          { label: 'Confidence', center: true, render: r => <ConfidenceRing score={r.confidence || 0} /> },
          { label: 'Status', center: true, render: r => <Badge c={r.status === 'paid' ? 'ok' : r.status === 'disputed' ? 'err' : r.status === 'approved' ? 'ok' : 'warn'}>{(r.status || '').replace(/_/g, ' ')}</Badge> },
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
  const { s, d, toast, load } = useStore();
  const anoms = s.anomalies || [];
  const [sel, setSel] = useState(null);
  const [notes, setNotes] = useState('');
  const [tab, setTab] = useState('open');
  const [actionType, setActionType] = useState('');
  const [actionMode, setActionMode] = useState('');

  // Reset to list when sidebar re-clicked
  useEffect(() => { if (s.tab === 'anomalies') { setSel(null); setActionMode(''); setActionType(''); setNotes(''); } }, [s.tabKey]);

  const filtered = tab === 'all' ? anoms : anoms.filter(a => a.status === tab);

  const resolveActions = [
    { value: 'corrected_po', label: 'Corrected PO / Document' },
    { value: 'vendor_notified', label: 'Vendor Notified' },
    { value: 'credit_note_issued', label: 'Credit Note Issued' },
    { value: 'payment_adjusted', label: 'Payment Adjusted' },
    { value: 'contract_updated', label: 'Contract Updated' },
    { value: 'other_resolution', label: 'Other — See Notes' },
  ];
  const dismissReasons = [
    { value: 'approved_exception', label: 'Approved Exception' },
    { value: 'false_positive', label: 'False Positive / Not an Issue' },
    { value: 'duplicate_detection', label: 'Duplicate Detection' },
    { value: 'within_tolerance', label: 'Within Acceptable Tolerance' },
    { value: 'other_dismiss', label: 'Other — See Notes' },
  ];

  async function resolve(id) {
    if (!actionType) { toast('Select what action was taken', 'warning'); return; }
    if (!notes.trim()) { toast('Please add resolution notes', 'warning'); return; }
    const label = resolveActions.find(a => a.value === actionType)?.label || actionType;
    await post(`/api/anomalies/${id}/resolve`, { resolution: `[${label}] ${notes}` });
    await load(); setNotes(''); setActionType(''); setSel(null); toast('Anomaly resolved', 'success');
  }
  async function dismiss(id) {
    if (!actionType) { toast('Select a dismissal reason', 'warning'); return; }
    if (!notes.trim()) { toast('Please add justification notes', 'warning'); return; }
    const label = dismissReasons.find(a => a.value === actionType)?.label || actionType;
    await post(`/api/anomalies/${id}/dismiss`, { reason: `[${label}] ${notes}` });
    await load(); setNotes(''); setActionType(''); setSel(null); toast('Anomaly dismissed', 'success');
  }
  const escalationRouting = {
    'TERMS_VIOLATION': { primary: 'AP Manager', secondary: 'Procurement Lead' },
    'PRICE_VARIANCE': { primary: 'AP Manager', secondary: 'Category Manager' },
    'DUPLICATE_INVOICE': { primary: 'AP Manager', secondary: 'Internal Audit' },
    'MISSING_PO': { primary: 'Procurement Lead', secondary: 'AP Manager' },
    'CONTRACT_EXPIRY_WARNING': { primary: 'Procurement Lead', secondary: 'Legal' },
    'CONTRACT_PRICE_DRIFT': { primary: 'Category Manager', secondary: 'Controller' },
    'CONTRACT_OVER_UTILIZATION': { primary: 'Controller', secondary: 'VP Finance' },
    'AMOUNT_SPIKE': { primary: 'AP Manager', secondary: 'Controller' },
    'SHORT_SHIPMENT': { primary: 'Receiving / Warehouse', secondary: 'Procurement Lead' },
  };

  async function escalate(anom) {
    const route = escalationRouting[anom.type] || { primary: 'AP Manager', secondary: 'Controller' };
    const desc = `Anomaly: ${anom.description}\nVendor: ${anom.vendor}\nAmount at Risk: ${anom.amount_at_risk ? '$' + Number(anom.amount_at_risk).toLocaleString() : 'N/A'}\nEscalated to: ${route.primary}\n${anom.recommendation ? 'Recommendation: ' + anom.recommendation : ''}`;
    await post('/api/cases', {
      title: `Escalation: ${anom.invoiceNumber || anom.id} — ${anom.type}`,
      description: desc,
      type: 'anomaly_escalation',
      priority: anom.severity === 'high' ? 'high' : 'medium',
      invoiceId: anom.invoiceId || anom.id,
      anomalyIds: [anom.id],
      vendor: anom.vendor,
      amountAtRisk: anom.amount_at_risk || 0,
      assignedTo: route.primary,
    });
    // Mark anomaly as escalated so it can't be escalated again
    await post(`/api/anomalies/${anom.id}/resolve`, { resolution: `[Escalated to ${route.primary}] Case created for investigation.` });
    await load(); setActionMode(''); toast(`Escalated to ${route.primary} — case created`, 'success');
  }

  const openCount = anoms.filter(a => a.status === 'open').length;
  const resolvedCount = anoms.filter(a => a.status === 'resolved').length;

  return (
    <div className="page-enter">
      <PageHeader title="Anomalies" sub={`${openCount} open anomalies`} />

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {[['open', `Open (${openCount})`], ['resolved', `Resolved (${resolvedCount})`], ['all', `All (${anoms.length})`]].map(([k, label]) =>
          <button key={k} onClick={() => { setTab(k); setSel(null); }} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all', tab === k ? 'bg-accent-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{label}</button>
        )}
      </div>

      <div className="flex gap-6">
        {/* Table */}
        <div className={cn('transition-all', sel ? 'w-1/2' : 'w-full')}>
          <Table
            cols={[
              { label: 'Anomaly', render: r => <div><div className="font-semibold text-sm leading-snug">{r.description}</div><div className="text-xs text-slate-500 mt-0.5">{r.invoiceNumber} · {r.vendor}</div></div> },
              { label: 'Severity', render: r => <Badge c={sevColor(r.severity) === 'err' ? 'err' : sevColor(r.severity) === 'warn' ? 'warn' : 'ok'}>{r.severity}</Badge> },
              { label: 'Risk', right: true, mono: true, render: r => <span className={cn('font-semibold', r.amount_at_risk > 0 ? 'text-red-600' : 'text-slate-400')}>{$(Math.abs(r.amount_at_risk || 0))}</span> },
              { label: 'Type', render: r => {
                const isContract = ['CONTRACT_PRICE_DRIFT','CONTRACT_EXPIRY_WARNING','CONTRACT_OVER_UTILIZATION','CONTRACT_UNDERBILLING','VOLUME_COMMITMENT_GAP','CONTRACT_CURRENCY_MISMATCH'].includes(r.type);
                const isDelivery = ['CHRONIC_SHORT_SHIPMENT','PO_FULFILLMENT_STALE','SHORT_SHIPMENT','OVERBILLED_VS_RECEIVED','QUANTITY_RECEIVED_MISMATCH'].includes(r.type);
                return (
                  <div className="flex items-center gap-1.5">
                    {isContract && <span className="text-[11px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 font-bold rounded">CONTRACT</span>}
                    {isDelivery && <span className="text-[11px] px-1.5 py-0.5 bg-blue-100 text-blue-600 font-bold rounded">DELIVERY</span>}
                    <span className="text-xs text-slate-500">{(r.type || '').replace(/_/g, ' ')}</span>
                  </div>
                );
              }},
              { label: 'Status', render: r => (
                <div className="flex items-center gap-1.5">
                  <Badge c={r.status === 'open' ? 'warn' : r.status === 'resolved' ? 'ok' : 'muted'}>{r.status}</Badge>
                  {r.suppressed && <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 font-bold rounded" title={r.suppressionReason}>⚡ SUPPRESSED</span>}
                </div>
              )},
            ]}
            rows={filtered}
            onRow={r => setSel(r)}
          />
        </div>

        {/* Detail Panel */}
        {sel && (
          <div className="w-1/2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sticky top-24 self-start max-h-[calc(100vh-8rem)] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge c={sevColor(sel.severity) === 'err' ? 'err' : sevColor(sel.severity) === 'warn' ? 'warn' : 'ok'}>{sel.severity}</Badge>
                  <span className="text-xs text-slate-500 font-mono">{(sel.type || '').replace(/_/g, ' ')}</span>
                </div>
                <h3 className="text-lg font-bold text-slate-900">{sel.invoiceNumber}</h3>
                <div className="text-sm text-slate-500">{sel.vendor}</div>
                {sel.suppressed && (
                  <div className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-50 border border-purple-100">
                    <span className="text-[11px] font-bold text-purple-600">⚡ Auto-Suppressed</span>
                    <span className="text-[11px] text-purple-500">{sel.suppressionReason}{sel.originalSeverity ? ` · Severity downgraded from ${sel.originalSeverity}` : ''}</span>
                  </div>
                )}
              </div>
              <button onClick={() => setSel(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
            </div>

            {/* Full Description */}
            <div className="mb-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Description</div>
              <div className="text-sm text-slate-800 leading-relaxed bg-slate-50 rounded-xl p-3">{sel.description}</div>
            </div>

            {/* Risk Amount */}
            {(sel.amount_at_risk || 0) !== 0 && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Amount at Risk</div>
                <div className={cn('text-2xl font-bold', sel.amount_at_risk > 0 ? 'text-red-600' : 'text-emerald-600')}>
                  {sel.amount_at_risk > 0 ? '' : '−'}{$(Math.abs(sel.amount_at_risk || 0))}
                </div>
              </div>
            )}

            {/* Recommendation */}
            {sel.recommendation && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Recommendation</div>
                <div className="text-sm text-slate-700 bg-amber-50 border border-amber-100 rounded-xl p-3">{sel.recommendation}</div>
              </div>
            )}

            {/* Contract Clause */}
            {sel.contract_clause && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Contract Reference</div>
                <div className="text-sm text-slate-700 bg-blue-50 border border-blue-100 rounded-xl p-3">
                  {sel.contract_clause}
                </div>
              </div>
            )}

            {/* Quick Navigation — View source documents */}
            {(() => {
              const allDocs = s.docs || [];
              // Find the source document (PO or invoice)
              const sourceDoc = allDocs.find(d => d.id === sel.invoiceId)
                || allDocs.find(d => (d.invoiceNumber || d.poNumber || d.documentNumber) === sel.invoiceNumber);
              // Find linked contract
              const linkedContract = sel.contractId
                ? allDocs.find(d => d.id === sel.contractId)
                : (sourceDoc?.vendor ? allDocs.find(d => d.type === 'contract' && d.vendor && sourceDoc.vendor && d.vendor.toLowerCase().includes(sourceDoc.vendor.toLowerCase().split(' ')[0])) : null);

              if (!sourceDoc && !linkedContract) return null;
              return (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Source Documents</div>
                  <div className="flex gap-2 flex-wrap">
                    {sourceDoc && (
                      <button onClick={() => { d({ type: 'SEL', doc: sourceDoc }); }}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-accent-300 transition-all text-sm font-medium text-slate-700">
                        <Eye className="w-3.5 h-3.5 text-accent-600" />
                        View {sourceDoc.type === 'purchase_order' ? 'PO' : sourceDoc.type === 'invoice' ? 'Invoice' : 'Document'}: {sourceDoc.poNumber || sourceDoc.invoiceNumber || sourceDoc.documentNumber || sourceDoc.id}
                      </button>
                    )}
                    {linkedContract && (
                      <a href={`#/contracts/${linkedContract.id}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-blue-300 transition-all text-sm font-medium text-slate-700 cursor-pointer">
                        <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
                        View Contract: {linkedContract.contractNumber || linkedContract.id}
                      </a>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Detection Timestamp */}
            {sel.detectedAt && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Detected</div>
                <div className="text-sm text-slate-600">{new Date(sel.detectedAt).toLocaleString()}</div>
              </div>
            )}

            {/* Resolution section */}
            {sel.status === 'open' ? (
              <div className="mt-6 pt-4 border-t border-slate-200">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Take Action</div>

                {/* Action type tabs */}
                <div className="flex gap-1.5 mb-3">
                  {[['resolve', 'Resolve', 'bg-emerald-600'], ['dismiss', 'Dismiss', 'bg-slate-500'], ['escalate', 'Escalate', 'bg-amber-600']].map(([k, label, bg]) => (
                    <button key={k} onClick={() => { setActionType(''); setNotes(''); setActionMode(k); }}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                        actionMode === k ? `${bg} text-white` : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
                    >{label}</button>
                  ))}
                </div>

                {/* Resolve flow */}
                {actionMode === 'resolve' && (
                  <div className="space-y-2.5">
                    <div>
                      <div className="text-[11px] font-semibold text-slate-500 mb-1">Action Taken *</div>
                      <select value={actionType} onChange={e => setActionType(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500">
                        <option value="">Select what action was taken...</option>
                        {resolveActions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                    </div>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)}
                      placeholder="Describe what was done — e.g. 'Reissued PO with corrected payment terms. Vendor confirmed receipt.'"
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm h-20 resize-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
                    <button onClick={() => resolve(sel.id)} className="btn-p text-sm px-4 py-2 w-full"><Check className="w-4 h-4" /> Resolve Anomaly</button>
                  </div>
                )}

                {/* Dismiss flow */}
                {actionMode === 'dismiss' && (
                  <div className="space-y-2.5">
                    <div>
                      <div className="text-[11px] font-semibold text-slate-500 mb-1">Reason for Dismissal *</div>
                      <select value={actionType} onChange={e => setActionType(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-slate-400 focus:border-slate-400">
                        <option value="">Select reason...</option>
                        {dismissReasons.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                    </div>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)}
                      placeholder="Justification — e.g. 'Net 45 exception approved by VP Procurement per email 2/15/2025.'"
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm h-20 resize-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400" />
                    <button onClick={() => dismiss(sel.id)} className="bg-slate-600 hover:bg-slate-700 text-white text-sm px-4 py-2 rounded-xl font-semibold w-full flex items-center justify-center gap-2 transition-all"><X className="w-4 h-4" /> Dismiss Anomaly</button>
                  </div>
                )}

                {/* Escalate flow */}
                {actionMode === 'escalate' && (
                  <div className="space-y-2.5">
                    {(() => {
                      const route = escalationRouting[sel.type] || { primary: 'AP Manager', secondary: 'Controller' };
                      const amtText = sel.amount_at_risk > 25000 ? 'High value — consider escalating to Controller/VP' : '';
                      return (
                        <>
                          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-sm text-amber-800">
                            <div className="font-bold mb-1">Recommended Escalation Path</div>
                            <div className="flex gap-3 mb-2">
                              <div className="flex-1 bg-white rounded-lg p-2 border border-amber-200">
                                <div className="text-[11px] text-amber-600 font-bold uppercase">Primary</div>
                                <div className="text-sm font-bold text-slate-800">{route.primary}</div>
                              </div>
                              <div className="flex-1 bg-white rounded-lg p-2 border border-amber-200">
                                <div className="text-[11px] text-amber-600 font-bold uppercase">Alternative</div>
                                <div className="text-sm font-bold text-slate-800">{route.secondary}</div>
                              </div>
                            </div>
                            {amtText && <div className="text-xs font-semibold text-red-700 mt-1">⚠ {amtText}</div>}
                            <div className="text-xs text-amber-700 mt-1">This creates a <span className="font-bold">Case</span> assigned to the review queue.</div>
                          </div>
                          <button onClick={() => escalate(sel)} className="bg-amber-600 hover:bg-amber-700 text-white text-sm px-4 py-2 rounded-xl font-semibold w-full flex items-center justify-center gap-2 transition-all"><ClipboardList className="w-4 h-4" /> Escalate to {route.primary}</button>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Default — no mode selected yet */}
                {!actionMode && (
                  <div className="text-center text-xs text-slate-400 py-4">Select an action above to proceed</div>
                )}
              </div>
            ) : (
              <div className="mt-6 pt-4 border-t border-slate-200">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Resolution</div>
                <div className={cn("text-sm text-slate-700 rounded-xl p-3 border", sel.status === 'resolved' ? "bg-emerald-50 border-emerald-100" : "bg-slate-50 border-slate-100")}>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge c={sel.status === 'resolved' ? 'ok' : 'muted'}>{sel.status}</Badge>
                    <span className="text-xs text-slate-400">{sel.resolvedBy || sel.dismissedBy || ''} · {sel.resolvedAt ? new Date(sel.resolvedAt).toLocaleString() : sel.dismissedAt ? new Date(sel.dismissedAt).toLocaleString() : ''}</span>
                  </div>
                  {sel.resolution || sel.dismissReason || 'No notes recorded'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PO MATCHING
   ═══════════════════════════════════════════════════ */
function Matching() {
  const { s, toast, load } = useStore();
  const matches = s.matches || [];
  const allDocs = s.docs || [];
  async function approve(id) { await post(`/api/matches/${id}/approve`, {}); await load(); toast('Match approved', 'success'); }
  async function reject(id) { await post(`/api/matches/${id}/reject`, {}); await load(); toast('Match rejected', 'warning'); }

  // Summary counts
  const twoWay = matches.filter(m => !m.grnIds?.length).length;
  const threeWay = matches.filter(m => m.grnIds?.length > 0).length;
  const needsReview = matches.filter(m => m.status === 'pending_review' || m.status === 'review_needed').length;

  return (
    <div className="page-enter">
      <PageHeader title="PO Matching" sub={`${matches.length} matches`} />

      {/* Summary pills */}
      {matches.length > 0 && (
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-xl border border-blue-100">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-xs font-semibold text-blue-700">{twoWay} Two-Way</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-xl border border-emerald-100">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-semibold text-emerald-700">{threeWay} Three-Way</span>
          </div>
          {needsReview > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-xl border border-amber-100">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-amber-700">{needsReview} Needs Review</span>
            </div>
          )}
        </div>
      )}

      <Table
        cols={[
          { label: 'Invoice → PO', render: r => <div><span className="font-semibold">{r.invoiceNumber}</span><span className="text-slate-500 mx-2">→</span><span className="font-semibold text-accent-600">{r.poNumber}</span></div> },
          { label: 'Vendor', render: r => <span className="text-slate-600">{r.vendor}</span> },
          { label: 'Match Type', center: true, render: r => {
            const hasGRN = r.grnIds?.length > 0 || r.grnStatus === 'matched';
            return (
              <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full",
                hasGRN ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>
                {hasGRN ? "3-Way" : "2-Way"}
              </span>
            );
          }},
          { label: 'Δ Amount', right: true, render: r => { const d = r.amountDifference || 0; return <span className={cn('font-mono font-semibold', Math.abs(d) > 0 ? 'text-red-600' : 'text-emerald-600')}>{d > 0 ? '+' : ''}{$f(d)}</span>; }},
          { label: 'Match', center: true, render: r => <ConfidenceRing score={r.matchScore || 0} /> },
          { label: 'Status', render: r => <Badge c={r.status === 'matched' || r.status === 'auto_matched' ? 'ok' : r.status === 'mismatch' ? 'err' : 'warn'}>{(r.status || '').replace(/_/g, ' ')}</Badge> },
          { label: '', render: r => (r.status === 'pending_review' || r.status === 'review_needed') && (
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
  const { s, toast, load } = useStore();
  const tri = s.triageData || {};
  const lanes = ['AUTO_APPROVE', 'MANAGER_REVIEW', 'VP_REVIEW', 'CFO_REVIEW', 'BLOCK'];
  const laneIcons = { AUTO_APPROVE: CheckCircle2, BLOCK: XCircle, MANAGER_REVIEW: Eye, VP_REVIEW: Eye, CFO_REVIEW: Eye };

  const bgMap = { AUTO_APPROVE: 'bg-emerald-50 border-b border-emerald-100', BLOCK: 'bg-red-50 border-b border-red-100', MANAGER_REVIEW: 'bg-amber-50 border-b border-amber-100', VP_REVIEW: 'bg-amber-50 border-b border-amber-100', CFO_REVIEW: 'bg-amber-50 border-b border-amber-100' };
  const icMap = { AUTO_APPROVE: 'text-emerald-600', BLOCK: 'text-red-600', MANAGER_REVIEW: 'text-amber-600', VP_REVIEW: 'text-amber-600', CFO_REVIEW: 'text-amber-600' };
  const txtMap = { AUTO_APPROVE: 'text-emerald-900', BLOCK: 'text-red-900', MANAGER_REVIEW: 'text-amber-900', VP_REVIEW: 'text-amber-900', CFO_REVIEW: 'text-amber-900' };

  const [sel, setSel] = useState(null);
  const allAnoms = s.anomalies || [];

  // Reset to list when sidebar re-clicked
  useEffect(() => { if (s.tab === 'triage') setSel(null); }, [s.tabKey]);

  // Find anomalies for selected invoice
  const selAnoms = sel ? allAnoms.filter(a => a.invoiceId === sel.id || a.invoiceNumber === sel.invoiceNumber) : [];
  // Find the triage reason for the selected invoice
  const selLane = sel ? lanes.find(l => (tri[l] || []).some(i => i.id === sel.id)) : null;

  async function overrideApprove(inv) {
    const n = prompt('Override reason — why should this be approved despite being blocked?');
    if (n?.trim()) {
      const form = new FormData();
      form.append('lane', 'AUTO_APPROVE');
      form.append('reason', n.trim());
      const resp = await fetch(`/api/invoices/${inv.id}/override-triage`, { method: 'POST', body: form, credentials: 'include' });
      if (resp.ok) { await load(); setSel(null); toast('Invoice approved (override)', 'success'); }
      else { toast('Override failed', 'error'); }
    }
  }
  async function escalateCase(inv) {
    await post('/api/cases', { title: `Triage review: ${inv.invoiceNumber || inv.id}`, description: `Invoice ${inv.invoiceNumber} from ${inv.vendor} (${$(inv.amount, inv.currency)}) was routed to ${selLane}. Requires investigation.`, type: 'triage_escalation', priority: 'high', invoiceId: inv.id });
    await load(); toast('Case created for investigation', 'success');
  }

  return (
    <div className="page-enter space-y-6">
      <PageHeader title="Triage" sub="Policy-driven invoice routing" />
      <div className="flex gap-6">
        <div className={cn('transition-all', sel ? 'w-1/2' : 'w-full')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    {items.length === 0 && <div className="p-6 text-center text-sm text-slate-500">No invoices</div>}
                    {items.map(inv => (
                      <div key={inv.id} onClick={() => setSel(inv)} className={cn('px-5 py-3 hover:bg-slate-50 transition-colors cursor-pointer', sel?.id === inv.id && 'bg-accent-50 ring-1 ring-accent-200')}>
                        <div className="flex items-center justify-between">
                          <div className="font-semibold text-sm">{inv.invoiceNumber || inv.id}</div>
                          <span className="text-sm font-bold font-mono">{$(inv.amount, inv.currency)}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{inv.vendor} · {pct(inv.confidence)} conf</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail Panel */}
        {sel && (
          <div className="w-1/2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sticky top-24 self-start max-h-[calc(100vh-8rem)] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{sel.invoiceNumber || sel.id}</h3>
                <div className="text-sm text-slate-500">{sel.vendor}</div>
              </div>
              <button onClick={() => setSel(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
            </div>

            {/* Invoice Summary */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-slate-50 rounded-xl p-3">
                <div className="text-xs text-slate-500">Amount</div>
                <div className="text-lg font-bold">{$(sel.amount, sel.currency)}</div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <div className="text-xs text-slate-500">Confidence</div>
                <div className="text-lg font-bold">{pct(sel.confidence)}</div>
              </div>
            </div>

            {/* PO Match — 3-way match context */}
            {(() => {
              const match = (s.matches || []).find(m => m.invoiceId === sel.id);
              const allDocs = s.docs || [];
              const po = match ? allDocs.find(d => d.id === match.poId) : null;
              const grn = match ? allDocs.find(d => d.type === 'goods_receipt' && (d.poReference === match.poNumber || d.poId === match.poId)) : null;
              const hasMatch = match && po;

              return (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">PO Match</div>
                  {hasMatch ? (
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      {/* 3-way match indicator */}
                      <div className="flex items-center gap-0 text-xs font-bold bg-slate-50 px-4 py-2.5">
                        <div className="flex items-center gap-1.5 text-emerald-700"><FileText className="w-3.5 h-3.5" /> Invoice</div>
                        <div className={cn("mx-2 text-lg", match.matchScore >= 75 ? "text-emerald-500" : "text-amber-500")}>{match.matchScore >= 75 ? "↔" : "⇢"}</div>
                        <div className="flex items-center gap-1.5 text-blue-700"><Link2 className="w-3.5 h-3.5" /> PO</div>
                        <div className={cn("mx-2 text-lg", grn ? "text-emerald-500" : "text-slate-300")}>{grn ? "↔" : "·····"}</div>
                        <div className={cn("flex items-center gap-1.5", grn ? "text-indigo-700" : "text-slate-400")}><ClipboardList className="w-3.5 h-3.5" /> GRN</div>
                        <div className="ml-auto">
                          <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold",
                            grn ? "bg-emerald-100 text-emerald-700" : match.matchScore >= 75 ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700")}>
                            {grn ? "3-Way Match" : match.matchScore >= 75 ? "2-Way Match" : "Review Needed"}
                          </span>
                        </div>
                      </div>
                      {/* PO details */}
                      <div className="px-4 py-3 border-t border-slate-100">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <span className="text-sm font-bold text-slate-900">{match.poNumber}</span>
                            <span className="text-xs text-slate-500 ml-2">{po.vendor}</span>
                          </div>
                          <ConfidenceRing score={match.matchScore || 0} />
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div><span className="text-slate-500">PO Value</span><div className="font-bold font-mono">{$(po.amount, po.currency)}</div></div>
                          <div><span className="text-slate-500">Invoiced</span><div className={cn("font-bold font-mono", match.overInvoiced ? "text-red-600" : "text-slate-800")}>{$(match.poAlreadyInvoiced || 0)}</div></div>
                          <div><span className="text-slate-500">Δ Amount</span><div className={cn("font-bold font-mono", (match.amountDifference || 0) > 0 ? "text-amber-600" : "text-emerald-600")}>{$f(match.amountDifference || 0)}</div></div>
                        </div>
                        {match.overInvoiced && (
                          <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700 font-medium">
                            ⚠ Total invoiced exceeds PO value — requires review
                          </div>
                        )}
                      </div>
                      {/* GRN status if present */}
                      {grn && (
                        <div className="px-4 py-2.5 border-t border-slate-100 bg-indigo-50/50">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-indigo-700">GRN: {grn.documentNumber || grn.grnNumber || grn.id}</span>
                            <span className="text-slate-500">{date(grn.issueDate || grn.receivedDate)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                      {sel.poReference
                        ? <span>PO Ref: <span className="font-semibold text-slate-600">{sel.poReference}</span> — no matching PO found in system</span>
                        : "No PO reference on invoice — unmatched"}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Triage Decision */}
            <div className="mb-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Triage Decision</div>
              <div className={cn('rounded-xl p-3 text-sm font-medium',
                selLane === 'BLOCK' ? 'bg-red-50 text-red-800 border border-red-100' :
                selLane === 'AUTO_APPROVE' ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' :
                'bg-amber-50 text-amber-800 border border-amber-100'
              )}>
                {laneLabel(selLane)}
                {sel.triageReason && <div className="text-xs mt-1 opacity-75">{sel.triageReason}</div>}
              </div>
            </div>

            {/* Linked Anomalies */}
            {selAnoms.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Anomalies ({selAnoms.length})</div>
                <div className="space-y-2">
                  {selAnoms.map(a => (
                    <div key={a.id} className="bg-slate-50 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge c={sevColor(a.severity) === 'err' ? 'err' : sevColor(a.severity) === 'warn' ? 'warn' : 'ok'}>{a.severity}</Badge>
                        <span className="text-xs text-slate-500 font-mono">{(a.type || '').replace(/_/g, ' ')}</span>
                        {a.amount_at_risk > 0 && <span className="text-xs font-bold text-red-600 ml-auto">{$(a.amount_at_risk)}</span>}
                      </div>
                      <div className="text-sm text-slate-700">{a.description}</div>
                      {a.recommendation && <div className="text-xs text-amber-700 mt-1">→ {a.recommendation}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            {selLane !== 'AUTO_APPROVE' && (
              <div className="mt-6 pt-4 border-t border-slate-200">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Actions</div>
                <div className="flex gap-2">
                  <button onClick={() => overrideApprove(sel)} className="btn-p text-sm px-4 py-2 flex-1"><Check className="w-4 h-4" /> Override & Approve</button>
                  <button onClick={() => escalateCase(sel)} className="btn-g text-sm px-4 py-2 flex-1"><ClipboardList className="w-4 h-4" /> Create Case</button>
                </div>
              </div>
            )}
          </div>
        )}
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
          { label: 'Case', render: r => <div><div className="font-semibold">{r.title || r.id}</div><div className="text-xs text-slate-500">{r.id}</div></div> },
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
                <div className="text-xs text-slate-500 font-mono mt-1">{detail.id}</div>
              </div>
              <button onClick={() => setDetail(null)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div><div className="text-[11px] font-semibold text-slate-500 uppercase">Priority</div><Badge c={priColor[detail.priority] || 'muted'}>{detail.priority}</Badge></div>
              <div><div className="text-[11px] font-semibold text-slate-500 uppercase">Status</div><Badge c={detail.status === 'resolved' ? 'ok' : 'warn'}>{(detail.status || '').replace(/_/g, ' ')}</Badge></div>
              <div><div className="text-[11px] font-semibold text-slate-500 uppercase">Assigned</div><div className="text-sm font-medium">{detail.assignedTo || '—'}</div></div>
              <div><div className="text-[11px] font-semibold text-slate-500 uppercase">Created</div><div className="text-sm">{dateTime(detail.createdAt)}</div></div>
            </div>
            {detail.description && <div className="p-3 bg-slate-50 rounded-xl text-sm text-slate-600 mb-4">{detail.description}</div>}
            {/* Notes */}
            {detail.notes?.length > 0 && (
              <div className="mb-4">
                <div className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-2">Notes</div>
                <div className="space-y-2">{detail.notes.map((n, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-xl">
                    <div className="text-sm">{n.text}</div>
                    <div className="text-[11px] text-slate-400 mt-1">{n.addedBy} · {dateTime(n.addedAt)}</div>
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
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  // Reset to list when sidebar re-clicked
  useEffect(() => { if (s.tab === 'vendors') { setSel(null); setDetail(null); } }, [s.tabKey]);

  async function viewVendor(v) {
    setSel(v);
    setLoading(true);
    try {
      const vName = encodeURIComponent(v.vendor || v.vendorDisplay || v.name || '');
      const r = await api(`/api/vendors/${vName}/extended-risk`);
      setDetail(r && !r._err ? r : null);
    } catch { setDetail(null); }
    setLoading(false);
  }

  const factorLabels = {
    anomaly_rate: 'Anomaly Rate', correction_freq: 'Correction Frequency',
    contract_compliance: 'Contract Compliance', duplicate_history: 'Duplicate History',
    volume_consistency: 'Volume Consistency', kyc_compliance: 'Compliance Status',
    payment_behavior: 'Payment Behavior', concentration_risk: 'Spend Concentration',
    delivery_performance: 'Delivery Performance',
  };
  const RiskBar = ({ label, score, weight }) => {
    const cl = score >= 60 ? '#ef4444' : score >= 30 ? '#f59e0b' : '#10b981';
    return (
      <div className="flex items-center gap-3 py-1.5">
        <span className="text-xs text-slate-600 w-32 flex-shrink-0">{label}</span>
        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: Math.max(2, score) + '%', background: cl }} />
        </div>
        <span className="text-xs font-bold font-mono w-8 text-right" style={{ color: cl }}>{Math.round(score)}</span>
        <span className="text-[11px] text-slate-400 w-10 text-right">{pct(weight * 100)}</span>
      </div>
    );
  };

  return (
    <div className="page-enter">
      <PageHeader title="Vendors" sub={`${vendors.length} vendors tracked`} />

      <div className="flex gap-6">
        <div className={cn('transition-all', sel ? 'w-1/2' : 'w-full')}>
          <Table
            cols={[
              { label: 'Vendor', render: r => <div className="font-semibold">{r.vendor || r.vendorDisplay || r.name || '—'}</div> },
              { label: 'Risk', render: r => <Badge c={r.riskLevel === 'high' ? 'err' : r.riskLevel === 'medium' ? 'warn' : 'ok'}>{r.riskLevel} · {Math.round(r.riskScore || 0)}</Badge> },
              { label: 'Invoices', render: r => <span className="font-mono">{r.invoiceCount || 0}</span> },
              { label: 'Total', right: true, render: r => <span className="font-semibold font-mono">{$(r.totalSpend || r.totalAmount || 0)}</span> },
              { label: 'Anomaly Rate', render: r => { const total = r.invoiceCount || 0; const anom = r.totalAnomalies || 0; const rate = total > 0 ? (anom / total * 100) : 0; return <span className={cn('font-mono text-sm', rate > 20 ? 'text-red-600' : 'text-slate-600')}>{total > 0 ? pct(rate) : '—'}</span>; }},
              { label: 'Trend', render: r => <span className={cn('text-xs font-semibold', r.trend === 'worsening' ? 'text-red-500' : r.trend === 'improving' ? 'text-emerald-500' : 'text-slate-400')}>{r.trend === 'worsening' ? '↗ Worsening' : r.trend === 'improving' ? '↘ Improving' : '→ Stable'}</span> },
            ]}
            rows={vendors}
            onRow={viewVendor}
          />
        </div>

        {/* Vendor Detail Panel */}
        {sel && (
          <div className="w-1/2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sticky top-24 self-start max-h-[calc(100vh-8rem)] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{sel.vendor || sel.vendorDisplay || sel.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge c={sel.riskLevel === 'high' ? 'err' : sel.riskLevel === 'medium' ? 'warn' : 'ok'}>{sel.riskLevel === 'high' ? 'High' : sel.riskLevel === 'medium' ? 'Medium' : 'Low'} Risk</Badge>
                  <span className="text-xs text-slate-500">{sel.invoiceCount || 0} invoices · {$(sel.totalSpend || 0)}</span>
                </div>
              </div>
              <button onClick={() => { setSel(null); setDetail(null); }} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
            </div>

            {loading && (
              <div className="text-center py-8">
                <div className="w-8 h-8 rounded-full border-3 border-indigo-200 border-t-indigo-600 animate-spin mx-auto mb-3" />
                <div className="text-sm text-slate-500">Loading risk analysis...</div>
              </div>
            )}

            {detail && detail.risk && (
              <>
                {/* 9-Factor Risk Breakdown */}
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">{detail.risk.factor_count || 9}-Factor Risk Profile</span>
                    {detail.risk.extended && <span className="text-[11px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 font-bold rounded">FULL PROFILE</span>}
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl space-y-0.5">
                    {Object.entries(detail.risk.factors || {}).map(([k, f]) => (
                      <RiskBar key={k} label={factorLabels[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} score={f.score || 0} weight={f.weight || 0} />
                    ))}
                  </div>
                  {detail.risk.factors && Object.entries(detail.risk.factors).some(([,f]) => f.detail) && (
                    <div className="mt-2 space-y-1">
                      {Object.entries(detail.risk.factors).filter(([,f]) => f.detail && f.score > 20).map(([k, f]) => (
                        <div key={k} className={cn('text-xs p-2 rounded-lg', f.score >= 50 ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-amber-50 text-amber-700 border border-amber-100')}>
                          <span className="font-semibold">{factorLabels[k] || k.replace(/_/g, ' ')}:</span> {f.detail}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* KYC Status */}
                {detail.kyc && (
                  <div className="mb-5">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Vendor Compliance Status</div>
                    <div className={cn('p-3 rounded-xl border', detail.kyc.status === 'compliant' ? 'bg-emerald-50 border-emerald-200' : detail.kyc.status === 'expired' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200')}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={cn('text-sm font-bold', detail.kyc.status === 'compliant' ? 'text-emerald-700' : detail.kyc.status === 'expired' ? 'text-red-700' : 'text-amber-700')}>
                          {detail.kyc.status === 'compliant' ? '✓ Compliant' : detail.kyc.status === 'expired' ? '✗ Expired' : '⚠ Unverified'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className={detail.kyc.has_contract ? 'text-emerald-600' : 'text-red-500'}>{detail.kyc.has_contract ? '✓' : '✗'}</span>
                          <span className="text-slate-600">Contract on file</span>
                        </div>
                        {detail.kyc.contract_expiry != null && (
                          <div className="flex items-center gap-1.5">
                            <span className={detail.kyc.contract_expiry > 30 ? 'text-emerald-600' : 'text-amber-500'}>⏱</span>
                            <span className="text-slate-600">{detail.kyc.contract_expiry}d to expiry</span>
                          </div>
                        )}
                        {detail.kyc.risk_flags > 0 && (
                          <div className="flex items-center gap-1.5 text-red-600">
                            <span>⚠</span>
                            <span className="font-semibold">{detail.kyc.risk_flags} risk flag{detail.kyc.risk_flags > 1 ? 's' : ''}</span>
                          </div>
                        )}
                      </div>
                      {detail.kyc.documents?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-current/10 space-y-1">
                          {detail.kyc.documents.map((doc, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-slate-600">{doc.type?.replace(/_/g, ' ')}</span>
                              <span className={cn('font-semibold', doc.status === 'valid' ? 'text-emerald-600' : doc.status === 'expired' ? 'text-red-600' : 'text-amber-600')}>{doc.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Delivery Performance */}
                {detail.risk.delivery && detail.risk.delivery.total_grns > 0 && (
                  <div className="mb-5">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Delivery Performance</div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <div className="text-lg font-bold" style={{ color: detail.risk.delivery.on_time_rate >= 0.9 ? '#10b981' : detail.risk.delivery.on_time_rate >= 0.75 ? '#f59e0b' : '#ef4444' }}>
                          {pct(detail.risk.delivery.on_time_rate * 100)}
                        </div>
                        <div className="text-[11px] text-slate-400">On-Time</div>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <div className="text-lg font-bold" style={{ color: detail.risk.delivery.late_count > 0 ? '#ef4444' : '#10b981' }}>
                          {detail.risk.delivery.late_count || 0}
                        </div>
                        <div className="text-[11px] text-slate-400">Late</div>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <div className="text-lg font-bold" style={{ color: detail.risk.delivery.short_shipment_rate <= 0.1 ? '#10b981' : '#ef4444' }}>
                          {pct(detail.risk.delivery.short_shipment_rate * 100)}
                        </div>
                        <div className="text-[11px] text-slate-400">Short Ship</div>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <div className="text-lg font-bold text-blue-600">{detail.risk.delivery.total_grns}</div>
                        <div className="text-[11px] text-slate-400">Deliveries</div>
                      </div>
                    </div>
                    {detail.risk.delivery.unmeasurable_count > 0 && (
                      <div className="text-[11px] text-amber-600 mt-1.5 p-1.5 bg-amber-50 rounded-lg text-center">
                        ⚠ {detail.risk.delivery.unmeasurable_count} of {detail.risk.delivery.total_grns} deliveries have incomplete date data — on-time rate based on {detail.risk.delivery.measurable_count || 0} measurable deliveries
                      </div>
                    )}
                    {detail.risk.delivery.trend && detail.risk.delivery.trend !== 'no_data' && (
                      <div className={cn('text-xs mt-2 p-2 rounded-lg text-center font-semibold',
                        detail.risk.delivery.trend === 'deteriorating' ? 'bg-red-50 text-red-600' :
                        detail.risk.delivery.trend === 'good' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500')}>
                        Trend: {detail.risk.delivery.trend}
                      </div>
                    )}
                    {detail.risk.delivery.open_pos?.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[11px] font-semibold text-slate-500 mb-1">Open POs</div>
                        {detail.risk.delivery.open_pos.slice(0, 3).map((po, i) => (
                          <div key={i} className="text-xs flex justify-between p-1.5 bg-amber-50 rounded-lg mb-1 border border-amber-100">
                            <span className="text-slate-600">{po.po_number}</span>
                            <span className="text-amber-600 font-semibold">{po.fulfilled_pct}% fulfilled · {po.days_open}d open</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Concentration */}
                {detail.risk.concentration_pct > 0 && (
                  <div className="mb-5">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Spend Concentration</div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: Math.min(100, detail.risk.concentration_pct) + '%', background: detail.risk.concentration_pct > 30 ? '#ef4444' : detail.risk.concentration_pct > 15 ? '#f59e0b' : '#10b981' }} />
                      </div>
                      <span className={cn('text-sm font-bold', detail.risk.concentration_pct > 30 ? 'text-red-600' : 'text-slate-600')}>
                        {pct(detail.risk.concentration_pct)}
                      </span>
                    </div>
                    {detail.risk.concentration_pct > 30 && (
                      <div className="text-xs text-red-600 mt-1">⚠ High concentration — consider diversifying suppliers</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   CONTRACTS
   ═══════════════════════════════════════════════════ */
function Contracts() {
  const { s, d } = useStore();
  const contracts = (s.docs || []).filter(x => x.type === 'contract');
  const invoices = (s.docs || []).filter(x => x.type === 'invoice');
  const [sel, setSel] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [showClauses, setShowClauses] = useState(false);
  const [lifecycleRunning, setLifecycleRunning] = useState(false);
  const [lifecycleResult, setLifecycleResult] = useState(null);
  const [intelReport, setIntelReport] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [healthFilter, setHealthFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const healthData = (s.intel || {}).contract_health || [];

  useEffect(() => {
    if (s.contractId && !sel) {
      const target = contracts.find(c => c.id === s.contractId);
      if (target) setSel(target);
    }
  }, [s.contractId, contracts.length]);

  // Reset to list view when sidebar "Contracts" is re-clicked
  useEffect(() => {
    if (s.tab === 'contracts' && !s.contractId) {
      setSel(null);
      setAnalysis(null);
      setShowClauses(false);
    }
  }, [s.tabKey]);

  // Fetch analysis when contract selected
  useEffect(() => {
    if (sel) {
      setLoadingAnalysis(true);
      api(`/api/contracts/${sel.id}/analysis`).then(r => {
        setAnalysis(r && !r._err ? r : null);
        setLoadingAnalysis(false);
      }).catch(() => { setAnalysis(null); setLoadingAnalysis(false); });
    } else { setAnalysis(null); }
  }, [sel?.id]);

  const c = sel;
  const linkedInvoices = c ? invoices.filter(inv =>
    inv.vendor && c.vendor && inv.vendor.toLowerCase().includes(c.vendor.toLowerCase().split(' ')[0])
  ) : [];
  const totalInvoiced = linkedInvoices.reduce((s, i) => s + (i.amount || 0), 0);

  const getStatus = (ctr) => {
    const startStr = ctr.effectiveDate || ctr.issueDate;
    if (!startStr) return { label: 'Unknown', color: 'muted' };
    const now = new Date();
    const end = ctr.endDate ? new Date(ctr.endDate) : null;
    const start = new Date(startStr);
    if (start > now) return { label: 'Upcoming', color: 'info' };
    if (end && end < now) return { label: 'Expired', color: 'err' };
    if (end) {
      const daysLeft = Math.ceil((end - now) / 86400000);
      if (daysLeft <= 90) return { label: `Expiring (${daysLeft}d)`, color: 'warn' };
    }
    return { label: 'Active', color: 'ok' };
  };

  // Health score ring
  const HealthRing = ({ score, size = 48 }) => {
    const r = (size - 5) / 2, circ = 2 * Math.PI * r, off = circ * (1 - score / 100);
    const cl = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444';
    return (
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="4" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={cl} strokeWidth="4" strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round" />
        <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central" fill={cl} fontSize="12" fontWeight="800" style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>{score}</text>
      </svg>
    );
  };

  const riskBadge = (risk) => {
    const colors = { high: 'bg-red-100 text-red-700 border-red-200', medium: 'bg-amber-100 text-amber-700 border-amber-200', low: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
    return <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', colors[risk] || colors.low)}>{risk}</span>;
  };

  if (c) {
    const status = getStatus(c);
    const an = analysis?.analysis || {};
    const hl = analysis?.health || {};
    const clauses = an.clauses || [];
    const obligations = an.obligations || [];
    const pricingRules = an.pricing_rules || [];
    const utilization = c.amount > 0 ? (totalInvoiced / c.amount * 100) : 0;
    const ct = c.contractTerms || {};

    // Early payment discount detection
    const epd = c.earlyPaymentDiscount || (c.paymentTerms && c.paymentTerms.includes('/') ? (() => {
      const m = c.paymentTerms.match(/(\d+)\/(\d+)/);
      return m ? { discount_pct: parseFloat(m[1]), days: parseInt(m[2]) } : null;
    })() : null);

    // Auto-renewal opt-out deadline
    const optOutDate = c.autoRenewal && c.endDate && c.renewalNoticeDays ? (() => {
      const end = new Date(c.endDate); end.setDate(end.getDate() - (c.renewalNoticeDays || 60)); return end;
    })() : null;
    const optOutDays = optOutDate ? Math.ceil((optOutDate - new Date()) / 86400000) : null;

    // Pricing items from various sources
    const pricingItems = Array.isArray(c.pricingTerms) ? c.pricingTerms
      : (typeof c.pricingTerms === 'object' && c.pricingTerms ? Object.entries(c.pricingTerms).map(([k,v]) => ({ item: k, rate: v })) : []);

    // Anomalies linked to this contract's invoices
    const allAnomalies = s.anomalies || [];
    const linkedInvIds = new Set(linkedInvoices.map(i => i.id));
    const linkedAnomalies = allAnomalies.filter(a => linkedInvIds.has(a.invoiceId) && a.status === 'open');

    // Active POs for this vendor
    const allPOs = (s.docs || []).filter(x => x.type === 'purchase_order');
    const linkedPOs = allPOs.filter(po => po.vendor && c.vendor && po.vendor.toLowerCase().includes(c.vendor.toLowerCase().split(' ')[0]));

    return (
      <div className="page-enter">
        <PageHeader title="Contracts" sub={c.contractNumber || c.id}>
          <button onClick={() => setSel(null)} className="btn-g text-xs"><X className="w-3 h-3" /> Back to List</button>
          <button onClick={() => { d({ type: 'SEL', doc: c }); }} className="btn-o text-xs"><Eye className="w-3 h-3" /> View Document</button>
        </PageHeader>

        {/* ═══ TOP: AP Operations Summary Bar ═══ */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
          <div className="card p-3 flex items-center gap-2.5">
            {hl.health_score != null ? <HealthRing score={hl.health_score} size={44} /> : <div className="w-10 h-10 bg-slate-100 rounded-full animate-pulse" />}
            <div><div className="text-[11px] font-bold text-slate-400 uppercase">Health</div><div className="text-sm font-bold">{hl.health_level || '...'}</div></div>
          </div>
          <div className="card p-3"><div className="text-[11px] font-bold text-slate-400 uppercase">Status</div><Badge c={status.color}>{status.label}</Badge></div>
          <div className="card p-3"><div className="text-[11px] font-bold text-slate-400 uppercase">Contract Value</div>
            {c.amount > 0
              ? <div className="text-base font-bold text-slate-900">{$(c.amount, c.currency)}</div>
              : <div className="text-sm font-bold text-blue-600">{c.isRateContract || pricingItems.length > 0 ? 'Rate Contract' : '—'}</div>}
          </div>
          <div className="card p-3"><div className="text-[11px] font-bold text-slate-400 uppercase">Invoiced</div><div className="text-base font-bold text-emerald-600">{$(totalInvoiced, c.currency)}</div></div>
          <div className="card p-3"><div className="text-[11px] font-bold text-slate-400 uppercase">Utilization</div>
            {c.amount > 0
              ? <div className="text-base font-bold" style={{ color: utilization > 100 ? '#dc2626' : utilization > 90 ? '#d97706' : '#059669' }}>{pct(utilization)}</div>
              : <div className="text-sm font-bold text-slate-400">N/A</div>}
          </div>
          <div className="card p-3"><div className="text-[11px] font-bold text-slate-400 uppercase">Open Anomalies</div>
            <div className={cn("text-base font-bold", linkedAnomalies.length > 0 ? "text-red-600" : "text-emerald-600")}>{linkedAnomalies.length}</div>
          </div>
        </div>

        {/* ═══ UTILIZATION BAR ═══ */}
        {c.amount > 0 && (
          <div className="card p-4 mb-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Spend vs Contract Ceiling</div>
              <div className="text-xs text-slate-500">{$(totalInvoiced, c.currency)} of {$(c.amount, c.currency)}</div>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden relative">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(utilization, 100)}%`, background: utilization > 100 ? '#dc2626' : utilization > 90 ? '#d97706' : utilization > 80 ? '#eab308' : '#10b981' }} />
            </div>
            <div className="flex justify-between mt-1 text-[11px] text-slate-400">
              <span>0%</span>
              <span className="text-amber-500 font-semibold">80% warning</span>
              <span>100%</span>
            </div>
          </div>
        )}

        {/* ═══ KEY ALERTS (time-sensitive) ═══ */}
        {(epd || (optOutDays != null && optOutDays <= 120) || (hl.days_to_expiry != null && hl.days_to_expiry > 0 && hl.days_to_expiry <= 90)) && (
          <div className="space-y-2 mb-5">
            {epd && (
              <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs font-bold">$</div>
                <div><div className="text-sm font-semibold text-emerald-800">Early Payment Discount: {epd.discount_pct}% if paid within {epd.days} days</div>
                <div className="text-xs text-emerald-600">Apply to all invoices from {c.vendor}</div></div>
              </div>
            )}
            {optOutDays != null && optOutDays <= 120 && (
              <div className={cn("flex items-center gap-3 p-3 rounded-xl border", optOutDays <= 30 ? "bg-red-50 border-red-200" : optOutDays <= 60 ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200")}>
                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold", optOutDays <= 30 ? "bg-red-100 text-red-600" : optOutDays <= 60 ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600")}>⏰</div>
                <div><div className={cn("text-sm font-semibold", optOutDays <= 30 ? "text-red-800" : optOutDays <= 60 ? "text-amber-800" : "text-blue-800")}>Auto-renewal opt-out: {optOutDate.toLocaleDateString()} ({optOutDays} days)</div>
                <div className="text-xs text-slate-500">Written notice required to prevent automatic renewal</div></div>
              </div>
            )}
            {hl.days_to_expiry != null && hl.days_to_expiry > 0 && hl.days_to_expiry <= 90 && (
              <div className={cn("flex items-center gap-3 p-3 rounded-xl border", hl.days_to_expiry <= 30 ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200")}>
                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold", hl.days_to_expiry <= 30 ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600")}>📅</div>
                <div><div className={cn("text-sm font-semibold", hl.days_to_expiry <= 30 ? "text-red-800" : "text-amber-800")}>Contract expires in {hl.days_to_expiry} days</div>
                <div className="text-xs text-slate-500">Begin renewal negotiation or source alternative</div></div>
              </div>
            )}
          </div>
        )}

        {/* ═══ THREE COLUMN: Pricing + Details + Invoices ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">

          {/* Column 1: Contracted Pricing Schedule */}
          <div className="card p-4">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Contracted Pricing</div>
            {pricingItems.length > 0 ? (
              <div className="space-y-1.5">
                {pricingItems.map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                    <span className="text-xs text-slate-700 font-medium">{p.item || p.term || `Item ${i+1}`}</span>
                    <span className="text-xs font-bold font-mono text-slate-900">{typeof p.rate === 'number' ? $(p.rate, c.currency) : (p.value || p.rate)}{p.unit ? ` / ${p.unit}` : ''}</span>
                  </div>
                ))}
              </div>
            ) : c.lineItems?.length > 0 ? (
              <div className="space-y-1.5">
                {c.lineItems.map((li, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                    <span className="text-xs text-slate-700 font-medium truncate max-w-[120px]">{li.description || `Item ${i+1}`}</span>
                    <span className="text-xs font-bold font-mono text-slate-900">{(li.unitPrice || li.unit_price) ? $(li.unitPrice || li.unit_price, c.currency) : ''}{li.quantity ? ` × ${li.quantity}` : ''}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400 py-4 text-center">No pricing schedule extracted</div>
            )}
            {c.paymentTerms && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="text-[11px] font-bold text-slate-400 uppercase mb-1">Payment Terms</div>
                <div className="text-sm font-semibold text-slate-800">{c.paymentTerms}</div>
              </div>
            )}
            {linkedPOs.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">Purchase Orders ({linkedPOs.length})</div>
                <div className="space-y-1.5">
                  {linkedPOs.slice(0, 5).map(po => {
                    const match = (s.matches || []).find(m => m.poId === po.id);
                    const matchedInv = match ? (s.docs || []).find(d => d.id === match.invoiceId) : null;
                    return (
                      <div key={po.id} className="bg-slate-50/50 rounded-lg p-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-semibold text-slate-700">{po.poNumber || po.id}</span>
                          <span className="text-xs font-mono font-bold">{$(po.amount, po.currency)}</span>
                        </div>
                        {match && matchedInv && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className={cn("w-1.5 h-1.5 rounded-full", match.matchScore >= 75 ? "bg-emerald-500" : "bg-amber-500")} />
                            <span className="text-[11px] text-slate-500">Matched to <span className="font-semibold">{matchedInv.invoiceNumber || matchedInv.id}</span></span>
                            {match.overInvoiced && <span className="text-[11px] text-red-600 font-bold ml-auto">Over-invoiced</span>}
                          </div>
                        )}
                        {!match && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                            <span className="text-[11px] text-slate-400">No invoice matched</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {linkedPOs.length > 5 && <div className="text-[11px] text-slate-400">+{linkedPOs.length - 5} more</div>}
                </div>
              </div>
            )}
          </div>

          {/* Column 2: Contract Details */}
          <div className="card p-4">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Contract Details</div>
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-[11px] text-slate-400 uppercase">Counterparty</span><span className="text-xs font-semibold text-right max-w-[140px] truncate">{c.vendor || '—'}</span></div>
              <div className="flex justify-between"><span className="text-[11px] text-slate-400 uppercase">Contract #</span><span className="text-xs font-semibold">{c.contractNumber || c.id}</span></div>
              <div className="flex justify-between"><span className="text-[11px] text-slate-400 uppercase">Effective</span><span className="text-xs">{date(c.effectiveDate || c.issueDate)}</span></div>
              <div className="flex justify-between"><span className="text-[11px] text-slate-400 uppercase">End Date</span><span className="text-xs">{date(c.endDate) || '—'}</span></div>
              {c.termMonths && <div className="flex justify-between"><span className="text-[11px] text-slate-400 uppercase">Term</span><span className="text-xs">{c.termMonths} months</span></div>}
              {c.autoRenewal != null && <div className="flex justify-between"><span className="text-[11px] text-slate-400 uppercase">Auto-Renewal</span><span className="text-xs">{c.autoRenewal ? `Yes (${c.renewalNoticeDays || '?'}d notice)` : 'No'}</span></div>}
              {c.liabilityCap && <div className="flex justify-between"><span className="text-[11px] text-slate-400 uppercase">Liability Cap</span><span className="text-xs font-mono">{$(c.liabilityCap, c.currency)}</span></div>}
              {c.governingLaw && <div className="flex justify-between"><span className="text-[11px] text-slate-400 uppercase">Governing Law</span><span className="text-xs">{c.governingLaw}</span></div>}
              {c.slaSummary && <div className="mt-2 pt-2 border-t border-slate-100"><div className="text-[11px] text-slate-400 uppercase mb-0.5">SLA</div><div className="text-xs text-slate-700">{c.slaSummary}</div></div>}
              {c.penaltyClauses && <div className="mt-2 pt-2 border-t border-slate-100"><div className="text-[11px] text-slate-400 uppercase mb-0.5">Penalties</div><div className="text-xs text-slate-700">{c.penaltyClauses}</div></div>}
            </div>
          </div>

          {/* Column 3: Invoices Against This Contract */}
          <div className="card p-4">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Invoices <Badge c="muted">{linkedInvoices.length}</Badge></div>
            {linkedInvoices.length === 0 ? (
              <div className="text-xs text-slate-400 py-6 text-center">No invoices found for this vendor</div>
            ) : (
              <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                {linkedInvoices.map(inv => {
                  const invAnoms = allAnomalies.filter(a => a.invoiceId === inv.id && a.status === 'open');
                  return (
                    <div key={inv.id} className={cn("flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors", invAnoms.length > 0 ? "bg-red-50 hover:bg-red-100 border border-red-100" : "bg-slate-50 hover:bg-slate-100")} onClick={() => d({ type: 'SEL', doc: inv })}>
                      <div>
                        <div className="text-[11px] font-semibold">{inv.invoiceNumber || inv.id}</div>
                        <div className="text-[11px] text-slate-400">{date(inv.issueDate)}</div>
                        {invAnoms.length > 0 && <div className="text-[11px] font-bold text-red-600 mt-0.5">{invAnoms.map(a => (a.type||'').replace(/_/g,' ')).join(', ')}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-bold font-mono">{$(inv.amount, inv.currency)}</div>
                        <Badge c={inv.triageLane === 'BLOCK' ? 'err' : inv.triageLane === 'AUTO_APPROVE' ? 'ok' : 'warn'}>{inv.triageLane || (inv.status || 'pending').replace(/_/g, ' ')}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {linkedInvoices.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-xs">
                <span className="text-slate-500">Total invoiced</span>
                <span className="font-bold font-mono">{$(totalInvoiced, c.currency)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ═══ AP CHECKLIST — what matters when the next invoice arrives ═══ */}
        {obligations.length > 0 && (() => {
          // Separate AP-actionable obligations from procurement/legal ones
          const apTypes = ['payment_terms', 'early_payment_discount', 'pricing', 'rate', 'volume', 'utilization', 'spend', 'invoice', 'billing'];
          const apObs = obligations.filter(ob => {
            const t = (ob.type || '').toLowerCase();
            const o = (ob.obligation || '').toLowerCase();
            // AP owns: payment terms, EPD, pricing/rate checks, utilization, invoice-related
            return ob.party === 'buyer' && (
              apTypes.some(k => t.includes(k) || o.includes(k)) ||
              o.includes('payment') || o.includes('discount') || o.includes('net ') ||
              o.includes('per invoice') || o.includes('utilization') || o.includes('rate')
            );
          });
          const procObs = obligations.filter(ob => !apObs.includes(ob));

          return (
            <>
              {/* AP Invoice Checklist — always visible */}
              {apObs.length > 0 && (
                <div className="card p-4 mb-5 border-l-4 border-blue-400">
                  <div className="flex items-center gap-2 mb-3">
                    <ClipboardList className="w-4 h-4 text-blue-500" />
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Invoice Processing Checklist</h3>
                    <span className="text-[11px] text-slate-400">Check these when processing invoices for this vendor</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {apObs.map((ob, i) => (
                      <div key={i} className={cn('flex items-center justify-between p-3 rounded-lg border', ob.urgency === 'high' ? 'bg-red-50 border-red-200' : ob.urgency === 'medium' ? 'bg-amber-50 border-amber-200' : 'bg-blue-50/50 border-blue-200')}>
                        <div>
                          <div className="text-sm font-medium text-slate-800">{ob.obligation}</div>
                          <div className="text-xs text-slate-500">{ob.frequency || ob.type?.replace(/_/g, ' ')}</div>
                        </div>
                        {ob.days_left != null && <div className={cn('text-sm font-bold ml-2', ob.days_left <= 14 ? 'text-red-600' : ob.days_left <= 45 ? 'text-amber-600' : 'text-slate-400')}>{ob.days_left}d</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Procurement/Legal obligations — collapsed, not AP's job */}
              {procObs.length > 0 && (
                <details className="card mb-5 overflow-hidden">
                  <summary className="flex items-center gap-2 p-4 cursor-pointer hover:bg-slate-50 transition-colors">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Vendor & Contract Obligations</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{procObs.length}</span>
                    <span className="text-[11px] text-slate-400 ml-1">→ Procurement / Legal</span>
                  </summary>
                  <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {procObs.map((ob, i) => (
                        <div key={i} className={cn('flex items-center justify-between p-2.5 rounded-lg border', ob.urgency === 'high' ? 'bg-red-50 border-red-200' : ob.urgency === 'medium' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200')}>
                          <div>
                            <div className="text-xs font-medium text-slate-700">{ob.obligation}</div>
                            <div className="text-[11px] text-slate-500">{ob.party === 'buyer' ? '📋 Your obligation' : '📦 Vendor obligation'} · {ob.frequency || ob.type?.replace(/_/g, ' ')}</div>
                          </div>
                          {ob.days_left != null && <div className={cn('text-sm font-bold ml-2', ob.days_left <= 14 ? 'text-red-600' : ob.days_left <= 45 ? 'text-amber-600' : 'text-slate-400')}>{ob.days_left}d</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              )}
            </>
          );
        })()}

        {loadingAnalysis && (
          <div className="card p-6 text-center mb-5">
            <div className="w-6 h-6 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin mx-auto mb-2" />
            <div className="text-xs text-slate-400">Analyzing contract clauses...</div>
          </div>
        )}

        {/* ═══ COLLAPSIBLE: Legal Risk Summary (for CFO/Auditor) ═══ */}
        {clauses.length > 0 && (
          <div className="card mb-5 overflow-hidden">
            <button onClick={() => setShowClauses(!showClauses)} className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-left">
              <div className="flex items-center gap-2">
                <Brain className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Legal Risk Summary</span>
                {an.risk_score != null && <span className={cn('text-[11px] font-bold px-1.5 py-0.5 rounded-full', an.risk_level === 'high' ? 'bg-red-100 text-red-700' : an.risk_level === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>{an.risk_level === 'high' ? 'High Risk' : an.risk_level === 'medium' ? 'Medium Risk' : 'Low Risk'}</span>}
                <span className="text-[11px] text-slate-400">{clauses.length} clauses analyzed</span>
              </div>
              <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", showClauses && "rotate-180")} />
            </button>
            {showClauses && (
              <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                <div className="text-[11px] text-slate-400 mb-3 italic">Clause analysis feeds vendor risk scoring and triage thresholds automatically</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {clauses.map((cl, i) => (
                    <div key={i} className={cn('p-3 rounded-lg border-l-[3px]', cl.risk === 'high' ? 'border-red-500 bg-red-50/50' : cl.risk === 'medium' ? 'border-amber-400 bg-amber-50/50' : 'border-emerald-400 bg-emerald-50/30')}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold text-slate-600 uppercase">{(cl.type || '').replace(/_/g, ' ')}</span>
                        {riskBadge(cl.risk)}
                      </div>
                      <div className="text-xs text-slate-700 font-medium">{cl.summary}</div>
                      <div className="text-[11px] text-slate-400 mt-1">Benchmark: {cl.benchmark}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Contract List with Health Scores
  const getHealth = (cid) => healthData.find(h => h.id === cid);

  const runLifecycle = async () => {
    setLifecycleRunning(true);
    try {
      const r = await post('/api/contracts/lifecycle-check', {});
      setLifecycleResult(r);
      const dash = await api('/api/dashboard');
      if (dash && !dash._err) d({ type: 'DASHBOARD', data: dash });
    } catch (e) { console.error(e); }
    setLifecycleRunning(false);
    setTimeout(() => setLifecycleResult(null), 10000);
  };

  const loadReport = async () => {
    const r = await api('/api/contracts/intelligence-report');
    if (r && !r._err) { setIntelReport(r); setShowReport(true); }
  };

  // AP cases only — over-utilization (the one lifecycle event AP owns)
  const allCases = s.casesData || [];
  const utilizationCases = allCases.filter(c => c.type === 'over_utilization' && c.status !== 'closed' && c.status !== 'resolved');

  return (
    <div className="page-enter">
      <PageHeader title="Contracts" sub={`${contracts.length} vendor contracts`}>
        <button onClick={() => d({ type: 'TAB', tab: 'upload' })} className="btn-p"><Upload className="w-4 h-4" /> Upload Contract</button>
      </PageHeader>

      {/* Lifecycle run result banner */}
      {lifecycleResult && (
        <div className={cn("p-3 rounded-xl mb-4 text-sm font-medium border",
          (lifecycleResult.cases_created?.length > 0 || lifecycleResult.alerts_generated?.length > 0)
            ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200")}>
          <div>{lifecycleResult.cases_created?.length > 0
            ? `${lifecycleResult.cases_created.length} AP case${lifecycleResult.cases_created.length > 1 ? 's' : ''} created (over-utilization)`
            : 'No AP cases needed'}</div>
          {lifecycleResult.alerts_generated?.length > 0 && (
            <div className="text-xs mt-1 text-slate-600">
              {lifecycleResult.alerts_generated.length} intelligence alert{lifecycleResult.alerts_generated.length > 1 ? 's' : ''} for CFO/Procurement:
              {' '}{lifecycleResult.alerts_generated.map(a => a.headline).join(' · ')}
            </div>
          )}
        </div>
      )}

      {/* AP Cases: Over-Utilization Only (the one AP owns) */}
      {utilizationCases.length > 0 && (
        <div className="card p-4 mb-4 border-l-4 border-red-400">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-3.5 h-3.5 text-red-500" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Contract Ceiling Breaches</span>
            <Badge c="err">{utilizationCases.length}</Badge>
          </div>
          <div className="text-[11px] text-slate-400 mb-2">Invoices approaching or exceeding contract value — AP action required</div>
          <div className="space-y-1.5">
            {utilizationCases.map(uc => (
              <div key={uc.id} className="flex items-center justify-between p-2.5 bg-red-50 rounded-lg border border-red-100 cursor-pointer hover:bg-red-100"
                onClick={() => d({ type: 'TAB', tab: 'cases' })}>
                <div>
                  <div className="text-xs font-semibold text-slate-800">{uc.title}</div>
                  <div className="text-[11px] text-slate-500">{uc.vendor} · {uc.id}</div>
                </div>
                <Badge c={uc.priority === 'critical' ? 'err' : 'warn'}>{uc.priority}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Intelligence Report Modal (for CFO/Procurement, not AP) */}
      {showReport && intelReport && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowReport(false)}>
          <div className="card w-full max-w-[720px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white p-6 rounded-t-2xl">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xl font-bold">Contract Intelligence Briefing</div>
                  <div className="text-sm text-slate-300 mt-1">{intelReport.period}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => {
                    const secs = intelReport.sections || {};
                    const exp = secs.expiring_contracts;
                    const risk = secs.portfolio_risk;
                    const epd = secs.early_payment_discounts;
                    const alerts = secs.lifecycle_alerts;
                    const hasExpiring = exp?.count > 0;
                    const hasEPD = (epd?.captured || 0) > 0 || (epd?.missed || 0) > 0;
                    const clauseDetails = risk?.high_risk_clause_details || [];
                    const worstContracts = (risk?.worst_contracts || []).filter(w => w.health_level !== 'good' || w.high_risk_clauses > 0);

                    // Group clauses by contract
                    const clausesByContract = {};
                    clauseDetails.forEach(cl => { if (!clausesByContract[cl.contract]) clausesByContract[cl.contract] = []; clausesByContract[cl.contract].push(cl); });

                    const w = window.open('', '_blank', 'width=820,height=1000');
                    w.document.write(`<!DOCTYPE html><html><head><title>Contract Intelligence Briefing — ${intelReport.period}</title>
<style>
  @page { size: A4; margin: 24mm 20mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5; padding: 40px 48px; max-width: 760px; margin: 0 auto; }
  
  .header { background: linear-gradient(135deg, #1e293b, #334155); color: white; padding: 28px 32px; border-radius: 12px; margin-bottom: 28px; }
  .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
  .header .period { font-size: 13px; color: #94a3b8; }
  .header .summary { margin-top: 16px; padding: 12px 16px; background: rgba(255,255,255,0.1); border-radius: 8px; font-size: 13px; line-height: 1.6; }
  
  .section { margin-bottom: 24px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; }
  .section-title.action { color: #dc2626; border-color: #fca5a5; }
  
  .action-card { padding: 12px 16px; border-radius: 8px; border-left: 4px solid #f59e0b; background: #fffbeb; margin-bottom: 8px; }
  .action-card.critical { border-left-color: #ef4444; background: #fef2f2; }
  .action-card .text { font-size: 14px; font-weight: 600; }
  .action-card .rec { font-size: 13px; color: #4f46e5; margin-top: 4px; }
  .action-card .owner { float: right; font-size: 11px; color: #94a3b8; background: rgba(0,0,0,.04); padding: 2px 10px; border-radius: 12px; }
  
  .green-banner { padding: 14px 18px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; font-size: 13px; font-weight: 600; color: #065f46; }
  
  .pills { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .pill { padding: 8px 18px; border-radius: 10px; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
  .pill b { font-size: 18px; }
  .pill.green { background: #ecfdf5; color: #059669; } .pill.amber { background: #fffbeb; color: #d97706; }
  .pill.red { background: #fef2f2; color: #dc2626; } .pill.slate { background: #f1f5f9; color: #475569; }
  
  .contract-group { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 10px; }
  .contract-header { padding: 10px 16px; font-size: 14px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; }
  .contract-header.warning { background: #fffbeb; }
  .contract-header.critical { background: #fef2f2; }
  .contract-header.healthy { background: #f8fafc; }
  .contract-header .score { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
  .score.warning { background: #fef3c7; color: #92400e; } .score.critical { background: #fecaca; color: #991b1b; } .score.healthy { background: #e2e8f0; color: #475569; }
  .contract-number { font-size: 12px; color: #64748b; font-weight: 400; margin-left: 8px; }
  
  .clause-row { padding: 8px 16px; font-size: 13px; border-top: 1px solid #f1f5f9; display: flex; gap: 10px; align-items: flex-start; }
  .clause-dot { width: 6px; height: 6px; border-radius: 50%; background: #f97316; margin-top: 6px; flex-shrink: 0; }
  .clause-type { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #ea580c; margin-bottom: 1px; }
  
  .epd-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 8px; }
  .epd-box { text-align: center; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; }
  .epd-box .val { font-size: 20px; font-weight: 700; } .epd-box .lbl { font-size: 11px; color: #64748b; margin-top: 2px; }
  .epd-box.green { background: #ecfdf5; } .epd-box.green .val { color: #059669; }
  .epd-box.amber { background: #fffbeb; } .epd-box.amber .val { color: #d97706; }
  
  .action-line { font-size: 13px; color: #4f46e5; font-weight: 600; margin-top: 6px; }
  .footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print { body { padding: 0; } .header { page-break-inside: avoid; } .contract-group { page-break-inside: avoid; } }
</style></head><body>

<div class="header">
  <h1>Contract Intelligence Briefing</h1>
  <div class="period">${intelReport.period}</div>
  <div class="summary">${intelReport.summary_line}</div>
</div>

${hasExpiring ? `
<div class="section">
  <div class="section-title action">⚠ Action Required</div>
  ${(exp.items || []).map(e => `
    <div class="action-card${e.days_left <= 30 ? ' critical' : ''}">
      <span class="owner">${e.days_left <= 30 ? 'Urgent — ' : ''}Procurement</span>
      <div class="text">${e.vendor} (${e.number}) — expires in ${e.days_left} days</div>
      <div class="rec">→ Begin renewal negotiation or source alternatives</div>
    </div>
  `).join('')}
</div>` : `
<div class="section"><div class="green-banner">✓ No immediate action required. All contracts within acceptable parameters.</div></div>`}

${risk ? `
<div class="section">
  <div class="section-title">Portfolio Health</div>
  <div class="pills">
    <div class="pill green"><b>${risk.healthy}</b> Healthy</div>
    <div class="pill amber"><b>${risk.warning}</b> Warning</div>
    <div class="pill red"><b>${risk.critical}</b> Critical</div>
  </div>
  ${worstContracts.length > 0 ? `
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Contracts Requiring Review</div>
    ${worstContracts.sort((a,b) => a.health_score - b.health_score).map(wc => `
      <div class="contract-group">
        <div class="contract-header ${wc.health_level}">
          <div>${wc.vendor}<span class="contract-number">${wc.contract}</span></div>
          <span class="score ${wc.health_level}">Health: ${wc.health_score}/100</span>
        </div>
        ${(clausesByContract[wc.contract] || []).map(cl => `
          <div class="clause-row">
            <div class="clause-dot"></div>
            <div><div class="clause-type">${cl.clause_type}</div><div>${cl.summary}</div></div>
          </div>
        `).join('')}
      </div>
    `).join('')}
  ` : ''}
  ${risk.action ? `<div class="action-line">→ ${risk.action}</div>` : ''}
</div>` : ''}

${hasEPD ? `
<div class="section">
  <div class="section-title">Early Payment Discount Performance</div>
  <div class="epd-grid">
    <div class="epd-box green"><div class="val">$${(epd.captured || 0).toLocaleString()}</div><div class="lbl">Captured</div></div>
    <div class="epd-box amber"><div class="val">$${(epd.missed || 0).toLocaleString()}</div><div class="lbl">Missed</div></div>
    <div class="epd-box"><div class="val">${epd.capture_rate_pct || 0}%</div><div class="lbl">Capture Rate</div></div>
  </div>
  ${epd.action ? `<div class="action-line">→ ${epd.action}</div>` : ''}
</div>` : ''}

<div class="footer">Generated by AuditLens · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
</body></html>`);
                    w.document.close();
                    setTimeout(() => w.print(), 600);
                  }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm font-medium" title="Print / Save as PDF">
                    <Download className="w-3.5 h-3.5" /> PDF
                  </button>
                  <button onClick={() => {
                    const secs = intelReport.sections || {};
                    const exp = secs.expiring_contracts;
                    const risk = secs.portfolio_risk;
                    const lines = [`Contract Intelligence Briefing — ${intelReport.period}`, '', intelReport.summary_line, ''];
                    if (exp?.count > 0) {
                      lines.push('ACTION REQUIRED:');
                      (exp.items || []).forEach(e => lines.push(`  • ${e.vendor} (${e.number}) expires in ${e.days_left} days → Begin renewal`));
                      lines.push('');
                    }
                    if (risk) {
                      lines.push(`PORTFOLIO: ${risk.healthy} Healthy, ${risk.warning} Warning, ${risk.critical} Critical`);
                      const clausesByC = {};
                      (risk.high_risk_clause_details || []).forEach(cl => { if (!clausesByC[cl.contract]) clausesByC[cl.contract] = []; clausesByC[cl.contract].push(cl); });
                      const worst = (risk.worst_contracts || []).filter(w => w.health_level !== 'good' || w.high_risk_clauses > 0);
                      if (worst.length > 0) {
                        lines.push('', 'Contracts Requiring Review:');
                        worst.sort((a,b) => a.health_score - b.health_score).forEach(w => {
                          lines.push(`  ${w.vendor} (${w.contract}) — Health: ${w.health_score}/100`);
                          (clausesByC[w.contract] || []).forEach(cl => lines.push(`    • ${cl.clause_type}: ${cl.summary}`));
                        });
                      }
                      lines.push('');
                    }
                    lines.push(`Generated by AuditLens · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
                    const body = encodeURIComponent(lines.join('\n'));
                    const subject = encodeURIComponent(`Contract Intelligence Briefing — ${intelReport.period}`);
                    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
                  }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm font-medium" title="Email briefing">
                    <Send className="w-3.5 h-3.5" /> Email
                  </button>
                  <button onClick={() => setShowReport(false)} className="p-2 rounded-lg hover:bg-white/10 transition-colors"><X className="w-4 h-4 text-white/60" /></button>
                </div>
              </div>
              <div className="mt-4 p-3 bg-white/10 rounded-xl text-sm font-medium leading-relaxed">
                {intelReport.summary_line}
              </div>
            </div>

            <div id="intel-report-content" className="p-6 space-y-6">
              {/* ACTION REQUIRED — only sections that need decisions */}
              {(() => {
                const secs = intelReport.sections || {};
                const expiring = secs.expiring_contracts;
                const util = secs.utilization;
                const epd = secs.early_payment_discounts;
                const risk = secs.portfolio_risk;
                const alerts = secs.lifecycle_alerts;

                const hasExpiring = expiring?.count > 0;
                const hasUtilization = (util?.items || []).length > 0;
                const hasEPD = (epd?.captured || 0) > 0 || (epd?.missed || 0) > 0;
                const hasAlerts = (alerts?.items || []).length > 0;
                const hasCriticalRisk = (risk?.critical || 0) > 0 || (risk?.high_risk_clauses_total || 0) > 4;

                const actionItems = [];
                if (hasExpiring) actionItems.push(...(expiring.items || []).map(e => ({
                  urgency: e.days_left <= 30 ? 'critical' : 'warning',
                  text: `${e.vendor} (${e.number}) expires in ${e.days_left} days`,
                  action: 'Begin renewal negotiation',
                  owner: 'Procurement',
                })));
                if (hasUtilization) actionItems.push(...(util.items || []).map(u => ({
                  urgency: u.status === 'exceeded' ? 'critical' : 'warning',
                  text: `${u.vendor} at ${u.utilization_pct}% utilization`,
                  action: u.status === 'exceeded' ? 'Amend contract ceiling' : 'Monitor closely',
                  owner: 'Finance / Procurement',
                })));

                return (
                  <>
                    {/* Section 1: Action Items */}
                    {actionItems.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Action Required</h3>
                        </div>
                        <div className="space-y-2">
                          {actionItems.sort((a,b) => (a.urgency === 'critical' ? 0 : 1) - (b.urgency === 'critical' ? 0 : 1)).map((item, i) => (
                            <div key={i} className={cn("p-3 rounded-xl border-l-4", item.urgency === 'critical' ? "border-red-500 bg-red-50" : "border-amber-400 bg-amber-50")}>
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">{item.text}</div>
                                  <div className="text-sm text-slate-600 mt-1">→ <span className="font-semibold">{item.action}</span></div>
                                </div>
                                <span className="text-[11px] px-2 py-1 bg-white/80 rounded-full text-slate-500 font-medium whitespace-nowrap">{item.owner}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* No actions needed */}
                    {actionItems.length === 0 && (
                      <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                        <div className="text-sm font-medium text-emerald-800">No immediate action required. All contracts within acceptable parameters.</div>
                      </div>
                    )}

                    {/* Section 2: EPD Performance — only if there's data */}
                    {hasEPD && (
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Early Payment Discount Performance</h3>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-4 bg-emerald-50 rounded-xl text-center border border-emerald-100">
                            <div className="text-2xl font-bold text-emerald-600">${(epd.captured || 0).toLocaleString()}</div>
                            <div className="text-xs text-slate-500 mt-1 font-medium">Captured</div>
                          </div>
                          <div className="p-4 bg-amber-50 rounded-xl text-center border border-amber-100">
                            <div className="text-2xl font-bold text-amber-600">${(epd.missed || 0).toLocaleString()}</div>
                            <div className="text-xs text-slate-500 mt-1 font-medium">Missed</div>
                          </div>
                          <div className="p-4 bg-slate-50 rounded-xl text-center border border-slate-200">
                            <div className="text-2xl font-bold text-slate-800">{epd.capture_rate_pct || 0}%</div>
                            <div className="text-xs text-slate-500 mt-1 font-medium">Capture Rate</div>
                          </div>
                        </div>
                        {epd.action && <div className="text-sm text-indigo-600 font-medium mt-2">→ {epd.action}</div>}
                      </div>
                    )}

                    {/* Section 3: Portfolio Health — with contract drill-down */}
                    {risk && (
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Portfolio Health</h3>
                        <div className="flex gap-3 flex-wrap mb-3">
                          <div className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl border", risk.critical > 0 ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-100")}>
                            <div className={cn("text-xl font-bold", risk.critical > 0 ? "text-red-600" : "text-emerald-600")}>{risk.healthy}</div>
                            <div className="text-xs text-slate-500 font-medium">Healthy</div>
                          </div>
                          <div className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl border", risk.warning > 0 ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200")}>
                            <div className={cn("text-xl font-bold", risk.warning > 0 ? "text-amber-600" : "text-slate-400")}>{risk.warning}</div>
                            <div className="text-xs text-slate-500 font-medium">Warning</div>
                          </div>
                          <div className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl border", risk.critical > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200")}>
                            <div className={cn("text-xl font-bold", risk.critical > 0 ? "text-red-600" : "text-slate-400")}>{risk.critical}</div>
                            <div className="text-xs text-slate-500 font-medium">Critical</div>
                          </div>
                        </div>

                        {/* Grouped by contract — each contract shows its health + its clauses together */}
                        {(() => {
                          const clauseDetails = risk.high_risk_clause_details || [];
                          const worstContracts = (risk.worst_contracts || []).filter(w => w.health_level !== 'good' || w.high_risk_clauses > 0);
                          if (worstContracts.length === 0) return null;

                          // Group clauses by contract number
                          const clausesByContract = {};
                          clauseDetails.forEach(cl => {
                            const key = cl.contract;
                            if (!clausesByContract[key]) clausesByContract[key] = [];
                            clausesByContract[key].push(cl);
                          });

                          return (
                            <div>
                              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Contracts Requiring Review</div>
                              <div className="space-y-3">
                                {worstContracts.sort((a,b) => a.health_score - b.health_score).map((w, i) => (
                                  <div key={i} className={cn("rounded-xl border overflow-hidden",
                                    w.health_level === 'critical' ? 'border-red-200' : w.health_level === 'warning' ? 'border-amber-200' : 'border-orange-200')}>
                                    {/* Contract header */}
                                    <div className={cn("flex items-center justify-between p-3",
                                      w.health_level === 'critical' ? 'bg-red-50' : w.health_level === 'warning' ? 'bg-amber-50' : 'bg-orange-50/50')}>
                                      <div>
                                        <span className="text-sm font-bold text-slate-900">{w.vendor}</span>
                                        <span className="text-xs text-slate-500 ml-2">{w.contract}</span>
                                      </div>
                                      <div className={cn("text-xs font-bold px-2.5 py-1 rounded-full",
                                        w.health_level === 'critical' ? 'bg-red-100 text-red-700' :
                                        w.health_level === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')}>
                                        Health: {w.health_score}/100
                                      </div>
                                    </div>
                                    {/* Clause details for this contract */}
                                    {(clausesByContract[w.contract] || []).length > 0 && (
                                      <div className="border-t border-inherit">
                                        {(clausesByContract[w.contract] || []).map((cl, j) => (
                                          <div key={j} className={cn("px-4 py-2.5 flex items-start gap-3", j > 0 && "border-t border-slate-100")}>
                                            <div className="w-1 h-1 rounded-full bg-orange-400 mt-2 flex-shrink-0" />
                                            <div>
                                              <span className="text-[11px] font-bold text-orange-600 uppercase">{cl.clause_type}</span>
                                              <div className="text-sm text-slate-700">{cl.summary}</div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {risk.action && <div className="text-sm text-indigo-600 font-medium mt-3">→ {risk.action}</div>}
                      </div>
                    )}

                    {/* Section 4: Active Alerts — only if there are any */}
                    {hasAlerts && (
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Active Lifecycle Alerts</h3>
                        <div className="space-y-2">
                          {(alerts.items || []).slice(0, 6).map((a, i) => (
                            <div key={i} className={cn("flex items-center justify-between p-3 rounded-xl border", a.urgency === 'critical' ? 'bg-red-50 border-red-100' : a.urgency === 'high' ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100')}>
                              <div className="text-sm font-medium text-slate-800">{a.headline}</div>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-slate-400">{a.audience}</span>
                                <Badge c={a.urgency === 'critical' ? 'err' : a.urgency === 'high' ? 'warn' : 'muted'}>{a.urgency}</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Intelligence Summary Bar */}
      {healthData.length > 0 && (
        <div className="flex gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-xl border border-emerald-100">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-semibold text-emerald-700">{healthData.filter(h => h.health_level === 'good').length} Healthy</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-xl border border-amber-100">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-xs font-semibold text-amber-700">{healthData.filter(h => h.health_level === 'warning').length} Warning</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-xl border border-red-100">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs font-semibold text-red-700">{healthData.filter(h => h.health_level === 'critical').length} Critical</span>
          </div>
        </div>
      )}

      {/* Intel Report — VP/CFO only */}
      {(RL[s.user?.role] || 0) >= 2 && (
        <div className="mb-4">
          <button onClick={loadReport} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700 transition-all shadow-sm">
            <FileCheck className="w-4 h-4" /> View Intelligence Briefing
          </button>
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-[360px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by vendor or contract number..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            className="w-full pl-10 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-accent-300 focus:border-accent-400"
          />
          {searchQ && (
            <button onClick={() => setSearchQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-slate-100">
              <X className="w-3.5 h-3.5 text-slate-400" />
            </button>
          )}
        </div>

        {/* Status filters */}
        <div className="flex gap-1.5 items-center">
          <span className="text-[11px] text-slate-400 font-medium mr-1">Status</span>
          {[
            { key: 'all', label: 'All' },
            { key: 'active', label: 'Active', color: 'bg-emerald-100 text-emerald-700' },
            { key: 'expiring', label: 'Expiring', color: 'bg-amber-100 text-amber-700' },
            { key: 'expired', label: 'Expired', color: 'bg-red-100 text-red-700' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setHealthFilter(healthFilter === f.key ? 'all' : f.key)}
              className={cn("px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                healthFilter === f.key
                  ? (f.color || 'bg-slate-200 text-slate-700') + ' ring-2 ring-offset-1 ring-slate-300'
                  : 'bg-slate-50 text-slate-400 hover:bg-slate-100')}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-200" />

        {/* Type filter */}
        <div className="flex gap-1.5 items-center">
          <span className="text-[11px] text-slate-400 font-medium mr-1">Type</span>
          {[
            { key: 'fixed', label: 'Fixed Value', color: 'bg-blue-100 text-blue-700' },
            { key: 'rate', label: 'Rate', color: 'bg-indigo-100 text-indigo-700' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(typeFilter === f.key ? 'all' : f.key)}
              className={cn("px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                typeFilter === f.key
                  ? f.color + ' ring-2 ring-offset-1 ring-slate-300'
                  : 'bg-slate-50 text-slate-400 hover:bg-slate-100')}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-200" />

        {/* Clause Risk filter */}
        <div className="flex gap-1.5 items-center">
          <span className="text-[11px] text-slate-400 font-medium mr-1">Risk</span>
          {[
            { key: 'high', label: 'High', color: 'bg-red-100 text-red-700' },
            { key: 'medium', label: 'Medium', color: 'bg-amber-100 text-amber-700' },
            { key: 'low', label: 'Low', color: 'bg-emerald-100 text-emerald-700' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setRiskFilter(riskFilter === f.key ? 'all' : f.key)}
              className={cn("px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                riskFilter === f.key
                  ? f.color + ' ring-2 ring-offset-1 ring-slate-300'
                  : 'bg-slate-50 text-slate-400 hover:bg-slate-100')}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Clear all — only show when filters active */}
        {(searchQ || healthFilter !== 'all' || typeFilter !== 'all' || riskFilter !== 'all') && (
          <button onClick={() => { setSearchQ(''); setHealthFilter('all'); setTypeFilter('all'); setRiskFilter('all'); }}
            className="text-xs text-slate-400 hover:text-slate-600 font-medium underline underline-offset-2 ml-1">
            Clear all
          </button>
        )}
      </div>

      {/* Filtered contracts */}
      {(() => {
        const q = searchQ.toLowerCase().trim();
        let filtered = contracts;

        // Text search
        if (q) {
          filtered = filtered.filter(r =>
            (r.vendor || '').toLowerCase().includes(q) ||
            (r.contractNumber || r.invoiceNumber || r.id || '').toLowerCase().includes(q)
          );
        }

        // Status filter
        if (healthFilter !== 'all') {
          filtered = filtered.filter(r => {
            const st = getStatus(r);
            if (healthFilter === 'active') return st.label === 'Active';
            if (healthFilter === 'expiring') return st.label.startsWith('Expiring');
            if (healthFilter === 'expired') return st.label === 'Expired';
            return true;
          });
        }

        // Type filter
        if (typeFilter !== 'all') {
          filtered = filtered.filter(r => {
            if (typeFilter === 'rate') return !r.amount || r.amount === 0;
            if (typeFilter === 'fixed') return r.amount > 0;
            return true;
          });
        }

        // Clause risk filter
        if (riskFilter !== 'all') {
          filtered = filtered.filter(r => {
            const h = getHealth(r.id);
            if (!h) return false;
            const cr = h.clause_risk;
            if (riskFilter === 'high') return cr >= 60;
            if (riskFilter === 'medium') return cr >= 30 && cr < 60;
            if (riskFilter === 'low') return cr < 30;
            return true;
          });
        }

        const anyFilter = q || healthFilter !== 'all' || typeFilter !== 'all' || riskFilter !== 'all';

        return (
          <>
            {anyFilter && (
              <div className="text-xs text-slate-500 mb-2">
                Showing {filtered.length} of {contracts.length} contracts
                {q && <span> matching "<span className="font-semibold">{searchQ}</span>"</span>}
              </div>
            )}
            <Table
              cols={[
                { label: 'Contract', render: r => <div><div className="font-semibold text-sm">{r.contractNumber || r.invoiceNumber || r.id}</div><div className="text-xs text-slate-500">{r.vendor}</div></div> },
                { label: 'Health', center: true, render: r => { const h = getHealth(r.id); if (!h) return <span className="text-slate-400">—</span>; return <HealthRing score={h.health_score} size={38} />; }},
                { label: 'Status', center: true, render: r => { const st = getStatus(r); return <Badge c={st.color}>{st.label}</Badge>; }},
                { label: 'Value', right: true, render: r => r.amount > 0 ? <span className="font-semibold text-sm font-mono">{$(r.amount, r.currency)}</span> : <span className="text-sm font-semibold text-blue-600">Rate Contract</span> },
                { label: 'Clause Risk', center: true, render: r => { const h = getHealth(r.id); if (!h) return '—'; const cr = h.clause_risk; return <span className={cn('text-sm font-bold', cr >= 60 ? 'text-red-600' : cr >= 30 ? 'text-amber-600' : 'text-emerald-600')}>{cr >= 60 ? 'High' : cr >= 30 ? 'Medium' : 'Low'}</span>; }},
                { label: 'Expiry', center: true, render: r => { const h = getHealth(r.id); if (!h?.days_to_expiry) return '—'; return <span className={cn('text-sm font-bold', h.days_to_expiry <= 30 ? 'text-red-600' : h.days_to_expiry <= 90 ? 'text-amber-600' : 'text-slate-600')}>{h.days_to_expiry}d</span>; }},
                { label: 'Confidence', center: true, render: r => <ConfidenceRing score={r.confidence || 0} /> },
              ]}
              rows={filtered}
              onRow={r => setSel(r)}
            />
            {filtered.length === 0 && (
              <div className="text-center py-12 text-slate-400 text-sm">
                No contracts match your filters. <button onClick={() => { setSearchQ(''); setHealthFilter('all'); setTypeFilter('all'); setRiskFilter('all'); }} className="text-accent-600 font-semibold hover:underline">Clear filters</button>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   AUDIT TRAIL
   ═══════════════════════════════════════════════════ */
function AuditTrail() {
  const { s, toast } = useStore();
  const [log, setLog] = useState([]);
  const [counts, setCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const url = filter ? `/api/activity-log?limit=200&action=${filter}` : '/api/activity-log?limit=200';
    const r = await api(url);
    if (r && !r._err) { setLog(r.log || []); setCounts(r.action_counts || {}); setTotal(r.total || 0); }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const actionMeta = {
    document_uploaded: { icon: Upload, color: '#2563eb', label: 'Document Uploaded' },
    anomalies_detected: { icon: AlertTriangle, color: '#f59e0b', label: 'Anomalies Detected' },
    anomaly_resolved: { icon: Check, color: '#10b981', label: 'Anomaly Resolved' },
    anomaly_dismissed: { icon: X, color: '#6b7280', label: 'Anomaly Dismissed' },
    case_created: { icon: ClipboardList, color: '#8b5cf6', label: 'Case Created' },
    case_auto_resolved: { icon: CheckCircle2, color: '#10b981', label: 'Case Auto-Resolved' },
    status_changed: { icon: RefreshCw, color: '#3b82f6', label: 'Status Changed' },
    policy_updated: { icon: Settings, color: '#6366f1', label: 'Policy Updated' },
    policy_preset_applied: { icon: RotateCcw, color: '#6366f1', label: 'Preset Applied' },
    escalation_matrix_updated: { icon: Users, color: '#d97706', label: 'Escalation Matrix Updated' },
    lifecycle_case_created: { icon: AlertCircle, color: '#ef4444', label: 'Lifecycle Alert' },
    extraction_failed: { icon: XCircle, color: '#ef4444', label: 'Extraction Failed' },
    manual_entry: { icon: Edit3, color: '#0ea5e9', label: 'Manual Entry' },
    grn_matched: { icon: Link2, color: '#059669', label: 'GRN Matched' },
  };

  const topActions = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div className="page-enter space-y-6">
      <PageHeader title="Audit Trail" sub={`${total} events logged`}>
        <button onClick={load} className="btn-o text-xs"><RefreshCw className="w-3 h-3" /> Refresh</button>
      </PageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Events', value: total, color: '#3b82f6' },
          { label: 'Documents Uploaded', value: counts.document_uploaded || 0, color: '#2563eb' },
          { label: 'Anomalies Resolved', value: (counts.anomaly_resolved || 0) + (counts.anomaly_dismissed || 0), color: '#10b981' },
          { label: 'Cases Created', value: (counts.case_created || 0) + (counts.lifecycle_case_created || 0), color: '#8b5cf6' },
        ].map(c => (
          <div key={c.label} className="card p-4 text-center">
            <div className="text-2xl font-extrabold" style={{ color: c.color }}>{c.value}</div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setFilter('')}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
            !filter ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
          All ({total})
        </button>
        {topActions.map(([action, count]) => {
          const meta = actionMeta[action] || {};
          return (
            <button key={action} onClick={() => setFilter(action)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                filter === action ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {meta.label || action.replace(/_/g, ' ')} ({count})
            </button>
          );
        })}
      </div>

      {/* Event list */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading audit trail...</div>
        ) : log.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No events found</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {log.map((e, i) => {
              const meta = actionMeta[e.action] || { icon: CircleDot, color: '#94a3b8', label: e.action };
              const Ic = meta.icon;
              return (
                <div key={e.id || i} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: meta.color + '15' }}>
                    <Ic className="w-4 h-4" style={{ color: meta.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">{meta.label}</span>
                      {e.vendor && <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 text-slate-600 font-semibold rounded">{e.vendor}</span>}
                      {e.documentNumber && <span className="text-[11px] font-mono text-slate-500">{e.documentNumber}</span>}
                      {e.anomalyType && <span className="text-[11px] px-1.5 py-0.5 bg-amber-50 text-amber-700 font-semibold rounded">{e.anomalyType.replace(/_/g, ' ')}</span>}
                      {e.caseId && <span className="text-[11px] font-mono text-purple-500">Case {e.caseId}</span>}
                      {e.severity && <Badge c={e.severity === 'high' ? 'err' : e.severity === 'medium' ? 'warn' : 'muted'}>{e.severity}</Badge>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {e.resolution && <span className="text-emerald-600 font-medium mr-2">{e.resolution}</span>}
                      {e.dismissReason && <span className="text-slate-500 font-medium mr-2">{e.dismissReason}</span>}
                      {e.count && <span className="mr-2">{e.count} anomalies detected</span>}
                      {e.totalRisk > 0 && <span className="text-red-500 font-semibold mr-2">${num(e.totalRisk)} at risk</span>}
                      {e.assignedTo && <span className="mr-2">→ {e.assignedTo}</span>}
                      {e.changes && typeof e.changes === 'string' && <span className="mr-2">{e.changes}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[11px] text-slate-400">{e.timestamp ? dateTime(e.timestamp) : ''}</div>
                    <div className="text-[11px] text-slate-500 font-medium">{e.performedBy || 'system'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   SETTINGS (AP POLICY)
   ═══════════════════════════════════════════════════ */
/* ── Confidence Weight Profiles Editor ── */
const FACTOR_LABELS = ['Field Completeness', 'Line Item Integrity', 'Math Consistency', 'Date Validity', 'Amount Plausibility', 'Vendor Identification', 'AI Self-Assessment'];
const DOC_TYPE_LABELS = { invoice: 'Invoice', purchase_order: 'Purchase Order', contract: 'Contract', credit_note: 'Credit Note', debit_note: 'Debit Note', goods_receipt: 'Goods Receipt' };
const DEFAULT_WEIGHTS = { invoice:[0.15,0.20,0.25,0.10,0.15,0.10,0.05], purchase_order:[0.30,0.15,0.15,0.10,0.10,0.10,0.10], contract:[0.20,0.10,0.05,0.25,0.10,0.15,0.15], credit_note:[0.20,0.15,0.20,0.10,0.15,0.10,0.10], debit_note:[0.20,0.15,0.20,0.10,0.15,0.10,0.10], goods_receipt:[0.15,0.30,0.10,0.10,0.05,0.15,0.15] };

function ConfidenceWeightsEditor({ policy, save }) {
  const [weights, setWeights] = useState(() => policy?.confidence_weights || DEFAULT_WEIGHTS);
  const [editType, setEditType] = useState('invoice');

  const cw = weights[editType] || DEFAULT_WEIGHTS[editType];
  const total = cw.reduce((a, b) => a + b, 0);
  const isValid = Math.abs(total - 1.0) < 0.02;

  function updateWeight(idx, val) {
    const nw = { ...weights };
    const arr = [...(nw[editType] || DEFAULT_WEIGHTS[editType])];
    arr[idx] = Math.max(0, Math.min(1, parseFloat(val) || 0));
    nw[editType] = arr;
    setWeights(nw);
  }

  function resetToDefaults() { setWeights({ ...DEFAULT_WEIGHTS }); }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Confidence Weight Profiles</h3>
          <p className="text-xs text-slate-500 mt-1">Adjust how extraction confidence is scored per document type</p>
        </div>
        <div className="flex gap-2">
          <button onClick={resetToDefaults} className="btn-o text-xs"><RotateCcw className="w-3 h-3" /> Reset Defaults</button>
          <button onClick={() => save(weights)} disabled={!isValid} className="btn-p text-xs"><Check className="w-3 h-3" /> Save Weights</button>
        </div>
      </div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {Object.entries(DOC_TYPE_LABELS).map(([k, l]) => (
          <button key={k} onClick={() => setEditType(k)}
            className={cn('btn text-xs px-3 py-1.5 rounded-lg', editType === k ? 'bg-accent-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {l}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {FACTOR_LABELS.map((label, i) => (
          <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
            <span className="text-sm font-medium text-slate-700 w-44">{label}</span>
            <input type="range" min="0" max="0.5" step="0.01" value={cw[i]} onChange={e => updateWeight(i, e.target.value)} className="flex-1 accent-accent-600" />
            <span className="text-sm font-mono font-bold w-14 text-right">{(cw[i] * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
      <div className={cn('mt-3 text-sm font-semibold text-center py-2 rounded-lg', isValid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
        Total: {(total * 100).toFixed(1)}% {isValid ? '✓' : '— must equal 100%'}
      </div>
    </div>
  );
}

function EscalationMatrixEditor() {
  const { toast } = useStore();
  const [matrix, setMatrix] = useState({});
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await api('/api/policy/escalation-matrix');
      if (r && !r._err) { setMatrix(r.matrix || {}); setRoles(r.available_roles || []); }
      setLoading(false);
    })();
  }, []);

  const updateCell = (anomalyType, field, value) => {
    setMatrix(prev => ({ ...prev, [anomalyType]: { ...prev[anomalyType], [field]: value } }));
    setDirty(true);
  };

  const saveMatrix = async () => {
    const r = await post('/api/policy/escalation-matrix', { matrix });
    if (r?.success) { toast('Escalation matrix saved', 'success'); setDirty(false); }
    else toast('Failed to save', 'danger');
  };

  const anomalyTypes = Object.keys(matrix);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Escalation Routing Matrix</h3>
          <p className="text-xs text-slate-500 mt-0.5">Configure who handles each anomaly type. Changes apply to new escalations.</p>
        </div>
        {dirty && <button onClick={saveMatrix} className="btn-p text-xs"><Check className="w-3 h-3" /> Save Matrix</button>}
      </div>
      {loading ? <div className="text-sm text-slate-400 p-4">Loading...</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 px-3 text-[11px] font-bold text-slate-500 uppercase">Anomaly Type</th>
                <th className="text-left py-2 px-3 text-[11px] font-bold text-slate-500 uppercase">Primary Escalation</th>
                <th className="text-left py-2 px-3 text-[11px] font-bold text-slate-500 uppercase">Alternative</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {anomalyTypes.map(atype => (
                <tr key={atype} className="hover:bg-slate-50">
                  <td className="py-2 px-3 text-xs font-semibold text-slate-700">{atype.replace(/_/g, ' ')}</td>
                  <td className="py-2 px-3">
                    <select value={matrix[atype]?.primary || ''} onChange={e => updateCell(atype, 'primary', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-accent-500">
                      {roles.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="py-2 px-3">
                    <select value={matrix[atype]?.secondary || ''} onChange={e => updateCell(atype, 'secondary', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-accent-500">
                      {roles.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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

      {/* Confidence Weight Profiles */}
      <ConfidenceWeightsEditor policy={p} save={async (cw) => { await post('/api/policy', { confidence_weights: cw }); await load(); toast('Confidence weights saved', 'success'); }} />

      {/* Escalation Matrix */}
      <EscalationMatrixEditor />

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
  const [meType, setMeType] = useState('invoice');
  const fileRef = useRef();
  const importRef = useRef();

  const procSteps = (() => {
    const t = docType;
    if (t === 'auto') return ['Reading document', 'Detecting document type', 'Extracting fields & line items', 'Running document-specific validations', 'Computing confidence score'];
    const base = ['Reading document', 'Extracting fields & line items'];
    if (t === 'invoice') return [...base, 'Matching to purchase orders', 'Cross-referencing contracts', 'Running anomaly detection', 'Computing confidence score'];
    if (t === 'purchase_order') return [...base, 'Checking for linked invoices', 'Validating delivery terms', 'Computing confidence score'];
    if (t === 'contract') return [...base, 'Extracting parties & terms', 'Validating contract clauses', 'Computing confidence score'];
    if (t === 'goods_receipt') return [...base, 'Matching to purchase order', 'Verifying received quantities', 'Computing confidence score'];
    if (t === 'credit_note' || t === 'debit_note') return [...base, 'Linking to original invoice', 'Running anomaly detection', 'Computing confidence score'];
    return [...base, 'Running anomaly detection', 'Computing confidence score'];
  })();

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
        if (!r || (!r.success && !r._err)) {
          res.push({ name: file.name, ok: false, error: r?.error || 'Upload failed — please try again or re-login' });
        } else if (r._err) {
          res.push({ name: file.name, ok: false, error: r.detail || 'Server error' });
        } else if (r.success === false) {
          res.push({ name: file.name, ok: false, error: r.error || 'Extraction failed — use Manual Entry to index this document' });
        } else {
          const doc = r.document || {};
          res.push({
            name: file.name, ok: true,
            type: r.type || doc.type,
            confidence: r.confidence ?? doc.confidence,
            vendor: r.vendor || doc.vendor,
            amount: r.amount || doc.amount,
            currency: r.currency || doc.currency || 'USD',
            invoiceNumber: r.invoiceNumber || doc.invoiceNumber || doc.poNumber || doc.contractNumber || doc.documentNumber,
          });
        }
      } catch (err) { res.push({ name: file.name, ok: false, error: 'Upload failed: ' + (err.message || 'network error') }); }
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
      {showManual && (() => {
        const T = meType;
        const isInv = T === 'invoice';
        const isPO = T === 'purchase_order';
        const isGRN = T === 'goods_receipt';
        const isCtr = T === 'contract';
        const isCN = T === 'credit_note';
        const isDN = T === 'debit_note';
        const isCrDb = isCN || isDN;
        const showAmt = !isGRN;
        const showCurrency = !isGRN;
        const showIssueDate = !isGRN;
        return (
        <div className="card p-6 animate-slide-up">
          <form onSubmit={manualSave}>
            <div className="text-sm font-bold mb-4">✏️ Manual Document Entry</div>
            <div className="grid grid-cols-2 gap-4">
              {/* Always: Type + Number */}
              <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Document Type *</label><select name="type" value={meType} onChange={e => setMeType(e.target.value)} className="inp"><option value="invoice">Invoice</option><option value="purchase_order">Purchase Order</option><option value="goods_receipt">Goods Receipt</option><option value="contract">Contract</option><option value="credit_note">Credit Note</option><option value="debit_note">Debit Note</option></select></div>
              <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Document Number *</label><input name="documentNumber" placeholder={isInv ? 'e.g. INV-2024-001' : isPO ? 'e.g. PO-2024-050' : isCtr ? 'e.g. CTR-2024-010' : isGRN ? 'e.g. GRN-2024-030' : 'e.g. CN-2024-005'} className="inp" required /></div>
              {/* Always: Vendor */}
              <div><label className="text-xs font-semibold text-slate-500 mb-1 block">{isCtr ? 'Counterparty *' : 'Vendor *'}</label><input name="vendor" placeholder={isCtr ? 'Contracting party' : 'Vendor name'} className="inp" required /></div>
              {/* Amount — not for GRN */}
              {showAmt && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">{isCtr ? 'Contract Value *' : isCrDb ? 'Adjustment Amount *' : 'Amount *'}</label><input name="amount" type="number" step="0.01" placeholder="0.00" className="inp" required /></div>}
              {/* Currency — not for GRN */}
              {showCurrency && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Currency</label><select name="currency" className="inp"><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="INR">INR</option><option value="AED">AED</option><option value="JPY">JPY</option></select></div>}
              {/* Issue Date — not for GRN */}
              {showIssueDate && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">{isCtr ? 'Effective Date' : 'Issue Date'}</label><input name="issueDate" type="date" className="inp" /></div>}
              {/* Invoice-specific */}
              {isInv && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Due Date</label><input name="dueDate" type="date" className="inp" /></div>}
              {isInv && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">PO Reference</label><input name="poReference" placeholder="PO number (if any)" className="inp" /></div>}
              {isInv && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Payment Terms</label><input name="paymentTerms" placeholder="e.g. Net 30" className="inp" /></div>}
              {/* PO-specific */}
              {isPO && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Delivery Date</label><input name="deliveryDate" type="date" className="inp" /></div>}
              {/* Credit/Debit Note-specific */}
              {isCrDb && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Original Invoice Ref *</label><input name="originalInvoiceRef" placeholder="e.g. INV-2024-001" className="inp" required /></div>}
              {isCrDb && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Reason</label><input name="reason" placeholder={isCN ? 'Reason for credit' : 'Reason for debit'} className="inp" /></div>}
              {/* GRN-specific */}
              {isGRN && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">PO Reference *</label><input name="poReference" placeholder="PO number being receipted" className="inp" required /></div>}
              {isGRN && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Received Date *</label><input name="receivedDate" type="date" className="inp" required /></div>}
              {isGRN && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Received By</label><input name="receivedBy" placeholder="Name of receiver" className="inp" /></div>}
              {isGRN && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Quantity Received</label><input name="quantityReceived" type="number" placeholder="0" className="inp" /></div>}
              {/* Contract-specific */}
              {isCtr && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">End Date</label><input name="endDate" type="date" className="inp" /></div>}
              {isCtr && <div><label className="text-xs font-semibold text-slate-500 mb-1 block">Parties</label><input name="parties" placeholder="e.g. Buyer Co. & Supplier Ltd." className="inp" /></div>}
              {/* Always: Notes */}
              <div className="col-span-2"><label className="text-xs font-semibold text-slate-500 mb-1 block">Notes</label><textarea name="notes" rows="2" placeholder="Additional context" className="inp" /></div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button type="button" onClick={() => setShowManual(false)} className="btn-g text-xs">Cancel</button>
              <button type="submit" className="btn-p text-xs"><Check className="w-3 h-3" /> Save Document</button>
            </div>
          </form>
        </div>);
      })()}

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
            <div className="text-sm text-slate-500">PDF, JPEG, PNG — single or multiple files</div>
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
            <div key={i} className={cn('p-3 rounded-xl', r.ok ? 'bg-emerald-50' : 'bg-red-50')}>
              <div className="flex items-center gap-3">
                {r.ok ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{r.name}</div>
                  {!r.ok && <div className="text-xs text-red-500 mt-0.5">{r.error}</div>}
                  {r.ok && (r.vendor || r.invoiceNumber) && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      {r.vendor && <span>{r.vendor}</span>}
                      {r.vendor && r.invoiceNumber && <span className="mx-1">·</span>}
                      {r.invoiceNumber && <span className="font-mono">{r.invoiceNumber}</span>}
                      {r.amount > 0 && <span className="mx-1">·</span>}
                      {r.amount > 0 && <span className="font-semibold">{$(r.amount, r.currency)}</span>}
                    </div>
                  )}
                </div>
                {r.ok && r.type && <Badge c={docColor(r.type)}>{docLabel(r.type)}</Badge>}
                {r.ok && r.confidence != null && <span className="font-mono text-sm font-semibold text-emerald-700">{pct(r.confidence)}</span>}
              </div>
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
            <div><span className="text-slate-500">Status:</span> <span className="font-semibold capitalize">{job.status}</span></div>
            <div><span className="text-slate-500">Model:</span> <span className="font-mono text-xs">{job.model || '—'}</span></div>
            <div><span className="text-slate-500">Events:</span> <span>{job.events?.length || 0}</span></div>
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
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">{label}</div>
        <input type={type} defaultValue={val || ''} onChange={e => setFields(f => ({ ...f, [k]: e.target.value }))}
          className="inp text-sm py-1.5 border-accent-300 bg-accent-50/30" />
      </div>
    );
    return (
      <div><div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">{label}</div><div className="text-sm font-semibold text-slate-800">{val || '—'}</div></div>
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
              <>
                <button onClick={() => {
                  const sw = window.screen.availWidth, sh = window.screen.availHeight;
                  const pw = Math.min(1280, sw - 100), ph = Math.min(800, sh - 80);
                  const pl = Math.floor((sw - pw) / 2);
                  const w = window.open('', '_blank', `width=${pw},height=${ph},left=${pl},top=40,scrollbars=yes,resizable=yes`);
                  if (!w) return;
                  const docNum = doc.invoiceNumber || doc.poNumber || doc.contractNumber || doc.id;
                  const docType = docLabel(doc.type);
                  const pdfUrl = doc.uploadedFile ? `${window.location.origin}/api/uploads/${encodeURIComponent(doc.uploadedFile)}` : '';
                  const fields = [
                    ['Type', docType], ['Document #', docNum], ['Vendor', doc.vendor],
                    ['Amount', doc.amount ? `${doc.currency || 'USD'} ${Number(doc.amount).toLocaleString()}` : '—'],
                    ['Subtotal', doc.subtotal ? `${doc.currency || 'USD'} ${Number(doc.subtotal).toLocaleString()}` : '—'],
                    ['Tax', doc.tax ? `${doc.currency || 'USD'} ${Number(doc.tax).toLocaleString()}` : '—'],
                    ['Currency', doc.currency || '—'],
                    ['Issue Date', doc.issueDate || doc.effectiveDate || '—'],
                    ['Due Date', doc.dueDate || doc.endDate || '—'],
                    ['Payment Terms', doc.paymentTerms || '—'],
                    ['Status', doc.status || '—'],
                    ['PO Reference', doc.poReference || '—'],
                    ['Confidence', doc.confidence ? `${Math.round(doc.confidence)}%` : '—'],
                  ];
                  const lineItems = (doc.lineItems || []).map(li =>
                    `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${li.description || '—'}</td>` +
                    `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${li.quantity || '—'}</td>` +
                    `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${li.unitPrice ? Number(li.unitPrice).toLocaleString() : '—'}</td>` +
                    `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">${li.total ? Number(li.total).toLocaleString() : '—'}</td></tr>`
                  ).join('');
                  const pdfPanel = pdfUrl
                    ? `<div class="pdf-panel"><iframe src="${pdfUrl}" style="width:100%;height:100%;border:none"></iframe></div>`
                    : `<div class="pdf-panel" style="display:flex;align-items:center;justify-content:center;background:#1e293b;color:#64748b;font-size:14px">
                        <div style="text-align:center"><div style="font-size:48px;margin-bottom:12px">📄</div>Original file not available<br><span style="font-size:12px;opacity:.6">File lost after redeployment</span></div></div>`;
                  w.document.write(`<!DOCTYPE html><html><head><title>${docType}: ${docNum}</title>
                    <style>
                    *{box-sizing:border-box;margin:0;padding:0}
                    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#1e293b;height:100vh;overflow:hidden}
                    .hdr{background:linear-gradient(135deg,#1e293b,#334155);color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between}
                    .hdr h1{font-size:17px;font-weight:700}.hdr .sub{opacity:.7;font-size:12px}
                    .split{display:flex;height:calc(100vh - 52px)}
                    .pdf-panel{flex:1;min-width:0;background:#1e293b}
                    .data-panel{width:380px;min-width:380px;background:#fff;overflow-y:auto;border-left:1px solid #e2e8f0}
                    .section{padding:16px 20px;border-bottom:1px solid #f1f5f9}
                    .section-title{font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:.5px;margin-bottom:10px}
                    .field-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f8fafc}
                    .field-row .lbl{font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:600}
                    .field-row .val{font-size:13px;font-weight:600;text-align:right;max-width:200px}
                    table{width:100%;border-collapse:collapse}
                    th{font-size:10px;text-transform:uppercase;color:#94a3b8;padding:6px 8px;text-align:left;font-weight:700;border-bottom:2px solid #e2e8f0}
                    td{padding:6px 8px;font-size:12px;border-bottom:1px solid #f1f5f9}
                    </style></head><body>
                    <div class="hdr"><div><h1>${docType}: ${docNum}</h1><div class="sub">${doc.vendor || ''} · Confidence: ${doc.confidence ? Math.round(doc.confidence)+'%' : '—'}</div></div><div style="font-size:11px;opacity:.5">AuditLens Pop-Out</div></div>
                    <div class="split">
                      ${pdfPanel}
                      <div class="data-panel">
                        <div class="section"><div class="section-title">Extracted Data</div>${fields.map(([l,v]) => `<div class="field-row"><span class="lbl">${l}</span><span class="val">${v || '—'}</span></div>`).join('')}</div>
                        ${(doc.lineItems||[]).length ? `<div class="section"><div class="section-title">Line Items</div><table><thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Total</th></tr></thead><tbody>${lineItems}</tbody></table></div>` : ''}
                      </div>
                    </div></body></html>`);
                  w.document.close();
                  d({ type: 'SEL', doc: null }); setEditing(false);
                }} className="btn-g text-xs"><ExternalLink className="w-3 h-3" /> Pop Out</button>
                <button onClick={() => setEditing(true)} className="btn-o text-xs"><Edit3 className="w-3 h-3" /> Edit</button>
              </>
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
            {view === 'split' && <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Extracted Data — {pct(doc.confidence)} confidence</div>}
            <div className="grid grid-cols-2 gap-4">
              {/* Always: Vendor/Counterparty + Confidence */}
              <Field label={doc.type === 'contract' ? 'Counterparty' : 'Vendor'} val={doc.vendor} k="vendor" />
              <Field label="Confidence" val={pct(doc.confidence)} />

              {/* Amount fields — not for GRN */}
              {doc.type !== 'goods_receipt' && <Field label={doc.type === 'contract' ? 'Contract Value' : (doc.type === 'credit_note' || doc.type === 'debit_note') ? 'Adjustment Amount' : 'Amount'}
                val={doc.type === 'contract' && !doc.amount && (doc.isRateContract || (doc.pricingTerms && (Array.isArray(doc.pricingTerms) ? doc.pricingTerms.length > 0 : Object.keys(doc.pricingTerms || {}).length > 0)))
                  ? 'Rate Contract (per-unit pricing)'
                  : $f(doc.amount, cur)} />}
              {doc.type !== 'goods_receipt' && <Field label="Subtotal" val={$f(doc.subtotal, cur)} k="subtotal" type="number" />}

              {/* Tax — only for invoice/PO/credit/debit */}
              {(doc.type === 'invoice' || doc.type === 'purchase_order' || doc.type === 'credit_note' || doc.type === 'debit_note') && (
                <Field label="Tax" val={doc.totalTax ? `${$f(doc.totalTax, cur)} (${(doc.taxDetails || []).map(t => t.type + ' ' + t.rate + '%').join(', ')})` : '—'} />
              )}
              {doc.type !== 'goods_receipt' && <Field label="Currency" val={doc.currency || 'USD'} k="currency" />}

              {/* Date fields — type-specific */}
              {doc.type !== 'goods_receipt' && doc.type !== 'contract' && <Field label="Issued" val={date(doc.issueDate)} k="issueDate" type="date" />}
              {doc.type === 'invoice' && <Field label="Due Date" val={date(doc.dueDate)} k="dueDate" type="date" />}
              {doc.type === 'purchase_order' && <Field label="Delivery Date" val={date(doc.deliveryDate)} k="deliveryDate" type="date" />}
              {doc.type === 'purchase_order' && <Field label="Payment Terms" val={doc.paymentTerms} k="paymentTerms" />}
              {doc.type === 'purchase_order' && doc.shipTo && <Field label="Ship To" val={doc.shipTo} />}
              {doc.type === 'purchase_order' && doc.billTo && <Field label="Bill To" val={doc.billTo} />}
              {doc.type === 'purchase_order' && doc.buyerName && <Field label="Buyer" val={doc.buyerContact ? `${doc.buyerName} (${doc.buyerContact})` : doc.buyerName} />}
              {doc.type === 'purchase_order' && doc.incoterms && <Field label="Incoterms" val={doc.incoterms} />}
              {doc.type === 'purchase_order' && doc.shippingMethod && <Field label="Shipping" val={doc.shippingMethod} />}

              {/* Invoice-specific */}
              {doc.type === 'invoice' && <Field label="PO Reference" val={doc.poReference} k="poReference" />}
              {doc.type === 'invoice' && <Field label="Payment Terms" val={doc.paymentTerms} k="paymentTerms" />}
              {doc.type === 'invoice' && doc.earlyPaymentDiscount && <Field label="Early Pay Discount" val={`${doc.earlyPaymentDiscount.discount_percent}% if paid within ${doc.earlyPaymentDiscount.days} days`} />}
              {doc.type === 'invoice' && doc.billTo && <Field label="Bill To" val={doc.billTo} />}
              {doc.type === 'invoice' && doc.shipTo && <Field label="Ship To" val={doc.shipTo} />}

              {/* Credit/Debit Note-specific */}
              {(doc.type === 'credit_note' || doc.type === 'debit_note') && <Field label="Original Invoice Ref" val={doc.originalInvoiceRef} />}
              {(doc.type === 'credit_note' || doc.type === 'debit_note') && doc.creditDebitReason && <Field label="Reason" val={doc.creditDebitReason} />}
              {(doc.type === 'credit_note' || doc.type === 'debit_note') && doc.adjustmentType && <Field label="Adjustment Type" val={(doc.adjustmentType || '').replace(/_/g, ' ')} />}

              {/* GRN-specific */}
              {doc.type === 'goods_receipt' && <Field label="PO Reference" val={doc.poReference} k="poReference" />}
              {doc.type === 'goods_receipt' && <Field label="Received Date" val={date(doc.receivedDate)} />}
              {doc.type === 'goods_receipt' && <Field label="Received By" val={doc.receivedBy} />}
              {doc.type === 'goods_receipt' && doc.conditionNotes && <Field label="Condition" val={doc.conditionNotes} />}
              {doc.type === 'goods_receipt' && doc.shipFrom && <Field label="Shipped From" val={doc.shipFrom} />}
              {doc.type === 'goods_receipt' && doc.warehouseLocation && <Field label="Warehouse" val={doc.warehouseLocation} />}

              {/* Contract-specific — comprehensive F&A fields */}
              {doc.type === 'contract' && <Field label="Effective Date" val={date(doc.effectiveDate || doc.issueDate)} />}
              {doc.type === 'contract' && <Field label="End Date" val={date(doc.endDate)} />}
              {doc.type === 'contract' && <Field label="Signing Date" val={date(doc.signingDate || doc.issueDate)} />}
              {doc.type === 'contract' && doc.termMonths && <Field label="Term" val={`${doc.termMonths} months`} />}
              {doc.type === 'contract' && <Field label="Payment Terms" val={doc.paymentTerms} k="paymentTerms" />}
              {doc.type === 'contract' && <Field label="Currency" val={doc.currency || 'USD'} />}
              {doc.type === 'contract' && doc.parties && <Field label="Parties" val={Array.isArray(doc.parties) ? doc.parties.join(' & ') : doc.parties} />}
              {doc.type === 'contract' && doc.governingLaw && <Field label="Governing Law" val={doc.governingLaw} />}
              {doc.type === 'contract' && doc.autoRenewal != null && <Field label="Auto-Renewal" val={doc.autoRenewal ? `Yes${doc.renewalNoticeDays ? ` (${doc.renewalNoticeDays}d notice)` : ''}` : 'No'} />}
              {doc.type === 'contract' && doc.terminationNoticeDays && <Field label="Termination Notice" val={`${doc.terminationNoticeDays} days`} />}
              {doc.type === 'contract' && (doc.liabilityCap || doc.liabilityCapDescription) && <Field label="Liability Cap" val={doc.liabilityCapDescription || $f(doc.liabilityCap, cur)} />}
              {doc.type === 'contract' && doc.warrantyMonths && <Field label="Warranty" val={`${doc.warrantyMonths} months`} />}
              {doc.type === 'contract' && doc.confidentialityYears && <Field label="Confidentiality" val={`${doc.confidentialityYears} years`} />}
              {doc.type === 'contract' && doc.forceMajeureDays && <Field label="Force Majeure" val={`${doc.forceMajeureDays} days threshold`} />}
              {doc.type === 'contract' && doc.slaSummary && <Field label="SLA Summary" val={doc.slaSummary} />}
              {doc.type === 'contract' && doc.penaltyClauses && <Field label="Penalties" val={doc.penaltyClauses} />}
              {doc.type === 'contract' && doc.ipOwnership && <Field label="IP Ownership" val={doc.ipOwnership} />}
              {doc.type === 'contract' && doc.insuranceRequirements && <Field label="Insurance" val={doc.insuranceRequirements} />}
              {doc.type === 'contract' && doc.terminationForConvenience && <Field label="Termination" val={doc.terminationForConvenience} />}

              {/* Always: Status + Uploaded */}
              <Field label="Status" val={(doc.status || '').replace(/_/g, ' ').toUpperCase()} />
              <Field label="Uploaded By" val={doc.uploadedBy} />
              <Field label="Uploaded At" val={dateTime(doc.extractedAt)} />
            </div>

            {/* Confidence Breakdown */}
            {fc && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-2">Confidence Breakdown</div>
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

            {/* Math Validation — 5 deterministic checks */}
            {ens?.math_validation && (
              <div className={cn('p-3 rounded-xl border', ens.math_validation.passed ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200')}>
                <div className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-2">🔢 Math Validation</div>
                <div className="flex items-center gap-2 text-xs mb-1.5">
                  <span className={cn('font-bold', ens.math_validation.passed ? 'text-emerald-600' : 'text-amber-600')}>{ens.math_validation.passed ? '✓ All checks passed' : '⚠ Issues detected'}</span>
                  <span className="text-slate-400">({ens.math_validation.checks_run || 5} checks)</span>
                </div>
                {(ens.math_validation.issues || []).length > 0 && (
                  <div className="space-y-1">
                    {ens.math_validation.issues.map((iss, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <span className={cn('flex-shrink-0 mt-0.5', iss.severity === 'high' ? 'text-red-500' : iss.severity === 'medium' ? 'text-amber-500' : 'text-slate-400')}>{iss.severity === 'high' ? '✗' : '~'}</span>
                        <span className="text-slate-600">{iss.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(ens.math_validation.issues || []).length === 0 && (
                  <div className="text-[11px] text-emerald-600">Line items ✓ · Subtotal + Tax = Total ✓ · Tax rates ✓ · Line math ✓ · Dates ✓</div>
                )}
              </div>
            )}

            {/* Ensemble Data */}
            {ens && ens.fields_agreed != null && (
              <div className={cn('p-3 rounded-xl border', ens.ensemble_confidence === 'high' ? 'bg-emerald-50 border-emerald-200' : ens.ensemble_confidence === 'medium' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200')}>
                <div className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-2">🤝 Ensemble Verification</div>
                <div className="grid grid-cols-3 gap-3 mb-2 text-center">
                  <div><div className="text-lg font-bold text-emerald-600">{ens.fields_agreed || 0}</div><div className="text-[11px] text-slate-400">Agreed</div></div>
                  <div><div className="text-lg font-bold" style={{ color: (ens.fields_disputed || 0) > 0 ? '#ef4444' : '#10b981' }}>{ens.fields_disputed || 0}</div><div className="text-[11px] text-slate-400">Disputed</div></div>
                  <div><div className="text-lg font-bold" style={{ color: (ens.agreement_rate || 0) >= 90 ? '#10b981' : '#f59e0b' }}>{pct(ens.agreement_rate)}</div><div className="text-[11px] text-slate-400">Agreement</div></div>
                </div>
                {/* Per-field breakdown */}
                {doc.fieldConfidence && Object.keys(doc.fieldConfidence).length > 0 && (() => {
                  const LABELS = {
                    vendor_name: 'Vendor Name', document_number: 'Document #', total_amount: 'Total Amount',
                    subtotal: 'Subtotal', currency: 'Currency', po_reference: 'PO Reference',
                    payment_terms: 'Payment Terms', issue_date: 'Issue Date', due_date: 'Due Date',
                    delivery_date: 'Delivery Date', original_invoice_ref: 'Original Invoice',
                    received_date: 'Received Date', received_by: 'Received By',
                  };
                  const HIDDEN = new Set(['locale', 'document_language', 'document_type']);
                  const fc = doc.fieldConfidence;
                  const fields = Object.entries(fc)
                    .filter(([k]) => !HIDDEN.has(k) && k !== 'line_items' && k !== 'tax_details')
                    .sort((a, b) => {
                      const order = ['vendor_name','document_number','total_amount','subtotal','currency','po_reference','payment_terms','issue_date','due_date'];
                      return (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0]));
                    });
                  const hasLI = fc.line_items;
                  const hasTax = fc.tax_details;
                  if (fields.length === 0 && !hasLI && !hasTax) return null;
                  return (
                    <div className="mt-2 pt-2 border-t border-current/10">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Field-by-Field Verification</div>
                      <div className="space-y-0.5">
                        {fields.map(([field, info]) => (
                          <div key={field} className="flex items-center gap-2 text-[11px] py-0.5">
                            <span className="w-3 text-center" style={{ color: info.status === 'agreed' || info.status === 'near_match' ? '#10b981' : info.status === 'disputed' ? '#ef4444' : '#94a3b8' }}>
                              {info.status === 'agreed' || info.status === 'near_match' ? '✓' : info.status === 'disputed' ? '✗' : '–'}
                            </span>
                            <span className="text-slate-700 font-medium w-28 flex-shrink-0">{LABELS[field] || field.replace(/_/g, ' ')}</span>
                            {info.status === 'disputed' && info.a != null && (
                              <span className="text-[11px] text-red-500 truncate">{String(info.a)} ≠ {String(info.b)}</span>
                            )}
                            {info.status === 'single_source' && (
                              <span className="text-[11px] text-slate-400">one model only</span>
                            )}
                          </div>
                        ))}
                        {hasLI && (
                          <div className="flex items-center gap-2 text-[11px] py-0.5">
                            <span className="w-3 text-center" style={{ color: hasLI.status === 'all_agreed' ? '#10b981' : hasLI.status === 'count_mismatch' || hasLI.status === 'one_empty' ? '#ef4444' : '#f59e0b' }}>
                              {hasLI.status === 'all_agreed' ? '✓' : hasLI.status === 'count_mismatch' ? '✗' : '–'}
                            </span>
                            <span className="text-slate-700 font-medium w-28 flex-shrink-0">Line Items</span>
                            <span className="text-[11px] text-slate-400">
                              {hasLI.matched_count != null ? `${hasLI.matched_count} items verified` : hasLI.status === 'all_agreed' ? 'Models agree on all items' : hasLI.status === 'count_mismatch' ? 'Item count differs between models' : hasLI.status === 'both_empty' ? 'No line items extracted' : 'Single model extraction'}
                            </span>
                          </div>
                        )}
                        {hasTax && (
                          <div className="flex items-center gap-2 text-[11px] py-0.5">
                            <span className="w-3 text-center" style={{ color: hasTax.status === 'agreed' || hasTax.status === 'both_empty' ? '#10b981' : '#f59e0b' }}>
                              {hasTax.status === 'agreed' || hasTax.status === 'both_empty' ? '✓' : '~'}
                            </span>
                            <span className="text-slate-700 font-medium w-28 flex-shrink-0">Tax Details</span>
                            <span className="text-[11px] text-slate-400">
                              {hasTax.status === 'agreed' ? 'Tax calculations verified' : hasTax.status === 'both_empty' ? 'No tax on document' : hasTax.status === 'count_mismatch' ? 'Tax entries differ' : 'Single model extraction'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {ens.resolution_applied && <div className="text-xs text-accent-700 mt-1">✔ Disputes auto-resolved ({ens.fields_resolved?.join(', ')})</div>}
                <div className="text-[11px] text-slate-400 mt-1">Models: {ens.models_used?.map(m => m.split('-').slice(0, 2).join(' ')).join(' + ') || 'N/A'} · {(ens.primary_latency_ms || 0) + (ens.secondary_latency_ms || 0) || ens.total_latency_ms || 0}ms</div>
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
                <div className="flex items-center gap-2 mb-1"><Badge c={laneColor(doc.triageLane)}>{laneLabel(doc.triageLane)}</Badge><span className="text-xs text-slate-500">{pct(doc.triageConfidence)} confidence</span></div>
                {doc.triageReasons.map((r, i) => <div key={i} className="text-sm text-slate-600 mt-0.5">• {r}</div>)}
                {!editing && doc.type === 'invoice' && (
                  <div className="flex gap-1 mt-2">{['AUTO_APPROVE', 'REVIEW', 'BLOCK'].filter(l => l !== doc.triageLane).map(l => (
                    <button key={l} onClick={() => overrideTriage(l)} className="btn-g text-[11px] px-2 py-1">{laneLabel(l)}</button>
                  ))}</div>
                )}
              </div>
            )}

            {/* Anomalies */}
            {anoms.length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-red-600 uppercase tracking-wider mb-2">⚠ {anoms.length} Anomalies</div>
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
              <div className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-2">Line Items {editing && <span className="text-accent-600 font-normal">(click values to edit)</span>}</div>
              <div className="rounded-xl overflow-hidden border border-slate-100">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50"><th className="px-3 py-2 text-left text-[11px] text-slate-500 uppercase">Item</th><th className="px-3 py-2 text-right text-[11px] text-slate-500 uppercase">Qty</th><th className="px-3 py-2 text-right text-[11px] text-slate-500 uppercase">Price</th><th className="px-3 py-2 text-right text-[11px] text-slate-500 uppercase">Total</th></tr></thead>
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
  const totalRules = rc + 8;  // base rules + contract/delivery intelligence rules
  const rc14 = 14;  // clause types

  const ruleNames = (ps.rules || []).map(r => r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace('Po', 'PO').replace('Grn', 'GRN').replace('Qty', 'QTY'));
  const oppNames = (ps.opp || []).map(r => r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

  const features = [
    { icon: Zap, title: 'Ensemble Extraction', desc: 'Two frontier models extract in parallel with consensus merging and field-level confidence.', tag: 'AI', color: '#4f46e5' },
    { icon: Brain, title: 'Agentic Dispute Resolution', desc: 'When models disagree, a third AI re-examines with vendor context and PO data.', tag: 'AI', color: '#4f46e5' },
    { icon: Shield, title: 'RAG Anomaly Detection', desc: `${rc} rule-based checks plus AI cross-referencing past anomalies, contract clauses, and vendor behavior.`, tag: 'AI + RULES', color: '#d97706' },
    { icon: Link2, title: '3-Way Smart Matching', desc: 'Automatically matches purchase orders, goods receipts, and invoices with AI-powered fuzzy resolution.', tag: 'AI + ALGO', color: '#059669' },
    { icon: FileCheck, title: 'Contract Intelligence', desc: '14-clause risk analysis with health scores, obligation tracking, and price drift detection.', tag: 'AI', color: '#4f46e5' },
    { icon: Building2, title: '9-Factor Vendor Risk', desc: 'Comprehensive vendor scoring: compliance status, payment behavior, spend concentration, delivery performance.', tag: 'AI + RULES', color: '#d97706' },
    { icon: TrendingUp, title: 'Delivery Analytics', desc: 'Delivery performance tracking: on-time rates, short shipments, PO fulfillment gaps.', tag: 'AI + STATS', color: '#d97706' },
    { icon: FileText, title: 'Investigation Briefs', desc: 'Auto-generated narratives citing exact amounts, contract clauses, and vendor history.', tag: 'AI', color: '#4f46e5' },
    { icon: CheckCircle2, title: 'Plain English Anomalies', desc: 'Technical flags translated into one-sentence explanations with post-validated amounts.', tag: 'AI', color: '#4f46e5' },
    { icon: Eye, title: 'Pattern Insights', desc: 'Statistical analysis identifies recurring vendor issues meeting significance thresholds.', tag: 'AI + STATS', color: '#d97706' },
    { icon: ClipboardList, title: 'Smart Escalation Routing', desc: 'AI recommends the right person for every exception — AP Manager, Procurement, Legal, or Controller — based on anomaly type, amount, and authority matrix.', tag: 'AI + ALGO', color: '#059669' },
    { icon: Shield, title: 'Complete Audit Trail', desc: 'Every action logged: who resolved it, what they did, when, and why. SOX-ready evidence trail from detection to closure.', tag: 'COMPLIANCE', color: '#dc2626' },
    { icon: Brain, title: 'Self-Learning Intelligence', desc: 'Every resolve and dismiss trains the model. False positives auto-suppress. Severity scores adapt to your team\'s real-world decisions.', tag: 'AI + LEARN', color: '#6d28d9' },
    { icon: Settings, title: 'Natural Language Policy', desc: 'Configure AP rules in plain English. AI translates to parameters you preview.', tag: 'AI + HUMAN', color: '#0369a1' },
    { icon: Brain, title: 'Custom Fine-Tuning', desc: 'Your corrections train specialized adapters on vendor-specific layouts.', tag: 'AI + LEARN', color: '#6d28d9' },
  ];

  const pipeline = [
    { n: '1', t: 'Fact Injection', d: 'Invoices, POs, contracts as structured JSON' },
    { n: '2', t: 'Constrained Gen', d: 'Scoped prompts with anti-fabrication' },
    { n: '3', t: 'Post-Validation', d: 'Every dollar and reference verified' },
    { n: '4', t: 'Deterministic Fallback', d: 'Template output if AI fails' },
  ];

  const deployOptions = [
    { title: 'Managed Cloud', tag: 'DEFAULT', color: '#2563eb', checks: ['Zero Data Retention', 'SOC 2 Type II', '5-min setup'], prov: 'Anthropic Claude API' },
    { title: 'Private VPC', tag: 'ENTERPRISE', color: '#059669', checks: ['Data stays in your VPC', 'AWS / GCP region choice', 'HIPAA / GDPR'], prov: 'AWS Bedrock · Google Vertex AI' },
    { title: 'Air-Gapped', tag: 'ON-PREM', color: '#7c3aed', checks: ['Zero external calls', 'Your hardware + models', 'Defense-grade'], prov: 'Self-hosted AI runtime' },
  ];

  const defaultAuth = [
    { r: 'AP Analyst', l: 'Configurable', c: '#166534' },
    { r: 'AP Manager', l: 'Configurable', c: '#15803d' },
    { r: 'VP Finance', l: 'Configurable', c: '#ca8a04' },
    { r: 'CFO', l: 'Unlimited', c: '#dc2626' },
  ];

  const langs = [['EN','#64748b'],['CN','#ef4444'],['JP','#f97316'],['KR','#3b82f6'],['HI','#eab308'],['DE','#22c55e'],['FR','#6366f1'],['ES','#a855f7'],['PT','#14b8a6'],['AR','#8b5cf6']];
  const taxSystems = ['VAT','GST','MwSt','TVA','IVA','增值税','消費税','ICMS'];
  const trustBadges = ['RBAC', 'JWT Auth', 'SOX-Ready', 'Audit Trail', 'SLA Tracking', `${totalRules} Rules`];

  return (
    <div className="min-h-screen" style={{ background: '#fafbfc' }}>
      {/* ── Nav ── */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/50">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-red-500 shadow-lg shadow-red-200/60 flex items-center justify-center"><Shield className="w-4.5 h-4.5 text-white" /></div>
            <div>
              <div className="text-xl font-extrabold tracking-tight text-slate-900">AuditLens</div>
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[.15em]">AP Intelligence</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onGo} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">Sign In</button>
            <button onClick={onGo} className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-500 rounded-lg hover:bg-slate-800 transition-all">Get Started →</button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-28 pb-12 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[11px] font-semibold mb-5 tracking-wide">
            <Zap className="w-3 h-3" /> AI-POWERED AP AUTOMATION
          </div>
          <h1 className="text-[44px] sm:text-[52px] font-extrabold tracking-[-0.03em] text-slate-900 leading-[1.08] mb-5">
            Audit every invoice<br /><span style={{ color: '#2563eb' }}>before you pay.</span>
          </h1>
          <p className="text-base text-slate-600 max-w-xl mx-auto mb-8 leading-relaxed">
            AI extracts, matches, and flags anomalies in under 8 seconds. Contract intelligence, 9-factor vendor risk, and delivery analytics — before you pay.
          </p>
          <div className="flex gap-3 justify-center mb-4">
            <button onClick={onGo} className="px-7 py-3 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-all shadow-sm">Start Auditing →</button>
            <button className="px-7 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-white transition-colors">Talk to Sales</button>
          </div>
          {<p className="text-xs text-slate-400 tracking-wide">Powered by Ensemble AI</p>}
        </div>
      </section>

      {/* ── Stats Bar ── */}
      <section className="px-6 pb-12">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-8 flex-wrap">
          {[
            { v: '450+', l: 'invoices/hr', c: '#059669' },
            { v: `${totalRules}`, l: 'detection rules', c: '#2563eb' },
            { v: '9', l: 'risk factors', c: '#7c3aed' },
            { v: `${rc14}`, l: 'clause checks', c: '#d97706' },
            { v: '<8s', l: 'per invoice', c: '#dc2626' },
          ].map(st => (
            <div key={st.l} className="text-center">
              <div className="text-3xl font-extrabold tracking-tight" style={{ color: st.c }}>{st.v}</div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">{st.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Processing Pipeline (LIVE DEMO) ── */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-slate-900 uppercase tracking-wider">⚡ How AuditLens Processes Every Invoice</span>
              <span className="shrink-0 px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-bold tracking-wider shadow-sm">LIVE DEMO</span>
            </div>
            <div className="p-5 space-y-2">
              {[
                { icon: Zap, label: 'AI Extraction', sub: 'Ensemble models extract every field in parallel with self-correcting dispute resolution', color: '#4f46e5' },
                { icon: Link2, label: '3-Way Matching', sub: 'Automatically match to POs and goods receipts — AI resolves fuzzy references', color: '#059669' },
                { icon: Shield, label: 'Anomaly Detection', sub: `${rc} base rules plus AI-powered contract compliance, vendor intelligence, and delivery tracking`, color: '#d97706' },
                { icon: FileCheck, label: 'Contract & Vendor Intelligence', sub: 'Clause risk analysis, 9-factor vendor scoring, compliance checks, delivery performance tracking', color: '#7c3aed' },
                { icon: ClipboardList, label: 'Smart Triage', sub: 'Auto-approve clean invoices, route exceptions to the right person with SLA tracking', color: '#dc2626' },
                { icon: FileText, label: 'Investigation Brief', sub: 'AI-generated case narrative citing exact amounts, clauses, and recommended actions', color: '#0369a1' },
              ].map(st => (
                <div key={st.label} className="flex gap-3 items-start p-3 rounded-xl" style={{ background: st.color + '08' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: st.color + '15' }}>
                    <st.icon className="w-4 h-4" style={{ color: st.color }} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">{st.label}</div>
                    <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">{st.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Closed-Loop Intelligence ── */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 text-purple-600 text-[11px] font-semibold mb-3 tracking-wide">
              <Brain className="w-3 h-3" /> CLOSED-LOOP INTELLIGENCE
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">AI that learns from your team</h2>
            <p className="text-sm text-slate-500 mt-2 max-w-xl mx-auto">Every analyst action trains the model. False positives disappear. Severity scores adapt. Your AP intelligence gets sharper with every invoice.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center mb-3"><Check className="w-5 h-5 text-emerald-600" /></div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Resolve → Model Learns</h3>
              <p className="text-xs text-slate-500 leading-relaxed">When analysts correct a PO or adjust payment, the resolution type and context become training data. The model learns which anomalies require real action.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {['Corrected PO', 'Vendor Notified', 'Credit Note', 'Payment Adjusted'].map(t => (
                  <span key={t} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{t}</span>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mb-3"><X className="w-5 h-5 text-slate-500" /></div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Dismiss → Noise Suppressed</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Repeated false positives for a vendor/anomaly combination are auto-suppressed. The model reduces severity for patterns your team consistently dismisses.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {['Approved Exception', 'False Positive', 'Within Tolerance', 'Duplicate'].map(t => (
                  <span key={t} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{t}</span>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center mb-3"><ClipboardList className="w-5 h-5 text-amber-600" /></div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Escalate → Smart Routing</h3>
              <p className="text-xs text-slate-500 leading-relaxed">AI recommends the right person based on anomaly type, amount, and your authority matrix. Terms violations go to Procurement. Budget overruns go to Controller.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {['AP Manager', 'Procurement', 'Controller', 'Legal'].map(t => (
                  <span key={t} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{t}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5 bg-gradient-to-r from-purple-50 to-blue-50 rounded-2xl border border-purple-100 p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0"><Shield className="w-6 h-6 text-purple-600" /></div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 mb-1">Complete Audit Trail — SOX Ready</h3>
                <p className="text-xs text-slate-500 leading-relaxed">Every action is logged with who, what, when, and why. From document upload to anomaly detection to analyst resolution — a complete chain of evidence for internal audit and regulatory compliance. No gaps, no manual reconciliation.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── AP Problem + What We Catch (side by side) ── */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* AP Problem */}
          <div className="rounded-2xl p-6 bg-white border border-slate-200/60">
            <div className="text-[11px] font-bold text-red-500 uppercase tracking-widest mb-2">The AP Problem</div>
            <h3 className="text-xl font-extrabold text-slate-900 mb-2 leading-snug">AP teams lose 1–3% of spend to undetected errors.</h3>
            <p className="text-[13px] text-slate-500 leading-relaxed mb-5">Manual review catches a fraction. AuditLens checks every invoice, every line item — before payment.</p>

            {/* Before / After comparison */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* Manual column */}
              <div className="rounded-xl p-4 bg-red-50/80 border border-red-100">
                <div className="text-[11px] font-bold text-red-400 uppercase tracking-widest mb-3">Manual Process</div>
                <div className="space-y-3">
                  <div>
                    <div className="text-2xl font-extrabold text-red-500">2–3</div>
                    <div className="text-xs text-slate-500">invoices per hour</div>
                  </div>
                  <div>
                    <div className="text-2xl font-extrabold text-red-500">5–15%</div>
                    <div className="text-xs text-slate-500">sample-based review</div>
                  </div>
                  <div>
                    <div className="text-2xl font-extrabold text-red-500">Days</div>
                    <div className="text-xs text-slate-500">to catch exceptions</div>
                  </div>
                </div>
              </div>

              {/* AuditLens column */}
              <div className="rounded-xl p-4 bg-emerald-50/80 border border-emerald-100">
                <div className="text-[11px] font-bold text-emerald-500 uppercase tracking-widest mb-3">With AuditLens</div>
                <div className="space-y-3">
                  <div>
                    <div className="text-2xl font-extrabold text-emerald-600">450+</div>
                    <div className="text-xs text-slate-500">invoices per hour</div>
                  </div>
                  <div>
                    <div className="text-2xl font-extrabold text-emerald-600">100%</div>
                    <div className="text-xs text-slate-500">every invoice, every line</div>
                  </div>
                  <div>
                    <div className="text-2xl font-extrabold text-emerald-600">&lt;8 sec</div>
                    <div className="text-xs text-slate-500">per invoice, end-to-end</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom stat bar */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <span className="text-xs text-slate-600"><span className="font-bold text-slate-800">{totalRules}</span> detection rules</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                <span className="text-xs text-slate-600"><span className="font-bold text-slate-800">9</span> vendor risk factors</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                <span className="text-xs text-slate-600"><span className="font-bold text-slate-800">{rc14}</span> contract clause checks</span>
              </div>
            </div>
          </div>

          {/* What We Catch */}
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-bold text-slate-900 uppercase tracking-wider">What We Catch</span>
            </div>
            <p className="text-[13px] text-slate-500 leading-relaxed mb-4">Three layers of detection — from rule-based flags to AI-powered contract and vendor intelligence.</p>

            {/* Layer 1: Standard rules */}
            <div className="mb-3">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Rule-Based Audit · {rc} Checks</div>
              {ruleNames.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {ruleNames.map(r => <span key={r} className="text-[11px] px-2 py-0.5 rounded bg-red-50 text-red-600 font-medium border border-red-100">{r}</span>)}
                </div>
              )}
            </div>

            {/* Layer 2: AI contract intelligence */}
            <div className="mb-3">
              <div className="text-[11px] font-bold text-indigo-500 uppercase tracking-widest mb-1.5">AI Contract & Vendor Intelligence</div>
              <div className="flex flex-wrap gap-1">
                {[
                  {n: 'Price Drift Detection', d: 'Invoiced vs contracted rates'},
                  {n: 'Expiry Risk Alerts', d: 'Expired or near-expiry contracts'},
                  {n: 'Over-Utilization', d: 'Spend exceeding contract ceiling'},
                  {n: 'Underbilling Audit', d: 'Below-contract pricing anomalies'},
                  {n: 'Volume Commitment', d: 'Minimum purchase shortfall risk'},
                  {n: 'Currency Validation', d: 'Cross-currency invoice checks'},
                ].map(r => (
                  <span key={r.n} className="text-[11px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium border border-indigo-100" title={r.d}>{r.n}</span>
                ))}
              </div>
            </div>

            {/* Layer 3: AI delivery analytics */}
            <div className="mb-3">
              <div className="text-[11px] font-bold text-blue-500 uppercase tracking-widest mb-1.5">AI Delivery Analytics</div>
              <div className="flex flex-wrap gap-1">
                {[
                  {n: 'Chronic Short Shipment', d: 'Repeated under-delivery patterns'},
                  {n: 'Stale PO Fulfillment', d: 'Aged POs with low completion'},
                ].map(r => (
                  <span key={r.n} className="text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium border border-blue-100" title={r.d}>{r.n}</span>
                ))}
              </div>
            </div>

            {/* Opportunity detection */}
            {oppNames.length > 0 && (
              <div className="mb-3">
                <div className="text-[11px] font-bold text-amber-500 uppercase tracking-widest mb-1.5">Savings Opportunities</div>
                <div className="flex flex-wrap gap-1">
                  {oppNames.map(r => <span key={r} className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-medium border border-amber-100">💡 {r}</span>)}
                </div>
              </div>
            )}
            <div className="pt-3 mt-3 border-t border-slate-100">
              <div className="flex flex-wrap gap-1.5">
                {trustBadges.map(t => <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 font-semibold border border-slate-200">{t}</span>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── AI Intelligence Layer ── */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-extrabold tracking-tight">AI Intelligence Layer</h2>
            <p className="text-base text-slate-500 mt-1">AI where it matters. Rules where you need control.</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {features.map(f => (
              <div key={f.title} className="bg-white rounded-xl p-4 border border-slate-200/60 hover:shadow-md hover:border-slate-300/60 transition-all group">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: f.color + '10' }}>
                    <f.icon className="w-3.5 h-3.5" style={{ color: f.color }} />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: f.color, background: f.color + '10' }}>{f.tag}</span>
                </div>
                <h3 className="text-sm font-bold text-slate-900 mb-1 leading-snug">{f.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Enterprise Trust (Authority + Global + Deploy) ── */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-extrabold tracking-tight">Enterprise-Grade Trust</h2>
            <p className="text-base text-slate-500 mt-1">Every number verified. Every decision auditable.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
            {/* Grounded AI */}
            <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-indigo-600" />
                <span className="text-sm font-bold text-slate-900">Grounded AI</span>
              </div>
              <div className="space-y-1.5">
                {pipeline.map(x => (
                  <div key={x.n} className="flex gap-2 items-start">
                    <div className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5">{x.n}</div>
                    <div><div className="text-xs font-semibold text-slate-800">{x.t}</div><div className="text-[11px] text-slate-400">{x.d}</div></div>
                  </div>
                ))}
              </div>
            </div>

            {/* Delegation of Authority */}
            <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-bold text-slate-900">Delegation of Authority</span>
              </div>
              <div className="space-y-1.5">
                {(authTiers.length ? authTiers : defaultAuth).map((a, i) => {
                  const authLevelColors = ['#166534', '#15803d', '#ca8a04', '#dc2626'];
                  const name = a.title || a.r || `Level ${i+1}`;
                  const limit = a.unlimited ? 'Unlimited' : a.limit_usd ? `$${Number(a.limit_usd).toLocaleString()}` : (a.l || 'Configurable');
                  return (
                    <div key={i} className="flex justify-between items-center px-3 py-2 rounded-lg bg-slate-50">
                      <span className="text-xs font-semibold" style={{ color: authLevelColors[i] || '#64748b' }}>{name}</span>
                      <span className="text-xs text-slate-500 font-mono">{limit}</span>
                    </div>
                  );
                })}
              </div>
              {Object.keys(sla).length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">SLA Targets</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(sla).map(([k, v]) => (
                      <span key={k} className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">{k}: <strong>{v}h</strong></span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Global Ready */}
            <div className="bg-white rounded-2xl border border-slate-200/60 p-5">
              <div className="flex items-center gap-2 mb-4">
                <CircleDot className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-bold text-slate-900">{lc} Languages · Global Tax</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5 mb-3">
                {langs.map(([code, clr]) => (
                  <div key={code} className="rounded-md py-1.5 text-center" style={{ background: clr + '10', border: `1px solid ${clr}20` }}>
                    <div className="text-xs font-bold" style={{ color: clr }}>{code}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {taxSystems.map(t => (
                  <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 font-medium border border-slate-200">{t}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Deploy Options */}
          <div className="text-center mb-4 mt-2">
            <h3 className="text-2xl font-extrabold tracking-tight">Deploy Anywhere</h3>
            <p className="text-sm text-slate-600 mt-0.5">Model-agnostic by design. Your data, your infrastructure, your rules.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {deployOptions.map(f => (
              <div key={f.title} className="bg-white rounded-2xl border border-slate-200/60 p-5 relative">
                <div className="absolute top-4 right-4 px-2 py-0.5 rounded text-white text-[11px] font-bold tracking-wider" style={{ background: f.color }}>{f.tag}</div>
                <div className="flex items-center gap-2 mb-3">
                  <Database className="w-4 h-4" style={{ color: f.color }} />
                  <span className="text-sm font-extrabold text-slate-900">{f.title}</span>
                </div>
                <div className="space-y-1.5 mb-3">
                  {f.checks.map(c => (
                    <div key={c} className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="font-bold" style={{ color: f.color }}>✓</span> {c}
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-slate-400 pt-3 border-t border-slate-100"><span className="font-semibold text-slate-500">Provider:</span> {f.prov}</div>
              </div>
            ))}
          </div>

          {/* Config snippet */}
          <div className="mt-5 flex items-center justify-center gap-4 flex-wrap">
            <div className="bg-slate-900 rounded-lg px-4 py-2 font-mono text-sm inline-flex items-center gap-1">
              <span className="text-emerald-400">LLM_PROVIDER</span><span className="text-slate-500">=</span><span className="text-amber-300">bedrock</span>
            </div>
            <span className="text-xs text-slate-500">One config change. Same extraction, same anomaly detection, same audit trail.</span>
          </div>
        </div>
      </section>

      {/* ── ERP Integrations ── */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto text-center">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Connects to your existing systems</div>
          <div className="flex flex-wrap justify-center gap-3 mb-2">
            {['SAP S/4HANA', 'Oracle EBS', 'NetSuite', 'Microsoft Dynamics', 'QuickBooks', 'Sage', 'Workday', 'Xero'].map(e => (
              <span key={e} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-700 shadow-sm">{e}</span>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2">REST API + file-based integration · Batch or real-time · No ERP modifications required</p>
        </div>
      </section>

      {/* ── ROI & Compliance ── */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* ROI */}
          <div className="rounded-2xl bg-white border border-slate-200/60 p-6">
            <div className="text-[11px] font-bold text-emerald-600 uppercase tracking-widest mb-3">Expected Impact</div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {[
                { v: '1–3%', l: 'Spend recovery', d: 'From overcharges, duplicates, contract drift' },
                { v: '85%', l: 'Less manual review', d: 'AI auto-approves clean invoices' },
                { v: '10×', l: 'Faster processing', d: '450+ inv/hr vs 2–3 manual' },
                { v: '100%', l: 'Audit coverage', d: 'Every invoice, every line item' },
              ].map(s => (
                <div key={s.l} className="text-center">
                  <div className="text-2xl font-extrabold text-emerald-600">{s.v}</div>
                  <div className="text-xs font-bold text-slate-700">{s.l}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{s.d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Compliance */}
          <div className="rounded-2xl bg-white border border-slate-200/60 p-6">
            <div className="text-[11px] font-bold text-blue-600 uppercase tracking-widest mb-3">Compliance & Security</div>
            <div className="space-y-2">
              {[
                { badge: 'SOX 404', desc: 'Segregation of duties, approval workflows, complete audit trail' },
                { badge: 'SOC 2 Type II', desc: 'Infrastructure and data handling security controls' },
                { badge: 'GDPR / DPDP', desc: 'Data residency options, right to erasure, Zero Data Retention mode' },
                { badge: 'RBAC', desc: '4-tier role-based access control with configurable authority limits' },
                { badge: 'Audit Trail', desc: 'Every action, decision, and AI recommendation logged with timestamp' },
              ].map(c => (
                <div key={c.badge} className="flex gap-3 items-start">
                  <span className="text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-100 whitespace-nowrap">{c.badge}</span>
                  <span className="text-xs text-slate-600">{c.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl p-10 text-center text-white" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
            <h2 className="text-3xl font-extrabold tracking-tight mb-2">See what your AP team is missing.</h2>
            <p className="text-base text-slate-500 mb-6">Upload your first invoice — extracted, matched, and audited in under 8 seconds.</p>
            <button onClick={onGo} className="px-8 py-3 text-sm font-semibold text-slate-900 bg-white rounded-xl hover:bg-slate-50 transition-all shadow-lg">Start Free →</button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-6 px-6">
        <div className="max-w-6xl mx-auto flex justify-between items-center text-[11px] text-slate-400">
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
    settings: SettingsPage, training: Training, upload: UploadPage, audit_trail: AuditTrail,
  };
  const Page = pages[s.tab] || Dashboard;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 ml-[258px] p-8 min-w-0 overflow-x-hidden">
        <Page />
      </main>
      <DocModal />
      <Toast />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ERROR BOUNDARY — catches React crashes, shows recovery UI
   ═══════════════════════════════════════════════════ */
import React from 'react';
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('AuditLens UI Error:', error, info); }
  render() {
    if (this.state.hasError) return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-slate-500 mb-4">{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            className="px-4 py-2 bg-accent-600 text-white rounded-lg text-sm font-semibold hover:bg-accent-700">
            Reload AuditLens
          </button>
        </div>
      </div>
    );
    return this.props.children;
  }
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
  return <ErrorBoundary><AppShell /></ErrorBoundary>;
}

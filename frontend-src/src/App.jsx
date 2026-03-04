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
      { id: 'workforce', label: 'Workforce', icon: Activity },
      { id: 'settings', label: 'AP Policy', icon: Settings },
      { id: 'team', label: 'Team & Access', icon: Users },
      { id: 'training', label: 'Model Training', icon: Brain },
      { id: 'data_governance', label: 'Data Governance', icon: Shield },
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

  // ── AI Intelligence data ──
  const [aiInsights, setAiInsights] = useState(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [paymentPri, setPaymentPri] = useState(null);

  useEffect(() => {
    api('/api/rag/stats').then(r => { if (r && !r._err) setAiInsights(prev => ({ ...prev, rag: r })); });
    api('/api/custom-model').then(r => { if (r && !r._err) setAiInsights(prev => ({ ...prev, model: r })); });
    api('/api/correction-patterns').then(r => { if (r && !r._err) setAiInsights(prev => ({ ...prev, corrections: r })); });
  }, [s.tabKey]);

  // ── Compute intelligence metrics ──
  const allAnoms = s.anomalies || [];
  const resolvedAnoms = allAnoms.filter(a => a.status === 'resolved' || a.status === 'dismissed');
  const highRiskAnoms = oa.filter(a => a.severity === 'high');
  const totalRisk = oa.reduce((s, a) => s + Math.abs(a.amount_at_risk || 0), 0);
  const correctionCount = aiInsights?.corrections?.patterns?.length || aiInsights?.corrections?.total || d.correction_patterns || 0;
  const ragChunks = aiInsights?.rag?.total_chunks || 0;
  const modelStatus = aiInsights?.model?.enabled ? 'Active' : correctionCount >= 50 ? 'Ready to Train' : 'Learning';

  // ── Vendor risk radar ──
  const vendorProfiles = s.vendors || [];
  const riskyVendors = vendorProfiles.filter(v => v.riskLevel === 'high' || (v.anomalyCount || 0) > 3).slice(0, 5);

  // ── Expiring contracts & cases ──
  const intel = s.intel || {};
  const exp = intel.expiring_contracts || [];
  const ch = intel.contract_health || [];
  const activeCases = (s.casesData || []).filter(c => c.status !== 'resolved' && c.status !== 'closed');

  return (
    <div className="page-enter space-y-6">
      <PageHeader title="Dashboard" sub="AP Intelligence Command Center" />

      {/* ── INTELLIGENCE HERO BANNER ── */}
      <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #1e293b, #334155)' }}>
        <div className="flex justify-between items-start flex-wrap gap-6">
          <div>
            <div className="text-xs font-medium opacity-60 uppercase tracking-wider mb-2">Intelligence Summary</div>
            <div className="text-3xl font-extrabold tracking-tight">{$(totalRisk)} <span className="text-base opacity-60 font-normal">total risk identified</span></div>
            <div className="text-sm opacity-70 mt-1">{oa.length} open anomalies across {num(sb.total_invoices || 0)} invoices from {vendorProfiles.length} vendors</div>
          </div>
          <div className="flex gap-6 flex-wrap text-center">
            <div><div className="text-2xl font-bold text-emerald-400">{sv > 0 ? $(sv) : '$0'}</div><div className="text-xs opacity-60">Savings Found</div></div>
            <div><div className="text-2xl font-bold text-amber-400">{highRiskAnoms.length}</div><div className="text-xs opacity-60">High Risk</div></div>
            <div><div className="text-2xl font-bold text-blue-400">{activeCases.length}</div><div className="text-xs opacity-60">Active Cases</div></div>
            <div><div className="text-2xl font-bold text-purple-400">{correctionCount}</div><div className="text-xs opacity-60">AI Learned</div></div>
          </div>
        </div>
      </div>

      {/* ── LEARNING LOOP INDICATOR (Rec #3) ── */}
      <div className="rounded-2xl border border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center"><Brain className="w-5 h-5 text-purple-600" /></div>
          <div>
            <div className="text-sm font-bold text-purple-900">System Learning Status</div>
            <div className="text-xs text-purple-600">AuditLens gets smarter with every correction</div>
          </div>
          <div className="ml-auto"><Badge c={modelStatus === 'Active' ? 'ok' : modelStatus === 'Ready to Train' ? 'warn' : 'info'}>{modelStatus}</Badge></div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 bg-white/70 rounded-xl">
            <div className="text-xl font-extrabold text-purple-700">{correctionCount}</div>
            <div className="text-[11px] text-purple-500">Corrections Learned</div>
          </div>
          <div className="p-3 bg-white/70 rounded-xl">
            <div className="text-xl font-extrabold text-indigo-700">{ragChunks}</div>
            <div className="text-[11px] text-indigo-500">RAG Knowledge Chunks</div>
          </div>
          <div className="p-3 bg-white/70 rounded-xl">
            <div className="text-xl font-extrabold text-blue-700">{pct(sb.avg_confidence)}</div>
            <div className="text-[11px] text-blue-500">Avg Extraction Accuracy</div>
          </div>
          <div className="p-3 bg-white/70 rounded-xl">
            <div className="text-xl font-extrabold text-violet-700">{resolvedAnoms.length}/{allAnoms.length}</div>
            <div className="text-[11px] text-violet-500">Anomalies Resolved</div>
          </div>
        </div>
        {correctionCount > 0 && (
          <div className="mt-3 text-xs text-purple-600 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            {correctionCount >= 50
              ? `Custom model ready — ${correctionCount} vendor-specific corrections available for fine-tuning`
              : `${50 - correctionCount} more corrections until custom model training is available`}
          </div>
        )}
      </div>

      {/* ── PROACTIVE AI RECOMMENDATIONS (Rec #2) ── */}
      {(() => {
        const recommendations = [];
        // Duplicate pattern detection
        const dupAnoms = (s.anomalies || []).filter(a => a.type === 'DUPLICATE_INVOICE' && a.status === 'open');
        if (dupAnoms.length > 0) {
          const vendors = [...new Set(dupAnoms.map(a => a.vendor).filter(Boolean))];
          const risk = dupAnoms.reduce((s, a) => s + Math.abs(a.amount_at_risk || 0), 0);
          recommendations.push({ icon: '🔄', severity: 'high', color: 'red',
            title: `${dupAnoms.length} potential duplicate${dupAnoms.length > 1 ? 's' : ''} detected`,
            detail: `${vendors.join(', ')} — ${$(risk)} at risk. Review immediately to prevent double payment.` });
        }
        // Over-invoicing pattern
        const overInvAnoms = (s.anomalies || []).filter(a => (a.type === 'AMOUNT_DISCREPANCY' || a.type === 'PRICE_OVERCHARGE') && a.status === 'open');
        if (overInvAnoms.length >= 2) {
          const vendors = [...new Set(overInvAnoms.map(a => a.vendor).filter(Boolean))];
          recommendations.push({ icon: '📈', severity: 'medium', color: 'amber',
            title: `Escalating over-invoicing from ${vendors.length} vendor${vendors.length > 1 ? 's' : ''}`,
            detail: `${vendors.slice(0, 2).join(', ')}${vendors.length > 2 ? ` + ${vendors.length - 2} more` : ''} — consider tightening PO tolerance or scheduling vendor review.` });
        }
        // Stale invoices
        const staleAnoms = (s.anomalies || []).filter(a => a.type === 'STALE_INVOICE' && a.status === 'open');
        if (staleAnoms.length > 0) {
          recommendations.push({ icon: '⏰', severity: 'low', color: 'blue',
            title: `${staleAnoms.length} stale invoice${staleAnoms.length > 1 ? 's' : ''} aging beyond policy`,
            detail: `Consider resolving or archiving to improve working capital metrics and audit posture.` });
        }
        // Missing PO
        const missingPo = (s.anomalies || []).filter(a => a.type === 'MISSING_PO' && a.status === 'open');
        if (missingPo.length >= 3) {
          recommendations.push({ icon: '📋', severity: 'medium', color: 'amber',
            title: `${missingPo.length} invoices without PO reference`,
            detail: `Indicates possible maverick spending. Consider enforcing PO-mandatory policy for these vendors.` });
        }
        // Early pay opportunities
        const earlyPay = (s.anomalies || []).filter(a => a.type === 'EARLY_PAYMENT_DISCOUNT' && a.status === 'open');
        if (earlyPay.length > 0) {
          const savings = earlyPay.reduce((s, a) => s + Math.abs(a.amount_at_risk || 0), 0);
          recommendations.push({ icon: '💰', severity: 'opportunity', color: 'emerald',
            title: `${$(savings)} in early payment discounts available`,
            detail: `${earlyPay.length} invoice${earlyPay.length > 1 ? 's' : ''} eligible for 2% discount. Use Payment Optimizer below to capture savings.` });
        }
        // Learning loop readiness
        if (correctionCount >= 50 && modelStatus !== 'Active') {
          recommendations.push({ icon: '🧠', severity: 'opportunity', color: 'purple',
            title: 'Custom model ready for training',
            detail: `${correctionCount} corrections accumulated — fine-tuning will improve extraction accuracy for your vendor patterns. Go to Training page to initiate.` });
        }
        if (recommendations.length === 0) return null;
        const colorMap = { red: 'border-red-200 bg-red-50', amber: 'border-amber-200 bg-amber-50', blue: 'border-blue-200 bg-blue-50', emerald: 'border-emerald-200 bg-emerald-50', purple: 'border-purple-200 bg-purple-50' };
        const textMap = { red: 'text-red-700', amber: 'text-amber-700', blue: 'text-blue-700', emerald: 'text-emerald-700', purple: 'text-purple-700' };
        return (
          <div className="card p-5">
            <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Brain className="w-4 h-4 text-indigo-500" /> AI Recommendations ({recommendations.length})
            </h3>
            <div className="space-y-2">
              {recommendations.map((r, i) => (
                <div key={i} className={cn('flex items-start gap-3 p-3 rounded-xl border', colorMap[r.color])}>
                  <span className="text-lg">{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className={cn('text-sm font-semibold', textMap[r.color])}>{r.title}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{r.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── PRIMARY STAT CARDS ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Total Invoices" value={num(sb.total_invoices || 0)} color="#3b82f6" />
        <StatCard icon={Zap} label="Auto-Approved" value={pct(sb.auto_approve_rate)} sub={`${tri.auto_approved || 0} invoices`} color="#10b981" />
        <StatCard icon={AlertTriangle} label="Open Anomalies" value={oa.length} sub={`${short(sb.total_risk || 0, 'USD')} at risk`} color="#ef4444" />
        <StatCard icon={Shield} label="Avg Confidence" value={pct(sb.avg_confidence)} color="#8b5cf6" />
      </div>

      {/* ── Processing Speed ── */}
      {sp.documents_with_timing > 0 && (
        <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg, #1e40af, #3b82f6)' }}>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <div className="text-sm font-medium opacity-85 mb-1">⚡ Processing Speed</div>
              <div className="text-2xl font-extrabold">{sp.avg_total_seconds || 0}s <span className="text-sm opacity-75">avg per document</span></div>
              <div className="text-xs opacity-70 mt-1">vs 15 min manual — <strong>{sp.speedup_factor || 0}x faster</strong></div>
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

      {/* ── ACTION REQUIRED + RISK RADAR (Rec #2) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Action Required Panel */}
        <div className="card p-5">
          <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" /> Action Required
          </h3>
          <div className="space-y-2">
            {highRiskAnoms.length > 0 && (
              <div className="flex items-center gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <div className="flex-1 text-sm"><span className="font-bold text-red-700">{highRiskAnoms.length} high-severity anomalies</span> need investigation</div>
                <div className="text-sm font-bold text-red-600 font-mono">{$(highRiskAnoms.reduce((s, a) => s + Math.abs(a.amount_at_risk || 0), 0))}</div>
              </div>
            )}
            {activeCases.filter(c => c.priority === 'critical').length > 0 && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <div className="flex-1 text-sm"><span className="font-bold text-amber-700">{activeCases.filter(c => c.priority === 'critical').length} critical cases</span> awaiting resolution</div>
              </div>
            )}
            {exp.length > 0 && (
              <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                <div className="flex-1 text-sm"><span className="font-bold text-orange-700">{exp.length} contract{exp.length > 1 ? 's' : ''}</span> expiring within 90 days</div>
              </div>
            )}
            {(tri.blocked || 0) > 0 && (
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="w-2 h-2 rounded-full bg-slate-500" />
                <div className="flex-1 text-sm"><span className="font-bold text-slate-700">{tri.blocked} invoices blocked</span> in triage queue</div>
              </div>
            )}
            {highRiskAnoms.length === 0 && activeCases.length === 0 && exp.length === 0 && (
              <div className="text-center py-6 text-slate-400 text-sm">All clear — no immediate actions needed</div>
            )}
          </div>
        </div>

        {/* Vendor Risk Radar */}
        <div className="card p-5">
          <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-amber-500" /> Vendor Risk Radar
          </h3>
          {riskyVendors.length > 0 ? (
            <div className="space-y-3">{riskyVendors.map((v, i) => {
              const riskPct = Math.min(100, (v.riskScore || v.anomalyCount * 15 || 30));
              const riskColor = riskPct >= 70 ? '#ef4444' : riskPct >= 40 ? '#f59e0b' : '#10b981';
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{v.vendor || v.name || 'Unknown'}</span>
                    <span className="text-xs"><Badge c={v.riskLevel === 'high' ? 'err' : v.riskLevel === 'medium' ? 'warn' : 'ok'}>{v.riskLevel}</Badge></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${riskPct}%`, background: riskColor }} />
                    </div>
                    <span className="text-xs font-mono text-slate-500">{v.anomalyCount || 0} flags</span>
                  </div>
                </div>
              );
            })}</div>
          ) : tv.length > 0 ? (
            <div className="space-y-3">{tv.map((v, i) => {
              const p = tv[0]?.spend > 0 ? (v.spend / tv[0].spend) * 100 : 0;
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600 font-medium">{v.vendor || 'Unknown'}</span>
                    <span className="font-mono font-semibold text-xs">{$(v.spend)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${p}%`, background: 'linear-gradient(90deg, #3b82f6, #7c3aed)' }} />
                  </div>
                </div>
              );
            })}</div>
          ) : <div className="text-center py-6 text-slate-400 text-sm">Upload invoices to build vendor risk profiles</div>}
        </div>
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

      {/* ── Savings Banner ── */}
      {sv > 0 && (
        <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <div className="text-sm font-medium opacity-85 mb-1">✔ Confirmed Savings</div>
              <div className="text-3xl font-extrabold">{$(sv)}</div>
            </div>
            <div className="flex gap-6 flex-wrap">
              {svb.overcharges > 0 && <div className="text-center"><div className="text-xl font-bold">{$(svb.overcharges)}</div><div className="text-xs opacity-75">Overcharges</div></div>}
              {svb.duplicates_prevented > 0 && <div className="text-center"><div className="text-xl font-bold">{$(svb.duplicates_prevented)}</div><div className="text-xs opacity-75">Duplicates</div></div>}
              {svb.early_payment_opportunities > 0 && <div className="text-center"><div className="text-xl font-bold">{$(svb.early_payment_opportunities)}</div><div className="text-xs opacity-75">Early Pay</div></div>}
            </div>
          </div>
        </div>
      )}

      {/* ── PAYMENT PRIORITIES (Rec #1 — last unwired AI feature) ── */}
      {(() => {
        const [payPri, setPayPri] = useState(null);
        const [payLoading, setPayLoading] = useState(false);
        const [payBudget, setPayBudget] = useState(50000);
        async function loadPayPri(budget) {
          setPayLoading(true);
          const r = await api(`/api/ai/payment-priorities?budget_limit=${budget}`);
          setPayLoading(false);
          if (r && !r._err) setPayPri(r);
        }
        const approvedInvs = (s.docs || []).filter(d => d.type === 'invoice' && (d.triageLane === 'AUTO_APPROVE' || d.status === 'approved'));
        if (approvedInvs.length === 0 && !payPri) return null;
        return (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" /> AI Payment Optimization
              </h3>
              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-500">Budget:</label>
                <input type="range" min={10000} max={200000} step={5000} value={payBudget}
                  onChange={e => setPayBudget(Number(e.target.value))}
                  className="w-32 accent-emerald-500" />
                <span className="text-sm font-bold font-mono text-emerald-700">{$(payBudget)}</span>
                <button onClick={() => loadPayPri(payBudget)} disabled={payLoading}
                  className="btn bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs flex items-center gap-1.5 border border-emerald-200">
                  <Brain className="w-3.5 h-3.5" /> {payLoading ? 'Optimizing...' : 'Optimize Run'}
                </button>
              </div>
            </div>
            {payPri ? (
              <div>
                {payPri.summary && (
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                      <div className="text-xl font-extrabold text-emerald-700">{$(payPri.summary.total_payable || payPri.summary.totalPayable || 0)}</div>
                      <div className="text-[10px] text-emerald-500 uppercase font-semibold">Recommended Payment</div>
                    </div>
                    <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                      <div className="text-xl font-extrabold text-blue-700">{$(payPri.summary.early_discount_savings || payPri.summary.discountSavings || 0)}</div>
                      <div className="text-[10px] text-blue-500 uppercase font-semibold">Early Pay Savings</div>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                      <div className="text-xl font-extrabold text-amber-700">{payPri.summary.invoice_count || payPri.summary.invoiceCount || 0}</div>
                      <div className="text-[10px] text-amber-500 uppercase font-semibold">Invoices in Run</div>
                    </div>
                  </div>
                )}
                {payPri.priorities && payPri.priorities.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {payPri.priorities.slice(0, 8).map((p, i) => (
                      <div key={i} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white",
                            i < 3 ? "bg-emerald-500" : "bg-slate-400")}>{i + 1}</div>
                          <div>
                            <div className="text-sm font-semibold text-slate-800">{p.invoice_number || p.invoiceNumber || p.vendor}</div>
                            <div className="text-xs text-slate-500">{p.vendor}{p.reason ? ` · ${p.reason}` : ''}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold font-mono">{$(p.amount || 0)}</div>
                          {p.discount_available && <div className="text-[10px] text-emerald-600 font-medium">💰 {p.discount_pct || '2%'} discount</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {payPri.narrative && <div className="mt-3 text-xs text-slate-600 bg-slate-50 rounded-xl p-3 border border-slate-100 leading-relaxed">{payPri.narrative}</div>}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400 text-sm">
                Set a budget and click <strong>Optimize Run</strong> to get AI-prioritized payment recommendations
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Contract Intelligence (existing) ── */}
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
  const [learningStats, setLearningStats] = useState(null);
  useEffect(() => {
    Promise.all([
      api('/api/correction-patterns'),
      api('/api/custom-model'),
    ]).then(([cp, cm]) => {
      if (cp && !cp._err) setLearningStats(prev => ({ ...prev, corrections: cp }));
      if (cm && !cm._err) setLearningStats(prev => ({ ...prev, model: cm }));
    });
  }, [s.tabKey]);

  const corrCount = learningStats?.corrections?.patterns?.length || learningStats?.corrections?.total || 0;
  const modelActive = learningStats?.model?.enabled;
  // Group corrections by vendor
  const vendorCorrections = {};
  (learningStats?.corrections?.patterns || []).forEach(p => {
    if (p.vendor) vendorCorrections[p.vendor] = (vendorCorrections[p.vendor] || 0) + 1;
  });
  const topVendors = Object.entries(vendorCorrections).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="page-enter">
      <PageHeader title="Documents" sub={`${s.docs.length} documents extracted`}>
        <div className="relative"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp pl-9 w-64" placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} /></div>
        <button onClick={() => d({ type: 'TAB', tab: 'upload' })} className="btn-p"><Upload className="w-4 h-4" /> Upload</button>
      </PageHeader>

      {/* ── Learning Loop Indicator (Rec #3) ── */}
      {corrCount > 0 && (
        <div className="mb-4 rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 px-4 py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center"><Brain className="w-4 h-4 text-purple-600" /></div>
              <div>
                <div className="text-sm font-bold text-purple-900">Extraction Learning Active</div>
                <div className="text-xs text-purple-600">
                  {corrCount} corrections learned{modelActive ? ' · Custom model active' : corrCount >= 50 ? ' · Ready for fine-tuning' : ` · ${Math.max(0, 50 - corrCount)} more until fine-tuning`}
                </div>
              </div>
            </div>
            {topVendors.length > 0 && (
              <div className="flex gap-2">
                {topVendors.map(([v, c]) => (
                  <span key={v} className="text-[10px] px-2 py-1 bg-white/70 rounded-lg text-purple-700 border border-purple-100">
                    {v.split(' ')[0]}: <strong>{c}</strong> fixes
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
  const [sevFilter, setSevFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [sortBy, setSortBy] = useState('risk');
  const [expandedInv, setExpandedInv] = useState(null);

  useEffect(() => { if (s.tab === 'anomalies') { setSel(null); setActionMode(''); setActionType(''); setNotes(''); setExpandedInv(null); } }, [s.tabKey]);

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
  // Claim helpers
  const myId = s.user?.id;
  const lvl = RL[s.user?.role] || 0;
  const isAnomMine = (a) => a.claimedBy === myId;
  const isAnomClaimed = (a) => a.claimedBy && a.claimedBy !== myId;
  const canActionAnom = (a) => !a.claimedBy || a.claimedBy === myId || lvl >= 1;

  async function claimAnom(id) {
    const r = await post(`/api/anomalies/${id}/claim`, {});
    if (r?.success) { toast('Anomaly claimed — you can now action it', 'success'); await load(); }
    else toast(r?.detail || 'Claim failed', 'danger');
  }
  async function releaseAnom(id) {
    const r = await post(`/api/anomalies/${id}/release`, {});
    if (r?.success) { toast('Claim released', 'success'); await load(); setSel(null); }
    else toast(r?.detail || 'Release failed', 'danger');
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
    await post(`/api/anomalies/${anom.id}/resolve`, { resolution: `[Escalated to ${route.primary}] Case created for investigation.` });
    await load(); setActionMode(''); toast(`Escalated to ${route.primary} — case created`, 'success');
  }

  // ── Categorize anomaly types ──
  const contractTypes = ['CONTRACT_PRICE_DRIFT','CONTRACT_EXPIRY_WARNING','CONTRACT_OVER_UTILIZATION','CONTRACT_UNDERBILLING','VOLUME_COMMITMENT_GAP','CONTRACT_CURRENCY_MISMATCH'];
  const deliveryTypes = ['CHRONIC_SHORT_SHIPMENT','PO_FULFILLMENT_STALE','SHORT_SHIPMENT','OVERBILLED_VS_RECEIVED','QUANTITY_RECEIVED_MISMATCH','UNRECEIPTED_INVOICE'];
  function anomCategory(type) {
    if (contractTypes.includes(type)) return 'contract';
    if (deliveryTypes.includes(type)) return 'delivery';
    return 'invoice';
  }
  const catLabel = { contract: 'Contract', delivery: 'Delivery', invoice: 'Invoice' };
  const catColor = { contract: 'text-indigo-600 bg-indigo-50 border-indigo-200', delivery: 'text-blue-600 bg-blue-50 border-blue-200', invoice: 'text-amber-600 bg-amber-50 border-amber-200' };

  // ── Filter pipeline: status first, then cross-filters ──
  // Step 1: Apply status tab filter
  const tabFiltered = tab === 'all' ? anoms : anoms.filter(a => a.status === (tab === 'dismissed' ? 'dismissed' : tab));

  // Step 2: Apply cross-filters (sev/cat/vendor) on the tab-filtered set
  let filtered = tabFiltered;
  if (sevFilter) filtered = filtered.filter(a => a.severity === sevFilter);
  if (catFilter) filtered = filtered.filter(a => anomCategory(a.type) === catFilter);
  if (vendorFilter) filtered = filtered.filter(a => a.vendor === vendorFilter);

  // ── Summary stats: severity counts from tab-filtered; category counts from tab+sev filtered ──
  const highCount = tabFiltered.filter(a => a.severity === 'high').length;
  const medCount = tabFiltered.filter(a => a.severity === 'medium').length;
  const lowCount = tabFiltered.filter(a => a.severity === 'low').length;
  const tabSevFiltered = sevFilter ? tabFiltered.filter(a => a.severity === sevFilter) : tabFiltered;
  const catCounts = { contract: 0, delivery: 0, invoice: 0 };
  tabSevFiltered.forEach(a => { catCounts[anomCategory(a.type)]++; });
  const vendors = [...new Set(tabSevFiltered.map(a => a.vendor).filter(Boolean))];

  // ── Global totals for tab badges: apply sev/cat/vendor across all statuses ──
  const applyNonStatusFilters = (list) => {
    let r = list;
    if (sevFilter) r = r.filter(a => a.severity === sevFilter);
    if (catFilter) r = r.filter(a => anomCategory(a.type) === catFilter);
    if (vendorFilter) r = r.filter(a => a.vendor === vendorFilter);
    return r;
  };
  const openAnoms = applyNonStatusFilters(anoms.filter(a => a.status === 'open'));
  const resolvedAnoms = applyNonStatusFilters(anoms.filter(a => a.status !== 'open'));
  const allFiltered = applyNonStatusFilters(anoms);
  const totalRisk = openAnoms.reduce((s, a) => s + Math.abs(a.amount_at_risk || 0), 0);
  const hasActiveFilters = !!(sevFilter || catFilter || vendorFilter);

  // ── Group by invoice ──
  const groups = {};
  filtered.forEach(a => {
    const key = a.invoiceNumber || a.invoiceId || a.id;
    if (!groups[key]) groups[key] = { key, invoiceNumber: a.invoiceNumber || a.invoiceId, vendor: a.vendor, anomalies: [], totalRisk: 0, highestSev: 'low' };
    groups[key].anomalies.push(a);
    groups[key].totalRisk += Math.abs(a.amount_at_risk || 0);
    if (a.severity === 'high' || (a.severity === 'medium' && groups[key].highestSev === 'low')) groups[key].highestSev = a.severity;
  });
  let groupList = Object.values(groups);
  if (sortBy === 'risk') groupList.sort((a, b) => b.totalRisk - a.totalRisk);
  else if (sortBy === 'severity') groupList.sort((a, b) => { const o = { high: 3, medium: 2, low: 1 }; return (o[b.highestSev] || 0) - (o[a.highestSev] || 0); });
  else if (sortBy === 'count') groupList.sort((a, b) => b.anomalies.length - a.anomalies.length);

  return (
    <div className="page-enter">
      <PageHeader title="Anomalies" sub={
        hasActiveFilters
          ? `${filtered.length} matching across ${Object.keys(groups).length} invoices${sevFilter ? ` · ${sevFilter} severity` : ''}${catFilter ? ` · ${catLabel[catFilter]}` : ''}${vendorFilter ? ` · ${vendorFilter}` : ''}`
          : `${openAnoms.length} open across ${new Set(openAnoms.map(a => a.invoiceNumber || a.invoiceId || a.id)).size} invoices`
      } />

      {/* ── Layer 1: Summary Dashboard Strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <div className="card p-3 text-center">
          <div className="text-2xl font-extrabold text-red-600">{$(totalRisk)}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Total Risk</div>
        </div>
        <div className={cn("card p-3 text-center cursor-pointer transition-all", sevFilter === 'high' ? 'bg-red-600 ring-2 ring-red-300' : 'hover:ring-2 hover:ring-red-200')} onClick={() => { setSevFilter(sevFilter === 'high' ? '' : 'high'); setSel(null); }}>
          <div className={cn("text-2xl font-extrabold", sevFilter === 'high' ? 'text-white' : 'text-red-600')}>{highCount}</div>
          <div className={cn("text-[10px] font-bold uppercase tracking-wider mt-0.5", sevFilter === 'high' ? 'text-red-100' : 'text-slate-400')}>{sevFilter === 'high' ? 'High (filtered)' : 'High Severity'}</div>
        </div>
        <div className={cn("card p-3 text-center cursor-pointer transition-all", sevFilter === 'medium' ? 'bg-amber-500 ring-2 ring-amber-300' : 'hover:ring-2 hover:ring-amber-200')} onClick={() => { setSevFilter(sevFilter === 'medium' ? '' : 'medium'); setSel(null); }}>
          <div className={cn("text-2xl font-extrabold", sevFilter === 'medium' ? 'text-white' : 'text-amber-500')}>{medCount}</div>
          <div className={cn("text-[10px] font-bold uppercase tracking-wider mt-0.5", sevFilter === 'medium' ? 'text-amber-100' : 'text-slate-400')}>{sevFilter === 'medium' ? 'Medium (filtered)' : 'Medium'}</div>
        </div>
        <div className={cn("card p-3 text-center cursor-pointer transition-all", sevFilter === 'low' ? 'bg-emerald-500 ring-2 ring-emerald-300' : 'hover:ring-2 hover:ring-green-200')} onClick={() => { setSevFilter(sevFilter === 'low' ? '' : 'low'); setSel(null); }}>
          <div className={cn("text-2xl font-extrabold", sevFilter === 'low' ? 'text-white' : 'text-emerald-500')}>{lowCount}</div>
          <div className={cn("text-[10px] font-bold uppercase tracking-wider mt-0.5", sevFilter === 'low' ? 'text-emerald-100' : 'text-slate-400')}>{sevFilter === 'low' ? 'Low (filtered)' : 'Low'}</div>
        </div>
        <div className="card p-3 text-center">
          <div className="text-2xl font-extrabold text-slate-700">{resolvedAnoms.length}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Resolved</div>
        </div>
      </div>

      {/* ── Layer 2: Filter Bar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Status tabs */}
        {[['open', `Open (${openAnoms.length})`], ['resolved', `Resolved (${resolvedAnoms.length})`], ['all', `All (${allFiltered.length})`]].map(([k, label]) =>
          <button key={k} onClick={() => { setTab(k); setSel(null); setExpandedInv(null); }} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all', tab === k ? 'bg-accent-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{label}</button>
        )}
        <div className="w-px h-6 bg-slate-200 mx-1" />
        {/* Category filters */}
        {Object.entries(catCounts).filter(([, c]) => c > 0).map(([cat, count]) => (
          <button key={cat} onClick={() => { setCatFilter(catFilter === cat ? '' : cat); setSel(null); }}
            className={cn('px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all',
              catFilter === cat ? catColor[cat] + ' border-current ring-1 ring-current' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100')}>
            {catLabel[cat]} ({count})
          </button>
        ))}
        <div className="w-px h-6 bg-slate-200 mx-1" />
        {/* Vendor filter */}
        {vendors.length > 1 && (
          <select value={vendorFilter} onChange={e => { setVendorFilter(e.target.value); setSel(null); }}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-600 bg-white focus:ring-2 focus:ring-accent-500">
            <option value="">All Vendors</option>
            {vendors.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        {/* Sort */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-600 bg-white ml-auto focus:ring-2 focus:ring-accent-500">
          <option value="risk">Sort: Highest Risk</option>
          <option value="severity">Sort: Severity</option>
          <option value="count">Sort: Most Anomalies</option>
        </select>
        {/* Clear filters */}
        {(sevFilter || catFilter || vendorFilter) && (
          <button onClick={() => { setSevFilter(''); setCatFilter(''); setVendorFilter(''); }} className="text-xs text-red-500 font-semibold hover:text-red-700">✕ Clear</button>
        )}
      </div>

      {/* ── Layer 3: Invoice-Grouped List + Detail Panel ── */}
      <div className="flex gap-6">
        <div className={cn('transition-all space-y-2', sel ? 'w-1/2' : 'w-full')}>
          {groupList.length === 0 && (
            <div className="card p-12 text-center text-slate-400 text-sm">No anomalies match your filters</div>
          )}
          {groupList.map(g => {
            const isExpanded = expandedInv === g.key;
            const sevBg = g.highestSev === 'high' ? 'border-l-red-500' : g.highestSev === 'medium' ? 'border-l-amber-400' : 'border-l-emerald-400';
            return (
              <div key={g.key} className={cn('card overflow-hidden border-l-4', sevBg)}>
                {/* Invoice header row */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedInv(isExpanded ? null : g.key)}>
                  <div className="flex-shrink-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{g.invoiceNumber}</span>
                      <span className="text-xs text-slate-500">·</span>
                      <span className="text-xs text-slate-500">{g.vendor}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-600 font-bold rounded-full">{g.anomalies.length} {g.anomalies.length === 1 ? 'anomaly' : 'anomalies'}</span>
                    <Badge c={g.highestSev === 'high' ? 'err' : g.highestSev === 'medium' ? 'warn' : 'ok'}>{g.highestSev}</Badge>
                    <span className={cn('text-sm font-bold tabular-nums', g.totalRisk > 0 ? 'text-red-600' : 'text-slate-400')}>{$(g.totalRisk)}</span>
                  </div>
                </div>

                {/* Expanded anomaly rows */}
                {isExpanded && (
                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {g.anomalies.map(a => {
                      const cat = anomCategory(a.type);
                      const isSelected = sel?.id === a.id;
                      return (
                        <div key={a.id}
                          onClick={() => { setSel(a); setActionMode(''); setActionType(''); setNotes(''); }}
                          className={cn('flex items-start gap-3 px-4 py-3 pl-10 cursor-pointer transition-colors',
                            isSelected ? 'bg-accent-50 border-l-2 border-l-accent-500' : 'hover:bg-slate-50')}>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-slate-800 leading-snug">{a.description}</div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className={cn('text-[10px] px-1.5 py-0.5 font-bold rounded', catColor[cat])}>{catLabel[cat].toUpperCase()}</span>
                              <span className="text-[11px] text-slate-400">{(a.type || '').replace(/_/g, ' ')}</span>
                              {a.suppressed && <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 font-bold rounded">⚡ SUPPRESSED</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge c={a.severity === 'high' ? 'err' : a.severity === 'medium' ? 'warn' : 'ok'}>{a.severity}</Badge>
                            <span className={cn('text-sm font-semibold tabular-nums w-20 text-right', Math.abs(a.amount_at_risk || 0) > 0 ? 'text-red-600' : 'text-slate-400')}>{$(Math.abs(a.amount_at_risk || 0))}</span>
                            <Badge c={a.status === 'open' ? 'warn' : a.status === 'resolved' ? 'ok' : 'muted'}>{a.status}</Badge>
                            {a.claimedBy && (
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                a.claimedBy === s.user?.id ? "bg-accent-100 text-accent-700 border border-accent-200" : "bg-slate-200 text-slate-500")}>
                                {a.claimedBy === s.user?.id ? '● You' : a.claimedByName || 'Claimed'}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Layer 4: Detail Panel ── */}
        {sel && (
          <div className="w-1/2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sticky top-24 self-start max-h-[calc(100vh-8rem)] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge c={sevColor(sel.severity) === 'err' ? 'err' : sevColor(sel.severity) === 'warn' ? 'warn' : 'ok'}>{sel.severity}</Badge>
                  <span className="text-xs text-slate-500 font-mono">{(sel.type || '').replace(/_/g, ' ')}</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 font-bold rounded', catColor[anomCategory(sel.type)])}>{catLabel[anomCategory(sel.type)].toUpperCase()}</span>
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

            {/* Sibling anomalies on same invoice */}
            {/* Claim Status Banner */}
            {sel.status === 'open' && sel.claimedBy && (
              <div className={cn("rounded-xl p-3 mb-4 flex items-center justify-between",
                isAnomMine(sel) ? "bg-accent-50 border border-accent-200" : "bg-slate-100 border border-slate-200")}>
                <div className="text-sm">
                  {isAnomMine(sel)
                    ? <span className="font-semibold text-accent-700">You are working on this</span>
                    : <span className="text-slate-600">Claimed by <strong>{sel.claimedByName}</strong></span>}
                  {sel.claimedAt && <span className="text-xs text-slate-400 ml-2">({dateTime(sel.claimedAt)})</span>}
                </div>
                {(isAnomMine(sel) || lvl >= 1) && (
                  <button onClick={() => releaseAnom(sel.id)} className="btn-o text-xs px-2 py-1">Release</button>
                )}
              </div>
            )}
            {(() => {
              const siblings = filtered.filter(a => (a.invoiceNumber || a.invoiceId) === (sel.invoiceNumber || sel.invoiceId) && a.id !== sel.id);
              if (siblings.length === 0) return null;
              return (
                <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Other anomalies on this invoice ({siblings.length})</div>
                  <div className="space-y-1.5">
                    {siblings.map(sib => (
                      <div key={sib.id} onClick={() => { setSel(sib); setActionMode(''); setActionType(''); setNotes(''); }}
                        className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-100 cursor-pointer hover:border-accent-200 transition-all">
                        <Badge c={sib.severity === 'high' ? 'err' : sib.severity === 'medium' ? 'warn' : 'ok'}>{sib.severity}</Badge>
                        <span className="text-xs text-slate-700 flex-1 truncate">{(sib.type || '').replace(/_/g, ' ')}</span>
                        <span className="text-xs font-semibold text-red-500">{$(Math.abs(sib.amount_at_risk || 0))}</span>
                        <Badge c={sib.status === 'open' ? 'warn' : 'ok'}>{sib.status}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

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

            {/* AI Explanation (Rec #1) */}
            {(() => {
              const [aiExplain, setAiExplain] = useState(null);
              const [aiLoading, setAiLoading] = useState(false);
              async function explainAnomaly() {
                setAiLoading(true);
                const r = await api(`/api/ai/explain-anomaly/${sel.id}`);
                setAiLoading(false);
                if (r && !r._err) setAiExplain(r);
              }
              return (
                <div className="mb-4">
                  {!aiExplain && (
                    <button onClick={explainAnomaly} disabled={aiLoading}
                      className="w-full btn bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs py-2.5 flex items-center justify-center gap-2 rounded-xl border border-indigo-200">
                      <Brain className="w-3.5 h-3.5" /> {aiLoading ? 'AI Analyzing...' : 'Explain in Plain English'}
                    </button>
                  )}
                  {aiExplain && (
                    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Brain className="w-4 h-4 text-indigo-600" />
                        <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">AI Explanation</span>
                      </div>
                      <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{aiExplain.explanation || aiExplain.plain_english || JSON.stringify(aiExplain)}</div>
                      {aiExplain.risk_assessment && <div className="mt-2 text-xs text-indigo-600 font-medium">Risk: {aiExplain.risk_assessment}</div>}
                      {aiExplain.recommended_action && <div className="mt-1 text-xs text-purple-600 font-medium">Action: {aiExplain.recommended_action}</div>}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Contract Clause */}
            {sel.contract_clause && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Contract Reference</div>
                <div className="text-sm text-slate-700 bg-blue-50 border border-blue-100 rounded-xl p-3">{sel.contract_clause}</div>
              </div>
            )}

            {/* Quick Navigation — View source documents */}
            {(() => {
              const allDocs = s.docs || [];
              const sourceDoc = allDocs.find(dd => dd.id === sel.invoiceId)
                || allDocs.find(dd => (dd.invoiceNumber || dd.poNumber || dd.documentNumber) === sel.invoiceNumber);
              const linkedContract = sel.contractId
                ? allDocs.find(dd => dd.id === sel.contractId)
                : (sourceDoc?.vendor ? allDocs.find(dd => dd.type === 'contract' && dd.vendor && sourceDoc.vendor && dd.vendor.toLowerCase().includes(sourceDoc.vendor.toLowerCase().split(' ')[0])) : null);
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

                {/* Not claimed — must claim first */}
                {!sel.claimedBy && (
                  <button onClick={() => claimAnom(sel.id)} className="btn-p text-sm px-4 py-2 w-full mb-2">
                    <Shield className="w-4 h-4" /> Claim & Work on This
                  </button>
                )}

                {/* Claimed by someone else — blocked */}
                {isAnomClaimed(sel) && lvl < 1 && (
                  <div className="text-xs text-slate-500 text-center bg-slate-50 rounded-lg p-3">
                    Claimed by <strong>{sel.claimedByName}</strong> — you cannot action this anomaly until it is released.
                  </div>
                )}

                {/* Claimed by me OR manager+ — show action buttons */}
                {canActionAnom(sel) && sel.claimedBy && (
                  <>
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

                {!actionMode && !isAnomClaimed(sel) && sel.claimedBy && (
                  <div className="text-center text-xs text-slate-400 py-4">Select an action above to proceed</div>
                )}
                  </>
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
  const policy = s.policy || {};
  const [viewMode, setViewMode] = useState('review');
  const [poData, setPoData] = useState(null);
  const [poLoading, setPoLoading] = useState(false);
  const [selMatch, setSelMatch] = useState(null);
  const [sortCol, setSortCol] = useState('status');
  const [sortAsc, setSortAsc] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Load PO consumption data
  useEffect(() => {
    if (viewMode === 'consumption' && !poData) {
      setPoLoading(true);
      api('/api/matches/po-consumption').then(r => { setPoData(r); setPoLoading(false); });
    }
  }, [viewMode]);

  // Tolerance config from policy
  const tolerance = {
    pct: policy.over_invoice_pct || policy.match_tolerance_pct || 5,
    abs: policy.match_tolerance_abs || 500,
    autoThreshold: policy.auto_match_threshold || 75,
  };

  // Enrich matches with review reasons + GRN info
  const enriched = matches.map(m => {
    const inv = allDocs.find(d => d.id === m.invoiceId);
    const po = allDocs.find(d => d.id === m.poId);
    const grn = allDocs.find(d => d.type === 'goods_receipt' && (d.poReference === m.poNumber || d.poId === m.poId));
    const isDup = matches.filter(x => x.invoiceNumber === m.invoiceNumber && x.poNumber === m.poNumber).length > 1;

    // Compute review reasons — prefer backend-provided reasons, supplement with client-side checks
    const reasons = [...(m.reviewReasons || [])];
    const diff = m.amountDifference || 0;
    const invAmt = inv?.amount || 0;
    const diffPct = m.variancePct || (invAmt > 0 ? (diff / invAmt * 100) : 0);
    if (diff > tolerance.abs && !reasons.some(r => r.includes('threshold'))) reasons.push('Variance exceeds $' + tolerance.abs + ' threshold');
    if (diffPct > tolerance.pct && !reasons.some(r => r.includes('tolerance'))) reasons.push('Variance ' + Math.round(diffPct) + '% exceeds ' + tolerance.pct + '% tolerance');
    if (m.overInvoiced && !reasons.some(r => r.includes('exceeds PO'))) reasons.push('Cumulative invoicing exceeds PO value');
    if (!m.signals?.includes('vendor_exact') && !m.signals?.includes('po_reference_exact') && !reasons.some(r => r.includes('Weak'))) reasons.push('Weak match signals \u2014 no exact PO ref or vendor');
    if ((m.matchScore || 0) < tolerance.autoThreshold && (m.matchScore || 0) >= 40 && !reasons.some(r => r.includes('score'))) reasons.push('Match score ' + m.matchScore + ' below auto-approve threshold (' + tolerance.autoThreshold + ')');
    if (isDup && !reasons.some(r => r.includes('Duplicate'))) reasons.push('Duplicate invoice number matched to same PO');
    if (m.grnStatus === 'no_grn' && !reasons.some(r => r.includes('goods receipt'))) reasons.push('No goods receipt found \u2014 2-way match only');

    return { ...m, _inv: inv, _po: po, _grn: grn, _isDup: isDup, _reasons: reasons, _diffPct: diffPct };
  });

  // Filtering
  let filtered = enriched;
  if (statusFilter === 'review') filtered = filtered.filter(m => m.status === 'review_needed' || m.status === 'pending_review');
  else if (statusFilter === 'matched') filtered = filtered.filter(m => m.status === 'auto_matched' || m.status === 'matched');
  else if (statusFilter === 'rejected') filtered = filtered.filter(m => m.status === 'rejected');

  // Sorting
  const sortFns = {
    status: (a, b) => { const ord = { review_needed: 0, pending_review: 0, auto_matched: 1, matched: 1, rejected: 2 }; return (ord[a.status] || 1) - (ord[b.status] || 1); },
    invoice: (a, b) => (a.invoiceNumber || '').localeCompare(b.invoiceNumber || ''),
    vendor: (a, b) => (a.vendor || '').localeCompare(b.vendor || ''),
    score: (a, b) => (b.matchScore || 0) - (a.matchScore || 0),
    variance: (a, b) => Math.abs(b.amountDifference || 0) - Math.abs(a.amountDifference || 0),
    po: (a, b) => (a.poNumber || '').localeCompare(b.poNumber || ''),
  };
  const sorted = [...filtered].sort((a, b) => {
    const fn = sortFns[sortCol] || sortFns.status;
    return sortAsc ? fn(a, b) : -fn(a, b);
  });

  // Actions with audit trail
  async function approveMatch(m, reason) {
    if (m.overInvoiced || m._isDup) {
      const r = prompt('This match has risk flags. Provide approval justification (required for audit):');
      if (!r?.trim()) return;
      reason = r.trim();
    }
    const r = await post('/api/matches/' + m.id + '/approve', { reason: reason || 'Reviewed and approved' });
    if (r?.success) { await load(); setSelMatch(null); toast('Match approved', 'success'); }
    else toast(r?.detail || 'Approve failed', 'danger');
  }
  async function rejectMatch(m) {
    const reason = prompt('Rejection reason (required for SOX compliance):');
    if (!reason?.trim()) { toast('Rejection reason is required', 'warning'); return; }
    const r = await post('/api/matches/' + m.id + '/reject', { reason: reason.trim() });
    if (r?.success) { await load(); setSelMatch(null); toast('Match rejected', 'warning'); }
    else toast(r?.detail || 'Reject failed', 'danger');
  }

  // Stats
  const twoWay = matches.filter(m => m.matchType !== 'three_way' && m.grnStatus !== 'received').length;
  const threeWay = matches.filter(m => m.matchType === 'three_way' || m.grnStatus === 'received').length;
  const needsReview = matches.filter(m => m.status === 'review_needed' || m.status === 'pending_review').length;
  const autoMatched = matches.filter(m => m.status === 'auto_matched' || m.status === 'matched').length;
  const rejected = matches.filter(m => m.status === 'rejected').length;
  const threeWayRate = matches.length > 0 ? Math.round(threeWay / matches.length * 100) : 0;
  const autoMatchRate = matches.length > 0 ? Math.round(autoMatched / matches.length * 100) : 0;
  const overInvoiced = enriched.filter(m => m.overInvoiced).length;

  function SortHdr({ col, label, right }) {
    const active = sortCol === col;
    return (
      <th onClick={() => { if (active) setSortAsc(!sortAsc); else { setSortCol(col); setSortAsc(true); } }}
        className={cn("px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none hover:bg-slate-100 transition-colors",
          right ? "text-right" : "text-left", active ? "text-accent-700 bg-slate-50" : "text-slate-500")}>
        {label} {active && (sortAsc ? "\u2193" : "\u2191")}
      </th>
    );
  }

  return (
    <div className="page-enter space-y-4">
      <PageHeader title="PO Matching" sub={"AP Three-Way Match Workbench"}>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button onClick={() => setViewMode('review')} className={cn("px-3 py-1.5 text-xs font-semibold transition-colors", viewMode === 'review' ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>Match Review</button>
          <button onClick={() => setViewMode('consumption')} className={cn("px-3 py-1.5 text-xs font-semibold transition-colors", viewMode === 'consumption' ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>PO Consumption</button>
          <button onClick={() => setViewMode('unmatched')} className={cn("px-3 py-1.5 text-xs font-semibold transition-colors", viewMode === 'unmatched' ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
            Unmatched {(() => { const unm = (s.docs || []).filter(d => d.type === 'invoice' && !matches.some(m => m.invoiceId === d.id)); return unm.length > 0 ? `(${unm.length})` : ''; })()}
          </button>
        </div>
      </PageHeader>

      {/* Metrics strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className={cn("rounded-xl px-4 py-3 border", threeWayRate >= 70 ? "bg-emerald-50 border-emerald-100" : threeWayRate >= 40 ? "bg-amber-50 border-amber-100" : "bg-red-50 border-red-100")}>
          <div className="text-2xl font-extrabold">{threeWayRate}%</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">3-Way Rate</div>
        </div>
        <div className="rounded-xl px-4 py-3 border bg-blue-50 border-blue-100">
          <div className="text-2xl font-extrabold text-blue-700">{autoMatchRate}%</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Auto-Match</div>
        </div>
        {needsReview > 0 && (
          <div className="rounded-xl px-4 py-3 border bg-amber-50 border-amber-100">
            <div className="text-2xl font-extrabold text-amber-700">{needsReview}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Needs Review</div>
          </div>
        )}
        {overInvoiced > 0 && (
          <div className="rounded-xl px-4 py-3 border bg-red-50 border-red-100">
            <div className="text-2xl font-extrabold text-red-700">{overInvoiced}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-red-500">Over-Invoiced</div>
          </div>
        )}
        <div className="rounded-xl px-4 py-3 border bg-slate-50 border-slate-100">
          <div className="text-2xl font-extrabold">{matches.length}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Matches</div>
        </div>
        <div className="rounded-xl px-4 py-3 border bg-slate-50 border-slate-100 col-span-1">
          <div className="text-[10px] text-slate-500 uppercase font-semibold mb-1">Tolerance</div>
          <div className="text-xs font-mono text-slate-700">{"\u00b1"}{tolerance.pct}% or ${tolerance.abs}</div>
          <div className="text-[10px] text-slate-400">Auto: {"\u2265"}{tolerance.autoThreshold} score</div>
        </div>
      </div>

      {/* ══════ MATCH REVIEW VIEW ══════ */}
      {viewMode === 'review' && (
        <div className="flex gap-4">
          <div className={cn("transition-all", selMatch ? "w-3/5" : "w-full")}>
            {/* Filters */}
            <div className="flex items-center gap-2 mb-3">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white">
                <option value="ALL">All Matches ({matches.length})</option>
                <option value="review">Needs Review ({needsReview})</option>
                <option value="matched">Auto-Matched ({autoMatched})</option>
                {rejected > 0 && <option value="rejected">Rejected ({rejected})</option>}
              </select>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <SortHdr col="invoice" label="Invoice" />
                      <SortHdr col="po" label="PO" />
                      <SortHdr col="vendor" label="Vendor" />
                      <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-center">Type</th>
                      <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-center">GRN</th>
                      <SortHdr col="variance" label={"\u0394 Amount"} right />
                      <SortHdr col="score" label="Score" />
                      <SortHdr col="status" label="Status" />
                      <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Reason</th>
                      <th className="px-3 py-2.5 w-20"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {sorted.map(m => (
                      <tr key={m.id} onClick={() => setSelMatch(m)} className={cn("transition-colors cursor-pointer",
                        selMatch?.id === m.id ? "bg-accent-50 ring-1 ring-inset ring-accent-200" : "hover:bg-slate-50",
                        m._isDup && "bg-red-50/30")}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-900">{m.invoiceNumber}</span>
                            {m._isDup && <span className="text-[9px] px-1 py-0.5 bg-red-100 text-red-600 font-bold rounded border border-red-200">DUP</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5"><span className="font-semibold text-accent-600">{m.poNumber}</span></td>
                        <td className="px-3 py-2.5 text-slate-600 max-w-[120px] truncate">{m.vendor}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                            m.matchType === 'three_way' || m.grnStatus === 'received' ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>
                            {m.matchType === 'three_way' || m.grnStatus === 'received' ? "3-Way" : "2-Way"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {m._grn ? (
                            <span className="text-[10px] font-semibold text-emerald-600">{"\u2713"} Received</span>
                          ) : (
                            <span className="text-[10px] text-slate-400">No GRN</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={cn("font-mono font-semibold text-xs",
                            Math.abs(m.amountDifference || 0) > tolerance.abs ? "text-red-600" :
                            Math.abs(m.amountDifference || 0) > 0 ? "text-amber-600" : "text-emerald-600")}>
                            {(m.amountDifference || 0) > 0 ? '+' : ''}{$f(m.amountDifference || 0)}
                          </span>
                          {m._diffPct > tolerance.pct && <div className="text-[9px] text-red-500 font-mono">{Math.round(m._diffPct)}%</div>}
                        </td>
                        <td className="px-3 py-2.5"><ConfidenceRing score={m.matchScore || 0} size={36} /></td>
                        <td className="px-3 py-2.5">
                          <Badge c={
                            m.status === 'auto_matched' || m.status === 'matched' ? 'ok' :
                            m.status === 'rejected' ? 'err' : 'warn'
                          }>{(m.status || '').replace(/_/g, ' ')}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          {m._reasons.length > 0 ? (
                            <span className="text-[10px] text-amber-600 leading-tight line-clamp-2">{m._reasons[0]}</span>
                          ) : (
                            <span className="text-[10px] text-slate-300">{"\u2014"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {(m.status === 'review_needed' || m.status === 'pending_review') && (
                            <div className="flex gap-1">
                              <button onClick={e => { e.stopPropagation(); approveMatch(m); }} className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded-lg transition-all" title="Approve match"><Check className="w-4 h-4" /></button>
                              <button onClick={e => { e.stopPropagation(); rejectMatch(m); }} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-all" title="Reject match"><X className="w-4 h-4" /></button>
                            </div>
                          )}
                          {m.status === 'rejected' && <span className="text-[10px] text-red-400">Rejected</span>}
                        </td>
                      </tr>
                    ))}
                    {sorted.length === 0 && (
                      <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-400">No matches found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Detail panel */}
          {selMatch && (
            <div className="w-2/5 bg-white rounded-2xl border border-slate-200 shadow-sm sticky top-20 self-start max-h-[calc(100vh-7rem)] overflow-y-auto">
              <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-start">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{selMatch.invoiceNumber} {"\u2192"} {selMatch.poNumber}</h3>
                  <div className="text-sm text-slate-500">{selMatch.vendor}</div>
                </div>
                <button onClick={() => setSelMatch(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                {/* Match score + type */}
                <div className="flex items-center gap-4">
                  <ConfidenceRing score={selMatch.matchScore || 0} size={56} />
                  <div>
                    <div className="text-sm font-bold">{selMatch.matchType === 'three_way' ? 'Three-Way Match' : 'Two-Way Match'}</div>
                    <Badge c={selMatch.status === 'auto_matched' ? 'ok' : selMatch.status === 'rejected' ? 'err' : 'warn'}>{(selMatch.status || '').replace(/_/g, ' ')}</Badge>
                  </div>
                </div>

                {/* Amounts */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] text-slate-500 uppercase">Invoice</div><div className="text-sm font-bold font-mono">{$(selMatch._inv?.amount, selMatch._inv?.currency)}</div></div>
                  <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] text-slate-500 uppercase">PO Value</div><div className="text-sm font-bold font-mono">{$(selMatch.poAmount || selMatch._po?.amount)}</div></div>
                  <div className={cn("rounded-lg p-2.5", Math.abs(selMatch.amountDifference || 0) > tolerance.abs ? "bg-red-50" : "bg-slate-50")}>
                    <div className="text-[10px] text-slate-500 uppercase">{"\u0394"} Variance</div>
                    <div className={cn("text-sm font-bold font-mono", Math.abs(selMatch.amountDifference || 0) > tolerance.abs ? "text-red-600" : "text-slate-700")}>{$f(selMatch.amountDifference || 0)}</div>
                  </div>
                </div>

                {/* PO consumption */}
                {(selMatch.poAlreadyInvoiced != null || selMatch.poRemaining != null) && (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-2">PO Consumption</div>
                    <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                      <div><span className="text-slate-500">Total Invoiced</span><div className="font-bold font-mono">{$(selMatch.poAlreadyInvoiced || 0)}</div></div>
                      <div><span className="text-slate-500">Remaining</span><div className={cn("font-bold font-mono", (selMatch.poRemaining || 0) < 0 && "text-red-600")}>{$(selMatch.poRemaining || 0)}</div></div>
                      <div><span className="text-slate-500">Invoices</span><div className="font-bold">{selMatch.poInvoiceCount || 0}</div></div>
                    </div>
                    {selMatch.overInvoiced && (
                      <div className="text-xs text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5 border border-red-100 font-medium">{"\u26a0"} PO over-invoiced {"\u2014"} cumulative amount exceeds PO value</div>
                    )}
                    {/* Consumption bar */}
                    {selMatch.poAmount > 0 && (() => {
                      const pct = Math.min(((selMatch.poAlreadyInvoiced || 0) / selMatch.poAmount) * 100, 120);
                      return (
                        <div className="mt-2">
                          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                            <span>0%</span><span>100%</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden relative">
                            <div className={cn("h-full rounded-full transition-all", pct > 100 ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: Math.min(pct, 100) + '%' }} />
                          </div>
                          <div className="text-[10px] text-slate-500 mt-1 text-center">{Math.round(pct)}% consumed</div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* GRN status */}
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Goods Receipt</div>
                  {selMatch._grn ? (
                    <div className="text-sm">
                      <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> <span className="font-semibold text-emerald-700">GRN: {selMatch._grn.documentNumber || selMatch._grn.grnNumber || selMatch._grn.id}</span></div>
                      <div className="text-xs text-slate-500 mt-1">Received: {date(selMatch._grn.receivedDate || selMatch._grn.issueDate)}</div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-amber-600"><AlertTriangle className="w-4 h-4" /> No goods receipt {"\u2014"} 2-way match only</div>
                  )}
                </div>

                {/* Match signals */}
                {(selMatch.signals || []).length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Match Signals</div>
                    <div className="flex flex-wrap gap-1">
                      {selMatch.signals.map((sig, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full border border-slate-200">{sig.replace(/_/g, ' ')}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Review reasons */}
                {selMatch._reasons.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-amber-600 uppercase mb-1">Review Required Because</div>
                    <div className="space-y-1">
                      {selMatch._reasons.map((r, i) => (
                        <div key={i} className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5 border border-amber-100">{"\u2192"} {r}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Approval info */}
                {selMatch.approvedBy && (
                  <div className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-100">
                    Approved by <strong>{selMatch.approvedBy}</strong> {selMatch.approvedAt && <span>on {dateTime(selMatch.approvedAt)}</span>}
                    {selMatch.approvalReason && <div className="text-emerald-500 mt-0.5">Reason: {selMatch.approvalReason}</div>}
                  </div>
                )}
                {selMatch.rejectedBy && (
                  <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
                    Rejected by <strong>{selMatch.rejectedBy}</strong> {selMatch.rejectedAt && <span>on {dateTime(selMatch.rejectedAt)}</span>}
                    {selMatch.rejectionReason && <div className="text-red-500 mt-0.5">Reason: {selMatch.rejectionReason}</div>}
                  </div>
                )}

                {/* AI Smart Match */}
                {(() => {
                  const [smartMatch, setSmartMatch] = useState(null);
                  const [smLoading, setSmLoading] = useState(false);
                  async function runSmartMatch() {
                    setSmLoading(true);
                    const r = await api(`/api/ai/smart-match/${selMatch.invoiceId || selMatch._inv?.id}`);
                    setSmLoading(false);
                    if (r && !r._err) setSmartMatch(r);
                    else toast(r?.detail || 'Smart match requires ANTHROPIC_API_KEY', 'warning');
                  }
                  return (
                    <div>
                      {!smartMatch && (
                        <button onClick={runSmartMatch} disabled={smLoading}
                          className="w-full btn bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs py-2 flex items-center justify-center gap-2 rounded-xl border border-indigo-200">
                          <Brain className="w-3.5 h-3.5" /> {smLoading ? 'AI Analyzing...' : 'AI Smart Match Analysis'}
                        </button>
                      )}
                      {smartMatch && (
                        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Brain className="w-4 h-4 text-indigo-600" />
                              <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">AI Match Analysis</span>
                            </div>
                            <button onClick={() => setSmartMatch(null)} className="text-xs text-slate-400 hover:text-slate-600">dismiss</button>
                          </div>
                          <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{smartMatch.analysis || smartMatch.narrative || smartMatch.explanation || JSON.stringify(smartMatch, null, 2)}</div>
                          {smartMatch.confidence && <div className="mt-2 text-xs text-indigo-600 font-medium">AI Confidence: {smartMatch.confidence}</div>}
                          {smartMatch.recommended_action && <div className="mt-1 text-xs text-purple-600 font-medium">Recommendation: {smartMatch.recommended_action}</div>}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Actions */}
                {(selMatch.status === 'review_needed' || selMatch.status === 'pending_review') && (
                  <div className="pt-3 border-t border-slate-200">
                    <div className="flex gap-2">
                      <button onClick={() => approveMatch(selMatch)} className="btn-p text-sm px-4 py-2 flex-1"><Check className="w-4 h-4" /> Approve Match</button>
                      <button onClick={() => rejectMatch(selMatch)} className="text-sm px-4 py-2 flex-1 rounded-xl font-semibold flex items-center justify-center gap-2 border border-red-200 text-red-600 hover:bg-red-50 transition-all"><X className="w-4 h-4" /> Reject</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════ PO CONSUMPTION VIEW ══════ */}
      {viewMode === 'consumption' && (
        <div>
          {poLoading && <div className="text-center py-12 text-slate-400">Loading PO consumption data...</div>}
          {poData && (
            <>
              {/* PO summary */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="rounded-xl px-4 py-3 border bg-slate-50 border-slate-100">
                  <div className="text-2xl font-extrabold">{poData.summary?.totalPOs || 0}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Active POs</div>
                </div>
                <div className="rounded-xl px-4 py-3 border bg-slate-50 border-slate-100">
                  <div className="text-lg font-extrabold">{short(poData.summary?.totalPOValue || 0, 'USD')}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total PO Value</div>
                </div>
                <div className="rounded-xl px-4 py-3 border bg-slate-50 border-slate-100">
                  <div className="text-lg font-extrabold">{short(poData.summary?.totalInvoiced || 0, 'USD')}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Invoiced</div>
                </div>
                {(poData.summary?.overInvoiced || 0) > 0 && (
                  <div className="rounded-xl px-4 py-3 border bg-red-50 border-red-100">
                    <div className="text-2xl font-extrabold text-red-700">{poData.summary.overInvoiced}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-red-500">Over-Invoiced POs</div>
                  </div>
                )}
              </div>

              {/* PO accordion */}
              <div className="space-y-3">
                {(poData.poConsumption || []).map(po => (
                  <POCard key={po.poId} po={po} tolerance={tolerance} />
                ))}
                {(poData.poConsumption || []).length === 0 && (
                  <div className="text-center py-12 text-slate-400">No PO consumption data available</div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════ UNMATCHED INVOICES VIEW ══════ */}
      {viewMode === 'unmatched' && (() => {
        const unmatchedInvs = (s.docs || []).filter(d => d.type === 'invoice' && !matches.some(m => m.invoiceId === d.id));
        return (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl px-4 py-3 border bg-amber-50 border-amber-100">
                <div className="text-2xl font-extrabold text-amber-700">{unmatchedInvs.length}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">Unmatched Invoices</div>
              </div>
              <div className="rounded-xl px-4 py-3 border bg-slate-50 border-slate-100">
                <div className="text-lg font-extrabold">{$(unmatchedInvs.reduce((s, i) => s + (i.amount || 0), 0))}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Value</div>
              </div>
              <div className="rounded-xl px-4 py-3 border bg-slate-50 border-slate-100">
                <div className="text-lg font-extrabold">{unmatchedInvs.filter(i => !i.poReference).length}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Missing PO Ref</div>
              </div>
            </div>
            {unmatchedInvs.length > 0 ? (
              <div className="space-y-2">
                {unmatchedInvs.map(inv => {
                  const SmartMatchBtn = () => {
                    const [result, setResult] = useState(null);
                    const [loading, setLoading] = useState(false);
                    async function run() {
                      setLoading(true);
                      const r = await api(`/api/ai/smart-match/${inv.id}`);
                      setLoading(false);
                      if (r && !r._err) setResult(r);
                      else toast(r?.detail || 'Smart match requires ANTHROPIC_API_KEY', 'warning');
                    }
                    return (
                      <div>
                        <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-all">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                              <AlertTriangle className="w-4 h-4 text-amber-600" />
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-slate-800">{inv.invoiceNumber || inv.id}</div>
                              <div className="text-xs text-slate-500">{inv.vendor} · {$(inv.amount, inv.currency)}{inv.poReference ? ` · PO: ${inv.poReference}` : ' · No PO reference'}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">{date(inv.issueDate)}</span>
                            <button onClick={run} disabled={loading}
                              className="btn bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs flex items-center gap-1.5 border border-indigo-200">
                              <Brain className="w-3.5 h-3.5" /> {loading ? 'Analyzing...' : 'AI Smart Match'}
                            </button>
                          </div>
                        </div>
                        {result && (
                          <div className="ml-11 mt-1 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl p-3 border border-indigo-200">
                            <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{result.analysis || result.narrative || result.explanation || JSON.stringify(result, null, 2)}</div>
                            {result.suggested_po && <div className="mt-1 text-xs font-medium text-indigo-700">Suggested PO: {result.suggested_po}</div>}
                            {result.recommended_action && <div className="mt-1 text-xs font-medium text-purple-600">Action: {result.recommended_action}</div>}
                          </div>
                        )}
                      </div>
                    );
                  };
                  return <SmartMatchBtn key={inv.id} />;
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 text-sm">All invoices are matched — no unmatched invoices</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function POCard({ po, tolerance }) {
  const [expanded, setExpanded] = useState(false);
  const pct = po.poAmount > 0 ? Math.min(po.consumptionPct, 120) : 0;
  const barColor = pct > 100 ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className={cn("card overflow-hidden", po.hasOverInvoice && "ring-1 ring-red-200")}>
      <div onClick={() => setExpanded(!expanded)} className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors">
        <ChevronRight className={cn("w-4 h-4 text-slate-400 transition-transform", expanded && "rotate-90")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">{po.poNumber}</span>
            <span className="text-sm text-slate-500">{po.vendor}</span>
            {po.hasOverInvoice && <span className="text-[9px] px-1.5 py-0.5 bg-red-100 text-red-600 font-bold rounded border border-red-200">OVER-INVOICED</span>}
          </div>
          <div className="flex items-center gap-4 mt-1.5">
            <div className="flex-1 max-w-xs">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: Math.min(pct, 100) + '%' }} />
              </div>
            </div>
            <span className={cn("text-xs font-bold font-mono", pct > 100 ? "text-red-600" : "text-slate-600")}>{Math.round(pct)}%</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-slate-500">PO Value</div>
          <div className="font-bold font-mono text-sm">{$(po.poAmount, po.currency)}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-slate-500">Invoiced</div>
          <div className={cn("font-bold font-mono text-sm", po.hasOverInvoice && "text-red-600")}>{$(po.totalInvoiced, po.currency)}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-slate-500">Remaining</div>
          <div className={cn("font-bold font-mono text-sm", po.remaining < 0 ? "text-red-600" : "text-emerald-600")}>{$(po.remaining, po.currency)}</div>
        </div>
        <Badge c={po.matchCount > 0 ? 'info' : 'muted'}>{po.matchCount} inv</Badge>
      </div>

      {expanded && po.matches.length > 0 && (
        <div className="border-t border-slate-100">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50">
              <th className="px-5 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">Invoice</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">Amount</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">{"\u0394"}</th>
              <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500 uppercase">Score</th>
              <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500 uppercase">Type</th>
              <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500 uppercase">GRN</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">Status</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">Date</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {po.matches.map(m => (
                <tr key={m.matchId} className="hover:bg-slate-50">
                  <td className="px-5 py-2 font-semibold text-slate-900">{m.invoiceNumber}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold">{$(m.invoiceAmount)}</td>
                  <td className="px-3 py-2 text-right font-mono"><span className={cn(Math.abs(m.amountDifference || 0) > tolerance.abs ? "text-red-600 font-bold" : "text-slate-500")}>{$f(m.amountDifference || 0)}</span></td>
                  <td className="px-3 py-2 text-center"><ConfidenceRing score={m.matchScore || 0} size={28} /></td>
                  <td className="px-3 py-2 text-center"><span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full", m.matchType === 'three_way' ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>{m.matchType === 'three_way' ? '3W' : '2W'}</span></td>
                  <td className="px-3 py-2 text-center">{m.grnStatus === 'received' ? <span className="text-emerald-500">{"\u2713"}</span> : <span className="text-slate-300">{"\u2014"}</span>}</td>
                  <td className="px-3 py-2"><Badge c={m.status === 'auto_matched' ? 'ok' : m.status === 'rejected' ? 'err' : 'warn'}>{(m.status || '').replace(/_/g, ' ')}</Badge></td>
                  <td className="px-3 py-2 text-slate-500">{date(m.invoiceDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Cumulative bar at bottom */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center gap-3 text-xs">
            <span className="text-slate-500">Cumulative:</span>
            <span className="font-bold font-mono">{$(po.totalInvoiced, po.currency)}</span>
            <span className="text-slate-400">of</span>
            <span className="font-bold font-mono">{$(po.poAmount, po.currency)}</span>
            <span className={cn("font-bold", po.hasOverInvoice ? "text-red-600" : "text-emerald-600")}>({Math.round(po.consumptionPct)}%)</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TRIAGE
   ═══════════════════════════════════════════════════ */
function Triage() {
  const { s, toast, load } = useStore();
  const tri = s.triageData || {};
  const role = s.user?.role || 'analyst';
  const lvl = RL[role] || 0;
  const myId = s.user?.id;
  const allAnoms = s.anomalies || [];

  // ── View mode: worklist (analyst default) vs kanban (manager overview) ──
  const [viewMode, setViewMode] = useState('worklist');
  const [sel, setSel] = useState(null);
  const [sortCol, setSortCol] = useState('priority');
  const [sortAsc, setSortAsc] = useState(true);
  const [laneFilter, setLaneFilter] = useState('ALL');
  const [vendorFilter, setVendorFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [checked, setChecked] = useState(new Set());
  const [detailTab, setDetailTab] = useState('summary');
  const tableRef = useRef(null);
  const [focusIdx, setFocusIdx] = useState(-1);

  // ── Lane config ──
  const allLanes = ['BLOCK','CFO_REVIEW','VP_REVIEW','MANAGER_REVIEW','REVIEW','AUTO_APPROVE'];
  const lanes = lvl >= 1 ? allLanes : ['BLOCK','REVIEW','AUTO_APPROVE'];
  const laneIcons = { AUTO_APPROVE: CheckCircle2, BLOCK: XCircle, REVIEW: Eye, MANAGER_REVIEW: Eye, VP_REVIEW: Eye, CFO_REVIEW: Eye };
  const bgMap = { AUTO_APPROVE:'bg-emerald-50 border-b border-emerald-100', BLOCK:'bg-red-50 border-b border-red-100', REVIEW:'bg-blue-50 border-b border-blue-100', MANAGER_REVIEW:'bg-amber-50 border-b border-amber-100', VP_REVIEW:'bg-amber-50 border-b border-amber-100', CFO_REVIEW:'bg-amber-50 border-b border-amber-100' };
  const icMap = { AUTO_APPROVE:'text-emerald-600', BLOCK:'text-red-600', REVIEW:'text-blue-600', MANAGER_REVIEW:'text-amber-600', VP_REVIEW:'text-amber-600', CFO_REVIEW:'text-amber-600' };

  useEffect(() => { if (s.tab === 'triage') { setSel(null); setChecked(new Set()); } }, [s.tabKey]);

  // ── Flatten all invoices from all lanes with lane tag ──
  const allInvoices = allLanes.flatMap(lane =>
    (tri[lane] || []).map(inv => ({ ...inv, _lane: lane }))
  );

  // ── Anomaly lookup per invoice (precompute) ──
  const anomsByInv = {};
  for (const a of allAnoms) {
    const key = a.invoiceId || a.invoiceNumber;
    if (!anomsByInv[key]) anomsByInv[key] = [];
    anomsByInv[key].push(a);
  }
  const getAnoms = (inv) => [...(anomsByInv[inv.id] || []), ...(anomsByInv[inv.invoiceNumber] || [])].filter((a, i, arr) => arr.findIndex(b => b.id === a.id) === i);

  // ── Priority scoring (P1=critical, P2=high, P3=medium, P4=low) ──
  const BLOCKING_TYPES = new Set(['DUPLICATE_INVOICE','UNRECEIPTED_INVOICE','MISSING_PO','PRICE_VARIANCE','TERMS_VIOLATION','AMOUNT_SPIKE']);
  const CONTRACT_TYPES = new Set(['VOLUME_COMMITMENT_GAP','CONTRACT_EXPIRY_WARNING','CONTRACT_PRICE_DRIFT','CONTRACT_OVER_UTILIZATION']);
  const INFO_TYPES = new Set(['EARLY_PAYMENT_DISCOUNT']);

  function computePriority(inv) {
    const anoms = getAnoms(inv);
    const openBlocking = anoms.filter(a => a.status === 'open' && BLOCKING_TYPES.has(a.type));
    const highSev = anoms.filter(a => a.severity === 'high' && a.status === 'open');
    const amt = inv.amount || 0;

    // Age in hours
    const uploaded = inv.uploadedAt || inv.createdAt || inv.triageAt;
    const ageHours = uploaded ? (Date.now() - new Date(uploaded).getTime()) / 3600000 : 0;

    // SLA: default 48h for blocked, 72h for review
    const slaHours = inv._lane === 'BLOCK' ? 48 : 72;
    const slaRemaining = slaHours - ageHours;
    const slaPct = Math.max(0, slaRemaining / slaHours);

    // Score components (higher = more urgent)
    let score = 0;
    if (inv._isDuplicate) score += 50;
    score += openBlocking.length * 15;
    score += highSev.length * 10;
    if (amt > 100000) score += 20;
    else if (amt > 50000) score += 15;
    else if (amt > 10000) score += 10;
    else if (amt > 5000) score += 5;
    if (slaRemaining < 0) score += 30; // SLA breached
    else if (slaRemaining < 8) score += 20; // SLA warning
    else if (slaRemaining < 24) score += 10;
    if (inv._lane === 'BLOCK') score += 10;
    if (inv.vendorRiskScore > 70) score += 10;

    const level = score >= 50 ? 1 : score >= 30 ? 2 : score >= 15 ? 3 : 4;

    return { score, level, ageHours, slaHours, slaRemaining, slaPct, openBlocking: openBlocking.length, totalAnoms: anoms.filter(a => a.status === 'open').length };
  }

  // Attach priority + enrichments
  const enriched = allInvoices.map(inv => {
    const pri = computePriority(inv);
    return { ...inv, _pri: pri };
  });

  // ── Filtering ──
  let filtered = enriched;
  if (laneFilter !== 'ALL') filtered = filtered.filter(i => i._lane === laneFilter);
  if (vendorFilter) filtered = filtered.filter(i => (i.vendor || '').toLowerCase().includes(vendorFilter.toLowerCase()));
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    filtered = filtered.filter(i =>
      (i.invoiceNumber || '').toLowerCase().includes(q) ||
      (i.vendor || '').toLowerCase().includes(q) ||
      (i.id || '').toLowerCase().includes(q)
    );
  }

  // ── Sorting ──
  const sortFns = {
    priority: (a, b) => b._pri.score - a._pri.score,
    invoice: (a, b) => (a.invoiceNumber || '').localeCompare(b.invoiceNumber || ''),
    vendor: (a, b) => (a.vendor || '').localeCompare(b.vendor || ''),
    amount: (a, b) => (b.amount || 0) - (a.amount || 0),
    age: (a, b) => (b._pri.ageHours) - (a._pri.ageHours),
    sla: (a, b) => (a._pri.slaRemaining) - (b._pri.slaRemaining),
    lane: (a, b) => allLanes.indexOf(a._lane) - allLanes.indexOf(b._lane),
    anomalies: (a, b) => (b._pri.totalAnoms) - (a._pri.totalAnoms),
  };
  const sorted = [...filtered].sort((a, b) => {
    const fn = sortFns[sortCol] || sortFns.priority;
    return sortAsc ? fn(a, b) : -fn(a, b);
  });

  // ── Selection helpers ──
  const selAnoms = sel ? getAnoms(sel) : [];
  const selLane = sel ? sel._lane : null;
  const blockingAnoms = selAnoms.filter(a => a.status === 'open' && (BLOCKING_TYPES.has(a.type) || a.severity === 'high'));
  const contractAnoms = selAnoms.filter(a => CONTRACT_TYPES.has(a.type));
  const infoAnoms = selAnoms.filter(a => INFO_TYPES.has(a.type));
  const otherAnoms = selAnoms.filter(a => a.status === 'open' && !BLOCKING_TYPES.has(a.type) && !CONTRACT_TYPES.has(a.type) && !INFO_TYPES.has(a.type) && a.severity !== 'high');
  const sevOrd = { high: 0, medium: 1, low: 2 };
  const sortBySev = (arr) => [...arr].sort((a, b) => (sevOrd[a.severity] || 2) - (sevOrd[b.severity] || 2));
  const hasDuplicate = selAnoms.some(a => a.type === 'DUPLICATE_INVOICE' && a.status === 'open');
  const hasUnreceipted = selAnoms.some(a => a.type === 'UNRECEIPTED_INVOICE' && a.status === 'open');
  const hasMissingPO = selAnoms.some(a => a.type === 'MISSING_PO' && a.status === 'open');
  const isBlocked = selLane === 'BLOCK';

  // ── Claim helpers ──
  const isMine = (inv) => inv.claimedBy === myId;
  const isClaimed = (inv) => inv.claimedBy && inv.claimedBy !== myId;
  const canAction = (inv) => !inv.claimedBy || inv.claimedBy === myId || lvl >= 1;

  // ── Actions ──
  async function claimInvoice(inv) {
    const r = await post("/api/invoices/" + inv.id + "/claim", {});
    if (r?.success) { toast("Invoice claimed", "success"); await load(); }
    else toast(r?.detail || "Claim failed", "danger");
  }
  async function releaseInvoice(inv) {
    const r = await post("/api/invoices/" + inv.id + "/release", {});
    if (r?.success) { toast("Claim released", "success"); await load(); setSel(null); }
    else toast(r?.detail || "Release failed", "danger");
  }
  async function overrideApprove(inv, isDup) {
    const msg = isDup
      ? "DUPLICATE WARNING: Approving will result in a second payment of " + $(inv.amount, inv.currency) + " to " + inv.vendor + ". Type CONFIRM DUPLICATE OVERRIDE to proceed:"
      : "Override reason \u2014 why should this be approved despite being blocked?";
    const n = prompt(msg);
    if (isDup && n !== "CONFIRM DUPLICATE OVERRIDE") { if (n !== null) toast("Override cancelled \u2014 exact text required", "warning"); return; }
    if (!isDup && !n?.trim()) return;
    const reason = isDup ? "DUPLICATE OVERRIDE CONFIRMED: " + n : n.trim();
    const form = new FormData();
    form.append("lane", "AUTO_APPROVE");
    form.append("reason", reason);
    const r = await postForm("/api/invoices/" + inv.id + "/override-triage", form);
    if (r?.success) { await load(); setSel(null); toast("Invoice approved (override)", "success"); }
    else toast(r?.detail || "Override failed", "danger");
  }
  async function escalateCase(inv) {
    const r = await post("/api/cases", { title: "Triage review: " + (inv.invoiceNumber || inv.id), description: "Invoice " + inv.invoiceNumber + " from " + inv.vendor + " (" + $(inv.amount, inv.currency) + ") routed to " + (inv._lane || "BLOCK") + ". Requires investigation.", type: "triage_escalation", priority: "high", invoiceId: inv.id, vendor: inv.vendor, amountAtRisk: inv.amount, currency: inv.currency });
    if (r?.success) { await load(); toast("Case " + (r.case?.id || "") + " created", "success"); }
    else toast(r?.detail || "Case creation failed", "danger");
  }
  async function voidDuplicate(inv) {
    if (!confirm("Void duplicate invoice " + inv.invoiceNumber + "? This will mark it as disputed and remove it from the payment pipeline.")) return;
    const r = await post("/api/invoices/" + inv.id + "/mark-disputed", { reason: "Duplicate invoice voided by analyst" });
    if (r?.success) {
      await load(); setSel(null);
      toast("Duplicate voided \u2014 " + (r.anomaliesResolved || 0) + " anomalies resolved", "success");
    } else toast(r?.detail || "Void failed", "danger");
  }
  async function parkInvoice(inv) {
    const d = prompt("Follow-up date (YYYY-MM-DD) and reason:\nExample: 2025-04-01 Awaiting GRN from warehouse");
    if (!d?.trim()) return;
    const form = new FormData();
    form.append("lane", "BLOCK");
    form.append("reason", "PARKED: " + d.trim());
    const r = await postForm("/api/invoices/" + inv.id + "/override-triage", form);
    if (r?.success) { await load(); setSel(null); toast("Invoice parked", "success"); }
    else toast(r?.detail || "Park failed", "danger");
  }
  async function sendToVendor(inv) {
    const reason = prompt("Query to send to vendor " + inv.vendor + ":");
    if (!reason?.trim()) return;
    const r = await post("/api/cases", { title: "Vendor Query: " + (inv.invoiceNumber || inv.id), description: "Vendor query for " + inv.invoiceNumber + ": " + reason.trim(), type: "vendor_query", priority: "medium", invoiceId: inv.id, vendor: inv.vendor, amountAtRisk: inv.amount, currency: inv.currency });
    if (r?.success) {
      // Also park the invoice pending vendor response
      const form = new FormData();
      form.append("lane", "BLOCK");
      form.append("reason", "PENDING VENDOR: Query sent \u2014 " + reason.trim().substring(0, 80));
      await postForm("/api/invoices/" + inv.id + "/override-triage", form);
      await load(); setSel(null);
      toast("Vendor query case created + invoice parked", "success");
    } else toast(r?.detail || "Failed", "danger");
  }

  // ── Batch actions ──
  const toggleCheck = (id) => setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => { if (checked.size === sorted.length) setChecked(new Set()); else setChecked(new Set(sorted.map(i => i.id))); };
  const checkedInvs = sorted.filter(i => checked.has(i.id));

  async function batchPark() {
    const reason = prompt("Park " + checkedInvs.length + " invoices \u2014 reason:");
    if (!reason?.trim()) return;
    let ok = 0;
    for (const inv of checkedInvs) {
      const form = new FormData();
      form.append("lane", "BLOCK");
      form.append("reason", "PARKED (batch): " + reason.trim());
      const r = await postForm("/api/invoices/" + inv.id + "/override-triage", form);
      if (r?.success) ok++;
    }
    await load(); setChecked(new Set());
    toast(ok + "/" + checkedInvs.length + " invoices parked", "success");
  }
  async function batchEscalate() {
    if (!confirm("Create cases for " + checkedInvs.length + " invoices?")) return;
    let ok = 0;
    for (const inv of checkedInvs) {
      const r = await post("/api/cases", { title: "Batch triage: " + (inv.invoiceNumber || inv.id), description: "Batch escalation from triage worklist.", type: "triage_escalation", priority: "high", invoiceId: inv.id, vendor: inv.vendor, amountAtRisk: inv.amount, currency: inv.currency });
      if (r?.success) ok++;
    }
    await load(); setChecked(new Set());
    toast(ok + " cases created", "success");
  }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (viewMode !== 'worklist') return;
      const len = sorted.length;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(prev => { const next = Math.min(prev + 1, len - 1); if (sorted[next]) setSel(sorted[next]); return next; }); }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(prev => { const next = Math.max(prev - 1, 0); if (sorted[next]) setSel(sorted[next]); return next; }); }
      if (e.key === 'Escape') { setSel(null); setFocusIdx(-1); }
      if (sel && e.key === 'a' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); overrideApprove(sel, hasDuplicate); }
      if (sel && e.key === 'e') { e.preventDefault(); escalateCase(sel); }
      if (sel && e.key === 'c' && !sel.claimedBy) { e.preventDefault(); claimInvoice(sel); }
      if (sel && e.key === 'p') { e.preventDefault(); parkInvoice(sel); }
      if (e.key === 'x' && focusIdx >= 0 && sorted[focusIdx]) { e.preventDefault(); toggleCheck(sorted[focusIdx].id); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Formatting helpers ──
  function ageFmt(hours) {
    if (hours < 1) return Math.round(hours * 60) + "m";
    if (hours < 24) return Math.round(hours) + "h";
    return Math.round(hours / 24) + "d " + Math.round(hours % 24) + "h";
  }
  function slaFmt(remaining) {
    if (remaining <= 0) return "OVERDUE";
    if (remaining < 1) return Math.round(remaining * 60) + "m left";
    if (remaining < 24) return Math.round(remaining) + "h left";
    return Math.round(remaining / 24) + "d left";
  }
  const priColors = { 1: 'bg-red-100 text-red-700 border-red-200', 2: 'bg-amber-100 text-amber-700 border-amber-200', 3: 'bg-blue-100 text-blue-700 border-blue-200', 4: 'bg-slate-100 text-slate-600 border-slate-200' };
  const priLabels = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

  // ── Sort header helper ──
  function SortHeader({ col, label, right }) {
    const active = sortCol === col;
    return (
      <th onClick={() => { if (active) setSortAsc(!sortAsc); else { setSortCol(col); setSortAsc(true); } }}
        className={cn("px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none hover:bg-slate-100 transition-colors",
          right ? "text-right" : "text-left", active ? "text-accent-700 bg-slate-50" : "text-slate-500")}>
        {label} {active && (sortAsc ? "\u2193" : "\u2191")}
      </th>
    );
  }

  // ── Anomaly card for detail ──
  function AnomalyCard({ a, dimmed }) {
    return (
      <div className={cn("rounded-xl p-3 border", dimmed ? "bg-slate-50/50 border-slate-100 opacity-60" : "bg-slate-50 border-slate-200")}>
        <div className="flex items-center gap-2 mb-1">
          <Badge c={sevColor(a.severity) === 'err' ? 'err' : sevColor(a.severity) === 'warn' ? 'warn' : 'ok'}>{a.severity}</Badge>
          <span className="text-xs text-slate-500 font-mono">{(a.type || '').replace(/_/g, ' ')}</span>
          {a.status !== 'open' && <Badge c="muted">{a.status}</Badge>}
          {a.amount_at_risk > 0 && <span className="text-xs font-bold text-red-600 ml-auto">{$(a.amount_at_risk)}</span>}
        </div>
        <div className="text-sm text-slate-700">{a.description}</div>
        {a.recommendation && <div className="text-xs text-amber-700 mt-1">{"\u2192"} {a.recommendation}</div>}
      </div>
    );
  }

  // ── Stats bar ──
  const total = allInvoices.length;
  const approved = (tri.AUTO_APPROVE || []).length;
  const blocked = (tri.BLOCK || []).length;
  const reviewCount = total - approved - blocked;
  const autoRate = total > 0 ? Math.round(approved / total * 100) : 0;
  const blockedAmt = (tri.BLOCK || []).reduce((s, i) => s + (i.amount || 0), 0);
  const p1Count = enriched.filter(i => i._pri.level === 1).length;
  const overdueCount = enriched.filter(i => i._pri.slaRemaining < 0).length;
  const uniqueVendors = [...new Set(allInvoices.map(i => i.vendor).filter(Boolean))];

  return (
    <div className="page-enter space-y-4">
      <PageHeader title="Triage" sub="AP Invoice Processing Workbench">
        <div className="flex items-center gap-2">
          {lvl >= 1 && (
            <button onClick={async () => { const r = await post('/api/triage/retriage-all', {}); if (r?.success) { toast(r.retriaged + " invoices retriaged", "success"); await load(); setSel(null); } else toast("Retriage failed", "danger"); }} className="btn-o text-xs px-3 py-1.5"><RefreshCw className="w-3.5 h-3.5" /> Retriage All</button>
          )}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button onClick={() => setViewMode('worklist')} className={cn("px-3 py-1.5 text-xs font-semibold transition-colors", viewMode === 'worklist' ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>Worklist</button>
            <button onClick={() => setViewMode('kanban')} className={cn("px-3 py-1.5 text-xs font-semibold transition-colors", viewMode === 'kanban' ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>Kanban</button>
          </div>
        </div>
      </PageHeader>

      {/* ── Metrics strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className={cn("rounded-xl px-4 py-3 border", autoRate >= 60 ? "bg-emerald-50 border-emerald-100" : autoRate >= 30 ? "bg-amber-50 border-amber-100" : "bg-red-50 border-red-100")}>
          <div className="text-2xl font-extrabold">{autoRate}%</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Auto-Approve</div>
        </div>
        <div className="rounded-xl px-4 py-3 border bg-red-50 border-red-100">
          <div className="text-2xl font-extrabold text-red-700">{blocked}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Blocked ({short(blockedAmt, 'USD')})</div>
        </div>
        <div className="rounded-xl px-4 py-3 border bg-blue-50 border-blue-100">
          <div className="text-2xl font-extrabold text-blue-700">{reviewCount}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">In Review</div>
        </div>
        {p1Count > 0 && (
          <div className="rounded-xl px-4 py-3 border bg-red-50 border-red-100 animate-pulse">
            <div className="text-2xl font-extrabold text-red-700">{p1Count}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-red-500">P1 Critical</div>
          </div>
        )}
        {overdueCount > 0 && (
          <div className="rounded-xl px-4 py-3 border bg-red-50 border-red-100">
            <div className="text-2xl font-extrabold text-red-700">{overdueCount}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-red-500">SLA Overdue</div>
          </div>
        )}
      </div>

      {/* ══════════════ WORKLIST VIEW ══════════════ */}
      {viewMode === 'worklist' && (
        <div className="flex gap-4">
          <div className={cn("transition-all", sel ? "w-1/2" : "w-full")}>

            {/* ── Filters & Search ── */}
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search invoices... (or press j/k to navigate)" className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-accent-300 focus:border-accent-400 outline-none" />
              </div>
              <select value={laneFilter} onChange={e => setLaneFilter(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white">
                <option value="ALL">All Lanes</option>
                {lanes.map(l => <option key={l} value={l}>{laneLabel(l)} ({(tri[l] || []).length})</option>)}
              </select>
              {uniqueVendors.length > 1 && (
                <select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white max-w-[160px]">
                  <option value="">All Vendors</option>
                  {uniqueVendors.sort().map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
            </div>

            {/* ── Batch action bar ── */}
            {checked.size > 0 && (
              <div className="flex items-center gap-2 mb-3 px-4 py-2.5 bg-accent-50 border border-accent-200 rounded-xl">
                <span className="text-sm font-semibold text-accent-700">{checked.size} selected</span>
                <div className="flex-1" />
                <button onClick={batchPark} className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 font-medium">Park All</button>
                <button onClick={batchEscalate} className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 font-medium">Escalate All</button>
                <button onClick={() => setChecked(new Set())} className="text-xs px-2 py-1.5 text-slate-500 hover:text-slate-700"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {/* ── Worklist table ── */}
            <div ref={tableRef} className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-3 py-2.5 w-8"><input type="checkbox" checked={checked.size === sorted.length && sorted.length > 0} onChange={toggleAll} className="rounded" /></th>
                      <SortHeader col="priority" label="Pri" />
                      <SortHeader col="invoice" label="Invoice" />
                      <SortHeader col="vendor" label="Vendor" />
                      <SortHeader col="amount" label="Amount" right />
                      <SortHeader col="lane" label="Lane" />
                      <SortHeader col="anomalies" label="Issues" />
                      <SortHeader col="age" label="Age" />
                      <SortHeader col="sla" label="SLA" />
                      <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {sorted.map((inv, idx) => {
                      const pri = inv._pri;
                      return (
                        <tr key={inv.id} onClick={() => { setSel(inv); setFocusIdx(idx); setDetailTab('summary'); }}
                          className={cn("transition-colors cursor-pointer",
                            sel?.id === inv.id ? "bg-accent-50 ring-1 ring-inset ring-accent-200" : focusIdx === idx ? "bg-slate-50" : "hover:bg-slate-50",
                            isClaimed(inv) && "opacity-50")}>
                          <td className="px-3 py-2" onClick={e => { e.stopPropagation(); toggleCheck(inv.id); }}>
                            <input type="checkbox" checked={checked.has(inv.id)} readOnly className="rounded" />
                          </td>
                          <td className="px-3 py-2">
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", priColors[pri.level])}>{priLabels[pri.level]}</span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900">{inv.invoiceNumber || inv.id}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate">{inv.vendor}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold">{$(inv.amount, inv.currency)}</td>
                          <td className="px-3 py-2">
                            <span className={"badge badge-" + laneColor(inv._lane) + " text-[10px]"}>{laneLabel(inv._lane)}</span>
                          </td>
                          <td className="px-3 py-2">
                            {pri.totalAnoms > 0 ? (
                              <div className="flex items-center gap-1">
                                <span className={cn("text-xs font-bold", pri.openBlocking > 0 ? "text-red-600" : "text-amber-600")}>{pri.totalAnoms}</span>
                                {pri.openBlocking > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                              </div>
                            ) : <span className="text-xs text-slate-300">{"\u2014"}</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-500 font-mono">{ageFmt(pri.ageHours)}</td>
                          <td className="px-3 py-2">
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded",
                              pri.slaRemaining <= 0 ? "bg-red-100 text-red-700 animate-pulse" :
                              pri.slaRemaining < 8 ? "bg-amber-100 text-amber-700" :
                              "bg-slate-100 text-slate-500")}>{slaFmt(pri.slaRemaining)}</span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              {inv._isDuplicate && <span className="text-[9px] px-1 py-0.5 bg-red-100 text-red-600 font-bold rounded border border-red-200">DUP</span>}
                              {inv.claimedBy && (
                                <span className={cn("text-[9px] px-1 py-0.5 rounded font-medium",
                                  isMine(inv) ? "bg-accent-100 text-accent-700" : "bg-slate-200 text-slate-500")}>
                                  {isMine(inv) ? "\u25cf You" : "Claimed"}
                                </span>
                              )}
                              {inv.status === 'disputed' && <span className="text-[9px] px-1 py-0.5 bg-slate-200 text-slate-500 font-bold rounded">VOID</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {sorted.length === 0 && (
                      <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-400">
                        {total === 0 ? "No invoices in triage queue" : "No invoices match current filters"}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* Keyboard shortcut legend */}
              <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400 flex items-center gap-4">
                <span><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">j</kbd>/<kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">k</kbd> navigate</span>
                <span><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">x</kbd> select</span>
                <span><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">c</kbd> claim</span>
                <span><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">a</kbd> approve</span>
                <span><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">e</kbd> escalate</span>
                <span><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">p</kbd> park</span>
                <span><kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">Esc</kbd> close</span>
              </div>
            </div>
          </div>

          {/* ── DETAIL PANEL (worklist) ── */}
          {sel && (
            <div className="w-1/2 bg-white rounded-2xl border border-slate-200 shadow-sm sticky top-20 self-start max-h-[calc(100vh-7rem)] overflow-y-auto">
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", priColors[sel._pri?.level || 4])}>{priLabels[sel._pri?.level || 4]}</span>
                    <h3 className="text-lg font-bold text-slate-900">{sel.invoiceNumber || sel.id}</h3>
                  </div>
                  <div className="text-sm text-slate-500 mt-0.5">{sel.vendor} {"\u00b7"} {$(sel.amount, sel.currency)}</div>
                </div>
                <button onClick={() => setSel(null)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-100 px-6">
                {[['summary','Summary'],['match','PO Match'],['activity','Activity']].map(([k, label]) => (
                  <button key={k} onClick={() => setDetailTab(k)}
                    className={cn("px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 -mb-px",
                      detailTab === k ? "border-accent-500 text-accent-700" : "border-transparent text-slate-400 hover:text-slate-600")}>{label}</button>
                ))}
              </div>

              <div className="p-6">
                {/* ── TAB: Summary ── */}
                {detailTab === 'summary' && (<>
                  {/* Duplicate warning */}
                  {(sel._isDuplicate || sel.possibleDuplicate) && (
                    <div className="rounded-xl p-3 mb-4 bg-red-50 border border-red-200">
                      <div className="flex items-center gap-2 text-sm font-semibold text-red-700"><AlertTriangle className="w-4 h-4" /> Duplicate Invoice {"\u2014"} Do Not Process</div>
                      <div className="text-xs text-red-600 mt-1">{sel.duplicateWarning || (sel._duplicateCount || 2) + " records exist. Risk: " + $(sel.amount, sel.currency) + " double payment."}</div>
                    </div>
                  )}

                  {/* Claim status */}
                  {sel.claimedBy && (
                    <div className={cn("rounded-xl p-3 mb-4 flex items-center justify-between",
                      isMine(sel) ? "bg-accent-50 border border-accent-200" : "bg-slate-100 border border-slate-200")}>
                      <div className="text-sm">{isMine(sel) ? <span className="font-semibold text-accent-700">You are working on this</span> : <span className="text-slate-600">Claimed by <strong>{sel.claimedByName}</strong></span>}</div>
                      {(isMine(sel) || lvl >= 1) && <button onClick={() => releaseInvoice(sel)} className="btn-o text-xs px-2 py-1">Release</button>}
                    </div>
                  )}

                  {/* Invoice key metrics */}
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] text-slate-500 uppercase">Amount</div><div className="text-sm font-bold">{$(sel.amount, sel.currency)}</div></div>
                    <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] text-slate-500 uppercase">Confidence</div><div className="text-sm font-bold">{pct(sel.confidence)}</div></div>
                    <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] text-slate-500 uppercase">Age</div><div className="text-sm font-bold">{ageFmt(sel._pri?.ageHours || 0)}</div></div>
                    <div className={cn("rounded-lg p-2.5", (sel._pri?.slaRemaining || 99) <= 0 ? "bg-red-50" : "bg-slate-50")}><div className="text-[10px] text-slate-500 uppercase">SLA</div><div className={cn("text-sm font-bold", (sel._pri?.slaRemaining || 99) <= 0 && "text-red-600")}>{slaFmt(sel._pri?.slaRemaining || 0)}</div></div>
                  </div>

                  {/* Triage lane */}
                  <div className="mb-4">
                    <div className={cn("rounded-xl p-3 text-sm font-medium",
                      selLane === 'BLOCK' ? "bg-red-50 text-red-800 border border-red-100" :
                      selLane === 'AUTO_APPROVE' ? "bg-emerald-50 text-emerald-800 border border-emerald-100" :
                      "bg-amber-50 text-amber-800 border border-amber-100")}>{laneLabel(selLane)}</div>
                    {(sel.triageReasons || []).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {sel.triageReasons.map((r, i) => (
                          <div key={i} className={cn("text-xs rounded-lg px-3 py-1.5 border",
                            r.startsWith('BLOCK') ? "text-red-700 bg-red-50 border-red-100" :
                            r.startsWith('ESCALATED') ? "text-amber-700 bg-amber-50 border-amber-100" :
                            r.startsWith('APPROVED') || r.startsWith('Passed') ? "text-emerald-700 bg-emerald-50 border-emerald-100" :
                            "text-slate-600 bg-slate-50 border-slate-100"
                          )}>{"\u2192"} {r}</div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Blocking issues */}
                  {sortBySev(blockingAnoms).length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">Blocking Issues {"\u2014"} {blockingAnoms.length} must be resolved</div>
                      <div className="space-y-2">{sortBySev(blockingAnoms).map(a => <AnomalyCard key={a.id} a={a} />)}</div>
                    </div>
                  )}
                  {sortBySev(otherAnoms).length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Other Findings</div>
                      <div className="space-y-2">{sortBySev(otherAnoms).map(a => <AnomalyCard key={a.id} a={a} />)}</div>
                    </div>
                  )}
                  {contractAnoms.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Contract-Level <span className="font-normal">(vendor-wide)</span></div>
                      <div className="space-y-2">{contractAnoms.map(a => <AnomalyCard key={a.id} a={a} dimmed />)}</div>
                    </div>
                  )}
                  {infoAnoms.length > 0 && !isBlocked && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-2">Opportunities</div>
                      <div className="space-y-2">{infoAnoms.map(a => (
                        <div key={a.id} className="rounded-xl p-3 bg-emerald-50 border border-emerald-100">
                          <div className="flex items-center gap-2 mb-1"><Badge c="ok">{a.severity}</Badge><span className="text-xs text-emerald-600 font-mono">{(a.type || '').replace(/_/g, ' ')}</span></div>
                          <div className="text-sm text-emerald-800">{a.description}</div>
                        </div>
                      ))}</div>
                    </div>
                  )}
                  {infoAnoms.length > 0 && isBlocked && (
                    <div className="mb-4 text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">Early payment discount available once blocking issues resolved.</div>
                  )}
                </>)}

                {/* ── TAB: PO Match ── */}
                {detailTab === 'match' && (() => {
                  const match = (s.matches || []).find(m => m.invoiceId === sel.id);
                  const allDocs = s.docs || [];
                  const po = match ? allDocs.find(d => d.id === match.poId) : null;
                  const grn = match ? allDocs.find(d => d.type === 'goods_receipt' && (d.poReference === match.poNumber || d.poId === match.poId)) : null;
                  const hasMatch = match && po;

                  // Line-item detail if available
                  const invLines = sel.lineItems || [];
                  const poLines = po?.lineItems || [];

                  return (<>
                    {hasMatch ? (<>
                      <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
                        <div className="flex items-center text-xs font-bold bg-slate-50 px-4 py-2.5 gap-2">
                          <span className="text-emerald-700">Invoice</span>
                          <span className={match.matchScore >= 75 ? "text-emerald-500" : "text-amber-500"}>{match.matchScore >= 75 ? "\u2194" : "\u21a2"}</span>
                          <span className="text-blue-700">PO {match.poNumber}</span>
                          <span className={grn ? "text-emerald-500" : "text-slate-300"}>{grn ? "\u2194" : "\u00b7\u00b7\u00b7\u00b7\u00b7"}</span>
                          <span className={grn ? "text-indigo-700" : "text-slate-400"}>GRN</span>
                          <span className="ml-auto"><span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold",
                            grn ? "bg-emerald-100 text-emerald-700" : match.matchScore >= 75 ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700")}>
                            {grn ? "3-Way Match" : match.matchScore >= 75 ? "2-Way Match" : "Review"}</span></span>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-100">
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div><span className="text-slate-500">PO Value</span><div className="font-bold font-mono">{$(po.amount, po.currency)}</div></div>
                            <div><span className="text-slate-500">Invoiced</span><div className={cn("font-bold font-mono", match.overInvoiced && "text-red-600")}>{$(match.poAlreadyInvoiced || 0)}</div></div>
                            <div><span className="text-slate-500">{"\u0394"} Amount</span><div className={cn("font-bold font-mono", (match.amountDifference || 0) > 0 ? "text-amber-600" : "text-emerald-600")}>{$f(match.amountDifference || 0)}</div></div>
                          </div>
                        </div>
                      </div>

                      {/* Line-item reconciliation */}
                      {(invLines.length > 0 || poLines.length > 0) && (
                        <div className="mb-4">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Line-Item Reconciliation</div>
                          <div className="card overflow-hidden">
                            <table className="w-full text-xs">
                              <thead><tr className="bg-slate-50 border-b border-slate-100">
                                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500">Line</th>
                                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500">Description</th>
                                <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500">Inv Qty</th>
                                <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500">PO Qty</th>
                                <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500">Inv Price</th>
                                <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500">PO Price</th>
                                <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500">{"\u0394"}</th>
                              </tr></thead>
                              <tbody className="divide-y divide-slate-50">
                                {invLines.map((line, li) => {
                                  const poLine = poLines[li] || {};
                                  const priceDiff = (line.unitPrice || 0) - (poLine.unitPrice || 0);
                                  return (
                                    <tr key={li} className={priceDiff !== 0 ? "bg-amber-50/50" : ""}>
                                      <td className="px-3 py-1.5 font-mono">{li + 1}</td>
                                      <td className="px-3 py-1.5 text-slate-700 max-w-[120px] truncate">{line.description || line.item || "\u2014"}</td>
                                      <td className="px-3 py-1.5 text-right font-mono">{line.quantity || "\u2014"}</td>
                                      <td className="px-3 py-1.5 text-right font-mono">{poLine.quantity || "\u2014"}</td>
                                      <td className="px-3 py-1.5 text-right font-mono">{line.unitPrice ? $f(line.unitPrice) : "\u2014"}</td>
                                      <td className="px-3 py-1.5 text-right font-mono">{poLine.unitPrice ? $f(poLine.unitPrice) : "\u2014"}</td>
                                      <td className={cn("px-3 py-1.5 text-right font-mono font-bold", priceDiff > 0 ? "text-red-600" : priceDiff < 0 ? "text-emerald-600" : "text-slate-300")}>{priceDiff !== 0 ? $f(priceDiff) : "\u2014"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      {invLines.length === 0 && poLines.length === 0 && (
                        <div className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-3 text-center border border-slate-100">
                          Line-item detail not available for this invoice. Summary-level match shown above.
                        </div>
                      )}
                    </>) : (
                      <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                        {sel.poReference ? <span>PO Ref: <span className="font-semibold text-slate-600">{sel.poReference}</span> {"\u2014"} no matching PO found</span> : "No PO reference on invoice \u2014 unmatched"}
                      </div>
                    )}
                  </>);
                })()}

                {/* ── TAB: Activity ── */}
                {detailTab === 'activity' && (() => {
                  const cases = (s.casesData || []).filter(c => c.invoiceId === sel.id);
                  const overrides = sel.triageOverride ? [{
                    action: "Triage Override",
                    by: sel.triageOverrideBy || "System",
                    at: sel.triageOverrideAt,
                    detail: sel.triageOverrideReason || "Manual override"
                  }] : [];
                  const claimEvents = sel.claimedBy ? [{
                    action: "Claimed",
                    by: sel.claimedByName || sel.claimedBy,
                    at: sel.claimedAt,
                    detail: "Invoice claimed for investigation"
                  }] : [];
                  const allEvents = [...overrides, ...claimEvents].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
                  return (<>
                    {/* Linked cases */}
                    {cases.length > 0 && (
                      <div className="mb-4">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Linked Cases ({cases.length})</div>
                        <div className="space-y-2">
                          {cases.map(c => (
                            <div key={c.id} className="rounded-lg border border-slate-200 p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-bold text-slate-700">{c.id}</span>
                                <Badge c={c.status === 'open' ? 'warn' : c.status === 'resolved' ? 'ok' : 'muted'}>{c.status}</Badge>
                              </div>
                              <div className="text-sm text-slate-600">{c.title}</div>
                              {c.assignedTo && <div className="text-xs text-slate-400 mt-1">Assigned: {c.assignedTo}</div>}
                              {(c.notes || []).length > 0 && (
                                <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                                  {c.notes.slice(-3).map((n, ni) => (
                                    <div key={ni} className="text-xs text-slate-500"><span className="font-medium">{n.by || "System"}</span>: {n.text} <span className="text-slate-300 ml-1">{date(n.at)}</span></div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Event trail */}
                    {allEvents.length > 0 && (
                      <div className="mb-4">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Audit Trail</div>
                        <div className="space-y-2">
                          {allEvents.map((ev, ei) => (
                            <div key={ei} className="flex gap-3 text-xs">
                              <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                              <div><span className="font-semibold text-slate-700">{ev.action}</span> by {ev.by} <span className="text-slate-400">{dateTime(ev.at)}</span><div className="text-slate-500 mt-0.5">{ev.detail}</div></div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {cases.length === 0 && allEvents.length === 0 && (
                      <div className="text-sm text-slate-400 text-center py-8">No activity recorded for this invoice yet.</div>
                    )}
                  </>);
                })()}

                {/* ── AI ROUTING SUGGESTION (Rec #1) ── */}
                {sel && selLane !== 'AUTO_APPROVE' && (() => {
                  const [routing, setRouting] = useState(null);
                  const [routeLoading, setRouteLoading] = useState(false);
                  async function getRouting() {
                    setRouteLoading(true);
                    const caseForInv = (s.casesData || []).find(c => c.invoiceId === sel.id);
                    if (caseForInv) {
                      const r = await api(`/api/ai/route-case/${caseForInv.id}`);
                      if (r && !r._err) setRouting(r);
                    } else {
                      setRouting({ suggestion: 'Create a case first to get AI routing recommendations', fallback: true });
                    }
                    setRouteLoading(false);
                  }
                  return routing ? (
                    <div className="px-6 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-t border-indigo-100">
                      <div className="flex items-center gap-2 mb-1">
                        <Brain className="w-3.5 h-3.5 text-indigo-600" />
                        <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">AI Suggested Assignment</span>
                      </div>
                      <div className="text-xs text-slate-700">{routing.recommended_assignee || routing.primary || routing.suggestion || 'See details'}</div>
                      {routing.reason && <div className="text-[10px] text-indigo-500 mt-0.5">{routing.reason}</div>}
                    </div>
                  ) : (
                    <div className="px-6 pt-2">
                      <button onClick={getRouting} disabled={routeLoading}
                        className="w-full text-[11px] text-indigo-600 hover:text-indigo-800 font-medium py-1.5 flex items-center justify-center gap-1.5">
                        <Brain className="w-3 h-3" /> {routeLoading ? 'Analyzing...' : 'Get AI Routing Suggestion'}
                      </button>
                    </div>
                  );
                })()}

                {/* ── ACTIONS (always visible at bottom) ── */}
                {selLane !== 'AUTO_APPROVE' && (
                  <div className="mt-6 pt-4 border-t border-slate-200">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Actions</div>
                    {!sel.claimedBy && (
                      <button onClick={() => claimInvoice(sel)} className="btn-p text-sm px-4 py-2 w-full mb-2"><Shield className="w-4 h-4" /> Claim & Work on This</button>
                    )}
                    {canAction(sel) && sel.claimedBy && (
                      <div className="space-y-2">
                        {hasDuplicate && (
                          <button onClick={() => voidDuplicate(sel)} className="bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2.5 rounded-xl font-semibold w-full flex items-center justify-center gap-2"><XCircle className="w-4 h-4" /> Void Duplicate</button>
                        )}
                        {hasUnreceipted && !hasDuplicate && (
                          <button onClick={() => { const r = post("/api/cases", { title: "Request GRN: " + sel.invoiceNumber, description: "GRN needed for " + sel.invoiceNumber + " from " + sel.vendor, type: "grn_request", priority: "high", invoiceId: sel.id, vendor: sel.vendor }); r.then(async res => { if (res?.success) { await load(); toast("GRN request sent to Procurement", "success"); } else toast("Failed", "danger"); }); }} className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2.5 rounded-xl font-semibold w-full flex items-center justify-center gap-2"><Send className="w-4 h-4" /> Request GRN</button>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => overrideApprove(sel, hasDuplicate)} className={cn("text-sm px-3 py-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 border transition-all",
                            hasDuplicate ? "border-red-200 text-red-600 hover:bg-red-50 bg-white" : "btn-p")}>
                            <Check className="w-3.5 h-3.5" /> {hasDuplicate ? "Override (Risk)" : "Approve"}
                          </button>
                          <button onClick={() => escalateCase(sel)} className="btn-g text-sm px-3 py-2"><ClipboardList className="w-3.5 h-3.5" /> Case</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => parkInvoice(sel)} className="text-sm px-3 py-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all">
                            <Clock className="w-3.5 h-3.5" /> Park
                          </button>
                          <button onClick={() => sendToVendor(sel)} className="text-sm px-3 py-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all">
                            <Send className="w-3.5 h-3.5" /> Query Vendor
                          </button>
                        </div>
                        {hasDuplicate && <div className="text-[10px] text-red-500 text-center">Override requires exact confirmation text</div>}
                      </div>
                    )}
                    {isClaimed(sel) && lvl < 1 && (
                      <div className="text-xs text-slate-500 text-center bg-slate-50 rounded-lg p-3">Claimed by <strong>{sel.claimedByName}</strong> {"\u2014"} release required to action.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ KANBAN VIEW ══════════════ */}
      {viewMode === 'kanban' && (
        <div className="flex gap-6">
          <div className={cn("transition-all", sel ? "w-1/2" : "w-full")}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {lanes.map(lane => {
                const items = tri[lane] || [];
                const Ic = laneIcons[lane] || Eye;
                return (
                  <div key={lane} className="card overflow-hidden">
                    <div className={cn("px-5 py-3.5 flex items-center gap-3", bgMap[lane])}>
                      <Ic className={cn("w-5 h-5", icMap[lane])} />
                      <div className="flex-1"><div className={cn("text-sm font-bold")}>{laneLabel(lane)}</div></div>
                      <span className={"badge badge-" + laneColor(lane)}>{items.length}</span>
                    </div>
                    <div className="divide-y divide-slate-50 max-h-[400px] overflow-y-auto">
                      {items.length === 0 && <div className="p-6 text-center text-sm text-slate-400">Empty</div>}
                      {items.map(inv => {
                        const pri = computePriority(inv);
                        return (
                          <div key={inv.id} onClick={() => setSel({ ...inv, _lane: lane, _pri: pri })} className={cn("px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer",
                            sel?.id === inv.id && "bg-accent-50 ring-1 ring-accent-200")}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded border", priColors[pri.level])}>{priLabels[pri.level]}</span>
                                <span className="font-semibold text-sm">{inv.invoiceNumber || inv.id}</span>
                              </div>
                              <span className="text-sm font-bold font-mono">{$(inv.amount, inv.currency)}</span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <div className="text-xs text-slate-500">{inv.vendor}</div>
                              <div className="flex items-center gap-1">
                                <span className={cn("text-[9px] font-mono", pri.slaRemaining <= 0 ? "text-red-500 font-bold" : "text-slate-400")}>{slaFmt(pri.slaRemaining)}</span>
                                {inv._isDuplicate && <span className="text-[9px] px-1 bg-red-100 text-red-600 font-bold rounded">DUP</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Kanban detail reuses same detail panel logic — simplified */}
          {sel && viewMode === 'kanban' && (
            <div className="w-1/2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sticky top-24 self-start max-h-[calc(100vh-8rem)] overflow-y-auto">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{sel.invoiceNumber || sel.id}</h3>
                  <div className="text-sm text-slate-500">{sel.vendor} {"\u00b7"} {$(sel.amount, sel.currency)}</div>
                </div>
                <button onClick={() => setSel(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
              </div>
              <div className="text-xs text-slate-400">Switch to Worklist view for full investigation panel with PO match, line-item reconciliation, and activity trail.</div>
            </div>
          )}
        </div>
      )}
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

            {/* AI Intelligence Panel (Rec #1) */}
            {(() => {
              const [brief, setBrief] = useState(null);
              const [briefLoading, setBriefLoading] = useState(false);
              const [vendorDraft, setVendorDraft] = useState(null);
              const [draftLoading, setDraftLoading] = useState(false);
              const [draftType, setDraftType] = useState('dispute');

              async function genBrief() {
                setBriefLoading(true);
                const r = await api(`/api/ai/investigation-brief/${detail.id}`);
                setBriefLoading(false);
                if (r && !r._err) setBrief(r);
                else toast(r?.detail || 'AI brief failed — ensure ANTHROPIC_API_KEY is set', 'warning');
              }
              async function genDraft(type) {
                setDraftLoading(true);
                const r = await post(`/api/ai/vendor-draft/${detail.id}`, { comm_type: type });
                setDraftLoading(false);
                if (r && !r._err) setVendorDraft(r);
                else toast(r?.detail || 'Draft failed — ensure ANTHROPIC_API_KEY is set', 'warning');
              }

              return (
                <div className="mb-4 space-y-3">
                  {/* AI Action Buttons */}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={genBrief} disabled={briefLoading}
                      className="btn bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs flex items-center gap-1.5 border border-indigo-200">
                      <Brain className="w-3.5 h-3.5" /> {briefLoading ? 'Generating...' : 'AI Investigation Brief'}
                    </button>
                    <button onClick={() => genDraft('dispute')} disabled={draftLoading}
                      className="btn bg-purple-50 text-purple-700 hover:bg-purple-100 text-xs flex items-center gap-1.5 border border-purple-200">
                      <Send className="w-3.5 h-3.5" /> {draftLoading ? 'Drafting...' : 'Draft Vendor Letter'}
                    </button>
                    <button onClick={() => genDraft('query')} disabled={draftLoading}
                      className="btn bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs flex items-center gap-1.5 border border-blue-200">
                      <Send className="w-3.5 h-3.5" /> Draft Query
                    </button>
                  </div>

                  {/* Investigation Brief Result */}
                  {brief && (
                    <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Brain className="w-4 h-4 text-indigo-600" />
                          <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">AI Investigation Brief</span>
                        </div>
                        <button onClick={() => setBrief(null)} className="text-xs text-slate-400 hover:text-slate-600">dismiss</button>
                      </div>
                      <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{brief.brief || brief.narrative || brief.summary || JSON.stringify(brief, null, 2)}</div>
                      {brief.risk_level && <div className="mt-2"><Badge c={brief.risk_level === 'high' ? 'err' : brief.risk_level === 'medium' ? 'warn' : 'ok'}>Risk: {brief.risk_level}</Badge></div>}
                      {brief.recommended_actions && (
                        <div className="mt-2 text-xs text-indigo-600">
                          <strong>Recommended:</strong> {Array.isArray(brief.recommended_actions) ? brief.recommended_actions.join(', ') : brief.recommended_actions}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Vendor Draft Result */}
                  {vendorDraft && (
                    <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Send className="w-4 h-4 text-purple-600" />
                          <span className="text-xs font-bold text-purple-700 uppercase tracking-wider">AI-Generated {vendorDraft.comm_type || 'Vendor'} Letter</span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { navigator.clipboard.writeText(vendorDraft.draft || vendorDraft.body || ''); toast('Copied to clipboard', 'success'); }}
                            className="text-xs text-purple-600 hover:text-purple-800 font-medium">Copy</button>
                          <button onClick={() => setVendorDraft(null)} className="text-xs text-slate-400 hover:text-slate-600">dismiss</button>
                        </div>
                      </div>
                      {vendorDraft.subject && <div className="text-xs font-semibold text-purple-800 mb-1">Subject: {vendorDraft.subject}</div>}
                      <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap bg-white/50 rounded-lg p-3 border border-purple-100">{vendorDraft.draft || vendorDraft.body || JSON.stringify(vendorDraft)}</div>
                    </div>
                  )}
                </div>
              );
            })()}
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
  const { s, toast } = useStore();
  const vendors = s.vendors || [];
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showMaster, setShowMaster] = useState(false);
  const [vendorMaster, setVendorMaster] = useState([]);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorCode, setNewVendorCode] = useState('');
  const [masterLoading, setMasterLoading] = useState(false);

  const role = s.user?.role || 'analyst';
  const isManager = RL[role] >= 1;

  // Reset to list when sidebar re-clicked
  useEffect(() => { if (s.tab === 'vendors') { setSel(null); setDetail(null); } }, [s.tabKey]);

  async function fetchMaster() {
    setMasterLoading(true);
    const r = await api('/api/vendor-master');
    if (r?.vendors) setVendorMaster(r.vendors);
    setMasterLoading(false);
  }

  async function addVendor() {
    if (!newVendorName.trim()) { toast('Vendor name required', 'warning'); return; }
    const r = await post('/api/vendor-master', { name: newVendorName.trim(), code: newVendorCode.trim() || null });
    if (r?.success) {
      toast(`${newVendorName.trim()} added to Vendor Master`, 'success');
      setNewVendorName(''); setNewVendorCode('');
      await fetchMaster();
    } else {
      toast(r?.detail || 'Failed to add vendor', 'danger');
    }
  }

  async function removeVendor(id, name) {
    if (!confirm(`Remove "${name}" from the Vendor Master? This does not delete their documents or anomalies.`)) return;
    const r = await api(`/api/vendor-master/${id}`, { method: 'DELETE' });
    if (r?.success) { toast(`${name} removed`, 'success'); await fetchMaster(); }
    else toast('Failed to remove', 'danger');
  }

  async function syncMaster() {
    const r = await post('/api/vendor-master/sync', {});
    if (r?.success) { toast(`Synced — ${r.added} new vendors added (${r.total} total)`, 'success'); await fetchMaster(); }
    else toast('Sync failed', 'danger');
  }

  useEffect(() => { if (showMaster) fetchMaster(); }, [showMaster]);

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
      <PageHeader title="Vendors" sub={`${vendors.length} vendors tracked`}>
        {isManager && (
          <button onClick={() => setShowMaster(!showMaster)} className={cn("btn-o text-xs", showMaster && "bg-accent-50 border-accent-300")}>
            <Database className="w-3.5 h-3.5" /> {showMaster ? 'Hide' : 'Manage'} Vendor Master
          </button>
        )}
      </PageHeader>

      {/* ── Vendor Master Management (Manager+ only) ── */}
      {showMaster && isManager && (
        <div className="card p-5 mb-5 border-l-4 border-l-accent-500">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Vendor Master</h3>
              <div className="text-xs text-slate-500 mt-0.5">Canonical vendor register — {vendorMaster.length} vendors. Add vendors here before documents arrive, or sync from uploaded documents.</div>
            </div>
            <button onClick={syncMaster} className="btn-o text-xs px-3 py-1.5">
              <RefreshCw className="w-3 h-3" /> Sync from Documents
            </button>
          </div>

          {/* Add new vendor */}
          <div className="flex gap-2 mb-3">
            <input value={newVendorName} onChange={e => setNewVendorName(e.target.value)} placeholder="Vendor name (e.g. Acme Corp)"
              className="inp flex-1 text-sm" onKeyDown={e => e.key === 'Enter' && addVendor()} />
            <input value={newVendorCode} onChange={e => setNewVendorCode(e.target.value)} placeholder="Code (optional)"
              className="inp w-32 text-sm font-mono" onKeyDown={e => e.key === 'Enter' && addVendor()} />
            <button onClick={addVendor} className="btn-p text-xs px-3">Add</button>
          </div>

          {/* Master list */}
          {masterLoading ? (
            <div className="text-xs text-slate-400 text-center py-4">Loading...</div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {vendorMaster.map(v => (
                <div key={v.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-800 font-medium">{v.name}</span>
                    {v.code && <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded font-mono">{v.code}</span>}
                    <span className="text-[10px] text-slate-400">({v.normalized})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">{v.createdBy}</span>
                    <button onClick={() => removeVendor(v.id, v.name)} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              {vendorMaster.length === 0 && (
                <div className="text-xs text-slate-400 text-center py-4">No vendors in master. Add manually above or click "Sync from Documents" to import from uploaded invoices/POs.</div>
              )}
            </div>
          )}
        </div>
      )}

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

                {/* AI Vendor Insights (Rec #1) */}
                {(() => {
                  const [vInsights, setVInsights] = useState(null);
                  const [vInsLoading, setVInsLoading] = useState(false);
                  async function genInsights() {
                    setVInsLoading(true);
                    const vName = encodeURIComponent(sel.vendor || sel.vendorDisplay || sel.name || '');
                    const r = await api(`/api/ai/vendor-insights/${vName}`);
                    setVInsLoading(false);
                    if (r && !r._err) setVInsights(r);
                    else toast(r?.detail || 'AI insights failed — ensure ANTHROPIC_API_KEY is set', 'warning');
                  }
                  return (
                    <div className="mb-5">
                      {!vInsights && (
                        <button onClick={genInsights} disabled={vInsLoading}
                          className="w-full btn bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs py-2.5 flex items-center justify-center gap-2 rounded-xl border border-indigo-200">
                          <Brain className="w-3.5 h-3.5" /> {vInsLoading ? 'AI Analyzing Vendor Patterns...' : 'Generate AI Vendor Insights'}
                        </button>
                      )}
                      {vInsights && (
                        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Brain className="w-4 h-4 text-indigo-600" />
                              <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">AI Vendor Analysis</span>
                            </div>
                            <button onClick={() => setVInsights(null)} className="text-xs text-slate-400 hover:text-slate-600">dismiss</button>
                          </div>
                          <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{vInsights.narrative || vInsights.insights || vInsights.analysis || JSON.stringify(vInsights, null, 2)}</div>
                          {vInsights.risk_trend && <div className="mt-2 text-xs text-indigo-600 font-medium">Risk Trend: {vInsights.risk_trend}</div>}
                          {vInsights.recommendations && (
                            <div className="mt-2 p-2 bg-white/60 rounded-lg">
                              <div className="text-xs font-semibold text-purple-700 mb-1">Recommendations:</div>
                              <div className="text-xs text-slate-700">{Array.isArray(vInsights.recommendations) ? vInsights.recommendations.join(' • ') : vInsights.recommendations}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
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

/* ═══════════════════════════════════════════════════
   TEAM & ACCESS MANAGEMENT
   ═══════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════
   WORKFORCE MANAGEMENT — Manager oversight dashboard
   ═══════════════════════════════════════════════════ */
function Workforce() {
  const { s, toast } = useStore();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selAnalyst, setSelAnalyst] = useState(null);

  async function fetchData() {
    setLoading(true);
    const r = await api('/api/workforce');
    if (r && !r.detail) setData(r);
    setLoading(false);
  }
  useEffect(() => { fetchData(); }, []);

  if (loading) return <div className="page-enter"><PageHeader title="Workforce" sub="Analyst performance & queue health" /><div className="card p-12 text-center text-slate-400">Loading workforce metrics...</div></div>;
  if (!data) return <div className="page-enter"><PageHeader title="Workforce" sub="Analyst performance & queue health" /><div className="card p-12 text-center text-red-400">Failed to load workforce data</div></div>;

  const q = data.queueHealth;
  const sla = data.sla;
  const analysts = data.analysts || [];
  const trend = data.queueTrend || [];
  const sum = data.summary || {};
  const PIE_C = ['#10b981', '#f59e0b', '#ef4444'];
  const slaData = [
    { name: 'Within SLA', value: sla.withinSla, fill: '#10b981' },
    { name: 'Near Breach', value: sla.nearBreach, fill: '#f59e0b' },
    { name: 'Breached', value: sla.breached, fill: '#ef4444' },
  ].filter(d => d.value > 0);
  const agingData = [
    { name: '< 4h', v: q.agingBuckets.under_4h, fill: '#10b981' },
    { name: '4-24h', v: q.agingBuckets['4_24h'], fill: '#f59e0b' },
    { name: '1-3d', v: q.agingBuckets['1_3d'], fill: '#f97316' },
    { name: '3d+', v: q.agingBuckets.over_3d, fill: '#ef4444' },
  ];

  const sel = selAnalyst ? analysts.find(a => a.id === selAnalyst) : null;

  return (
    <div className="page-enter space-y-6">
      <PageHeader title="Workforce" sub="Analyst performance & queue health">
        <button onClick={fetchData} className="btn-o text-xs px-3 py-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </PageHeader>

      {/* ── Row 1: Queue Health KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard icon={ClipboardList} label="Actionable Queue" value={q.totalActionable} sub={`${q.openAnomalies} anomalies + ${q.blockedInvoices} blocked + ${q.reviewInvoices} review`} color="#3b82f6" />
        <StatCard icon={AlertCircle} label="Unclaimed" value={q.unclaimed} sub={q.agingBuckets.over_3d > 0 ? `${q.agingBuckets.over_3d} older than 3 days!` : 'All recently queued'} color={q.agingBuckets.over_3d > 0 ? '#ef4444' : '#10b981'} />
        <StatCard icon={Users} label="Active Today" value={`${sum.activeToday}/${sum.totalAnalysts}`} sub="Analysts with actions today" color="#8b5cf6" />
        <StatCard icon={TrendingUp} label="Avg Throughput" value={`${sum.avgThroughputWeek}/wk`} sub="Resolved + dismissed per analyst" color="#0ea5e9" />
        <StatCard icon={Shield} label="SLA Compliance" value={`${sla.compliancePct}%`} sub={sla.breached > 0 ? `${sla.breached} breached` : 'All within SLA'} color={sla.compliancePct >= 90 ? '#10b981' : sla.compliancePct >= 70 ? '#f59e0b' : '#ef4444'} />
      </div>

      {/* ── Row 2: Queue Aging + SLA + 7-Day Trend ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Unclaimed Aging */}
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Unclaimed Item Aging</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={agingData}><XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} /><Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 8px 32px rgba(0,0,0,.1)', fontSize: 12 }} /><Bar dataKey="v" radius={[6, 6, 0, 0]}>{agingData.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar></BarChart>
          </ResponsiveContainer>
          {q.agingBuckets.over_3d > 0 && (
            <div className="mt-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700 font-medium">
              ⚠ {q.agingBuckets.over_3d} items unclaimed for 3+ days — SLA breach risk
            </div>
          )}
        </div>

        {/* SLA Compliance */}
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">SLA Status</div>
          {slaData.length > 0 ? (
            <div className="flex items-center gap-4">
              <div className="w-28 h-28">
                <ResponsiveContainer><PieChart><Pie data={slaData} dataKey="value" cx="50%" cy="50%" outerRadius={50} innerRadius={30} strokeWidth={2}>{slaData.map((d, i) => <Cell key={i} fill={d.fill} />)}</Pie></PieChart></ResponsiveContainer>
              </div>
              <div className="space-y-2 text-xs">
                {slaData.map(d => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
                    <span className="text-slate-600">{d.name}</span>
                    <span className="font-bold text-slate-800 ml-auto">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-400 text-center py-8">No open anomalies</div>
          )}
          {/* SLA by severity */}
          {Object.keys(sla.bySeverity || {}).length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
              {Object.entries(sla.bySeverity).map(([sev, counts]) => (
                <div key={sev} className="flex items-center gap-2 text-xs">
                  <Badge c={sev === 'high' ? 'err' : sev === 'medium' ? 'warn' : 'ok'}>{sev}</Badge>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(counts.withinSla / Math.max(counts.total, 1)) * 100}%` }} />
                  </div>
                  <span className="text-slate-500 w-16 text-right">{counts.withinSla}/{counts.total}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 7-Day Trend */}
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">7-Day Trend</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={trend}><XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} /><Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 8px 32px rgba(0,0,0,.1)', fontSize: 12 }} /><Bar dataKey="new" name="New" fill="#94a3b8" radius={[3, 3, 0, 0]} /><Bar dataKey="claimed" name="Claimed" fill="#3b82f6" radius={[3, 3, 0, 0]} /><Bar dataKey="resolved" name="Resolved" fill="#10b981" radius={[3, 3, 0, 0]} /></BarChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-slate-400" /> New</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500" /> Claimed</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500" /> Resolved</span>
          </div>
        </div>
      </div>

      {/* ── Row 3: Analyst Scorecards ── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-700">Analyst Scorecards</div>
          <div className="text-xs text-slate-400">{analysts.length} analysts</div>
        </div>
        <div className="divide-y divide-slate-50">
          {analysts.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No analysts configured. Assign vendors in Team & Access first.</div>}
          {analysts.map(a => {
            const cpIdx = a.cherryPickIndex;
            const cpColor = cpIdx === null ? 'text-slate-300' : cpIdx >= 0.7 ? 'text-emerald-600' : cpIdx >= 0.4 ? 'text-amber-600' : 'text-red-600';
            const cpLabel = cpIdx === null ? '—' : cpIdx >= 0.7 ? 'Fair' : cpIdx >= 0.4 ? 'Skewed' : 'Cherry-picking';
            const isSelected = selAnalyst === a.id;
            return (
              <div key={a.id} onClick={() => setSelAnalyst(isSelected ? null : a.id)}
                className={cn('px-5 py-4 cursor-pointer transition-colors', isSelected ? 'bg-accent-50 ring-1 ring-inset ring-accent-200' : 'hover:bg-slate-50')}>
                <div className="flex items-center gap-4">
                  {/* Avatar + name */}
                  <div className="flex items-center gap-3 w-44 flex-shrink-0">
                    <div className="w-9 h-9 rounded-full bg-accent-600 text-white flex items-center justify-center text-xs font-bold">{(a.name || '?')[0].toUpperCase()}</div>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{a.name}</div>
                      <div className="text-[10px] text-slate-400">{a.vendorCount} vendor{a.vendorCount !== 1 ? 's' : ''}</div>
                    </div>
                  </div>

                  {/* Metrics row */}
                  <div className="flex-1 grid grid-cols-7 gap-2 text-center">
                    <div>
                      <div className="text-lg font-bold text-slate-800">{a.throughputToday}</div>
                      <div className="text-[10px] text-slate-400">Today</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-slate-800">{a.throughputWeek}</div>
                      <div className="text-[10px] text-slate-400">This Week</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-blue-600">{a.currentlyClaimedCount}</div>
                      <div className="text-[10px] text-slate-400">In Progress</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-amber-600">{a.unclaimedInScope}</div>
                      <div className="text-[10px] text-slate-400">Unclaimed</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-slate-600">{a.avgResolutionHours > 0 ? `${a.avgResolutionHours}h` : '—'}</div>
                      <div className="text-[10px] text-slate-400">Avg Time</div>
                    </div>
                    <div>
                      <div className={cn('text-lg font-bold', cpColor)}>{cpIdx !== null ? cpIdx.toFixed(1) : '—'}</div>
                      <div className="text-[10px] text-slate-400">Mix Index</div>
                    </div>
                    <div>
                      <div className={cn('text-lg font-bold', a.escalatedWeek > 0 ? 'text-amber-600' : 'text-slate-300')}>{a.escalatedWeek}</div>
                      <div className="text-[10px] text-slate-400">Escalated</div>
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {isSelected && (
                  <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-50 rounded-xl p-3">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Claims Today / Week</div>
                      <div className="text-base font-bold">{a.claimsToday} / {a.claimsWeek}</div>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3">
                      <div className="text-[10px] text-emerald-500 uppercase font-semibold">Resolved Today / Week</div>
                      <div className="text-base font-bold text-emerald-700">{a.resolvedToday} / {a.resolvedWeek}</div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Dismissed Today / Week</div>
                      <div className="text-base font-bold">{a.dismissedToday} / {a.dismissedWeek}</div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Overrides / Expired Claims</div>
                      <div className="text-base font-bold">{a.overridesWeek} / {a.expiredClaimsWeek}</div>
                    </div>
                    {/* Severity Distribution */}
                    <div className="col-span-2 md:col-span-4">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold mb-1.5">Severity Mix (resolved + dismissed)</div>
                      <div className="flex items-center gap-2">
                        {['high', 'medium', 'low'].map(sev => {
                          const total = a.severityDistribution.high + a.severityDistribution.medium + a.severityDistribution.low;
                          const w = total > 0 ? (a.severityDistribution[sev] / total * 100) : 0;
                          const colors = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-emerald-400' };
                          return w > 0 ? <div key={sev} className={cn('h-3 rounded-full', colors[sev])} style={{ width: `${Math.max(w, 5)}%` }} title={`${sev}: ${a.severityDistribution[sev]} (${Math.round(w)}%)`} /> : null;
                        })}
                        {(a.severityDistribution.high + a.severityDistribution.medium + a.severityDistribution.low) === 0 && (
                          <div className="text-xs text-slate-300">No resolved items yet</div>
                        )}
                      </div>
                      <div className="flex gap-3 mt-1 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> High ({a.severityDistribution.high})</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Medium ({a.severityDistribution.medium})</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Low ({a.severityDistribution.low})</span>
                        <span className={cn('ml-auto font-semibold', cpColor)}>Mix: {cpLabel}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Row 4: SLA by Analyst ── */}
      {Object.keys(sla.byAnalyst || {}).length > 0 && (
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">SLA Status by Analyst / Queue</div>
          <div className="space-y-2">
            {Object.entries(sla.byAnalyst).map(([name, counts]) => {
              const total = counts.withinSla + counts.nearBreach + counts.breached;
              return (
                <div key={name} className="flex items-center gap-3">
                  <div className="w-32 text-sm text-slate-700 font-medium truncate">{name}</div>
                  <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden flex">
                    {counts.withinSla > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(counts.withinSla / total) * 100}%` }} />}
                    {counts.nearBreach > 0 && <div className="h-full bg-amber-400" style={{ width: `${(counts.nearBreach / total) * 100}%` }} />}
                    {counts.breached > 0 && <div className="h-full bg-red-500" style={{ width: `${(counts.breached / total) * 100}%` }} />}
                  </div>
                  <div className="w-24 text-right flex items-center gap-1 justify-end">
                    {counts.breached > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 font-bold rounded-full">{counts.breached} breach</span>}
                    <span className="text-xs text-slate-400">{total}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Info Panel ── */}
      <div className="card p-5 bg-slate-50 border-slate-200">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Reading the Metrics</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-500">
          <div><span className="font-semibold text-slate-700">Mix Index</span> measures whether an analyst is handling a proportional share of high-severity items. 1.0 = perfectly proportional to the overall pool. Below 0.4 flags potential cherry-picking — they may be avoiding complex items.</div>
          <div><span className="font-semibold text-slate-700">Unclaimed in Scope</span> shows open items within this analyst's vendor assignment that nobody has claimed yet. A high number means the analyst has available work they haven't picked up.</div>
          <div><span className="font-semibold text-slate-700">SLA Config</span>: Critical = {sla.config?.sla_critical_hours || 4}h, High = {sla.config?.sla_high_hours || 24}h, Medium = {sla.config?.sla_medium_hours || 72}h, Low = {sla.config?.sla_low_hours || 168}h. Claims auto-expire after {data.queueHealth?.claim_expiry_hours || 4}h.</div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TEAM MANAGEMENT
   ═══════════════════════════════════════════════════ */
function TeamManagement() {
  const { s, toast, load } = useStore();
  const [users, setUsers] = useState([]);
  const [editUser, setEditUser] = useState(null);
  const [selectedVendors, setSelectedVendors] = useState([]); // stores normalized keys
  const [loading, setLoading] = useState(true);
  const [vendorMaster, setVendorMaster] = useState([]);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const [uRes, vmRes] = await Promise.all([
      api('/api/auth/users'),
      api('/api/vendor-master'),
    ]);
    if (uRes?.users) setUsers(uRes.users);
    if (vmRes?.vendors) setVendorMaster(vmRes.vendors);
    setLoading(false);
  }

  const masterLookup = Object.fromEntries(vendorMaster.map(v => [v.normalized, v.name]));

  function startEdit(u) {
    setEditUser(u);
    setSelectedVendors(u.assignedVendors || []);
  }

  async function saveVendors() {
    if (!editUser) return;
    // Send normalized names — backend stores them as-is
    const r = await post(`/api/auth/users/${editUser.id}/assign-vendors`, { vendors: selectedVendors });
    if (r?.success) {
      toast(`Vendor scope updated for ${editUser.name}`, 'success');
      setEditUser(null);
      await fetchAll();
      await load();
    } else {
      toast('Failed to update vendor scope', 'danger');
    }
  }

  function toggleVendor(normalizedKey) {
    setSelectedVendors(prev => prev.includes(normalizedKey) ? prev.filter(x => x !== normalizedKey) : [...prev, normalizedKey]);
  }

  const analysts = users.filter(u => u.role === 'analyst');
  const others = users.filter(u => u.role !== 'analyst');

  return (
    <div className="page-enter space-y-6">
      <PageHeader title="Team & Access" sub="Manage analyst vendor assignments and data access scope" />

      {/* Explanation card */}
      <div className="card p-4 bg-amber-50 border-amber-200">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-amber-900">Segregation of Duties</div>
            <div className="text-sm text-amber-800 mt-1">
              AP Analysts see only data for their assigned vendors — invoices, anomalies, matches, and risk scores.
              Managers and above have full visibility across all vendors. Vendor list is sourced from the <strong>Vendor Master</strong> — manage it in Master Data → Vendors.
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center text-slate-400">Loading users...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Analysts with vendor scope */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">AP Analysts — Vendor Scope</h3>
            {analysts.length === 0 && (
              <div className="card p-6 text-center text-slate-400 text-sm">No analysts registered yet</div>
            )}
            {analysts.map(u => (
              <div key={u.id} className={cn("card p-4 transition-all", editUser?.id === u.id && "ring-2 ring-accent-500")}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{u.name}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </div>
                  <button onClick={() => startEdit(u)} className="btn-o text-xs px-3 py-1">
                    <Edit3 className="w-3 h-3" /> {editUser?.id === u.id ? 'Editing...' : 'Edit Scope'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(u.assignedVendorNames || u.assignedVendors || []).length > 0 ? (
                    (u.assignedVendorNames || u.assignedVendors || []).map((v, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 bg-accent-50 text-accent-700 rounded-full border border-accent-200 font-medium">{v}</span>
                    ))
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full border border-amber-200 font-medium">⚠ Full access (no vendors assigned)</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Vendor assignment editor */}
          <div>
            {editUser ? (
              <div className="card p-5 sticky top-24">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Assign Vendors to {editUser.name}</h3>
                    <div className="text-xs text-slate-500 mt-0.5">{selectedVendors.length} of {vendorMaster.length} vendors selected</div>
                  </div>
                  <button onClick={() => setEditUser(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
                </div>

                {/* Quick actions */}
                <div className="flex gap-2 mb-3">
                  <button onClick={() => setSelectedVendors(vendorMaster.map(v => v.normalized))} className="btn-o text-xs px-2 py-1">Select All</button>
                  <button onClick={() => setSelectedVendors([])} className="btn-o text-xs px-2 py-1">Clear All</button>
                </div>

                {/* Vendor checkboxes — keyed by normalized, displayed by name */}
                <div className="max-h-72 overflow-y-auto space-y-1 mb-4 border border-slate-100 rounded-xl p-2">
                  {vendorMaster.length === 0 && (
                    <div className="text-xs text-slate-400 text-center py-4">No vendors in Vendor Master. Add them in Master Data → Vendors, or upload documents.</div>
                  )}
                  {vendorMaster.map(v => (
                    <label key={v.id} className={cn("flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors",
                      selectedVendors.includes(v.normalized) ? "bg-accent-50" : "hover:bg-slate-50")}>
                      <input type="checkbox" checked={selectedVendors.includes(v.normalized)} onChange={() => toggleVendor(v.normalized)}
                        className="w-4 h-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500" />
                      <span className="text-sm text-slate-700">{v.name}</span>
                      {v.code && <span className="text-[10px] text-slate-400 font-mono ml-auto">{v.code}</span>}
                    </label>
                  ))}
                </div>

                <button onClick={saveVendors} className="btn-p text-sm px-4 py-2 w-full">
                  <Check className="w-4 h-4" /> Save Vendor Assignment
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Managers & Leadership</h3>
                {others.map(u => (
                  <div key={u.id} className="card p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-slate-900">{u.name}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </div>
                      <Badge c="ok">{u.roleTitle || u.role}</Badge>
                    </div>
                    <div className="text-[11px] text-emerald-600 mt-1.5 font-medium">✓ Full visibility — all vendors</div>
                  </div>
                ))}
                {others.length === 0 && (
                  <div className="card p-6 text-center text-slate-400 text-sm">No managers/leadership registered</div>
                )}
              </div>
            )}
          </div>
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

      {/* NLP Policy Configuration (Rec #1) */}
      {(() => {
        const [nlpInput, setNlpInput] = useState('');
        const [nlpResult, setNlpResult] = useState(null);
        const [nlpLoading, setNlpLoading] = useState(false);

        async function parsePolicy() {
          if (!nlpInput.trim()) return;
          setNlpLoading(true);
          const r = await post('/api/ai/policy-parse', { input: nlpInput });
          setNlpLoading(false);
          if (r && !r._err) { setNlpResult(r); toast('AI parsed your policy — review changes below', 'success'); }
          else toast(r?.detail || 'NLP parse failed — ensure ANTHROPIC_API_KEY is set', 'warning');
        }
        async function applyNlpChanges() {
          if (!nlpResult?.changes) return;
          await post('/api/policy', nlpResult.changes);
          await load();
          setNlpResult(null); setNlpInput('');
          toast('Policy updated from natural language', 'success');
        }

        return (
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-5 h-5 text-indigo-600" />
              <div>
                <div className="text-sm font-bold text-indigo-900">Configure Policy with Natural Language</div>
                <div className="text-xs text-indigo-600">Describe your AP policy in plain English — AI will translate it to settings</div>
              </div>
            </div>
            <div className="flex gap-2">
              <input value={nlpInput} onChange={e => setNlpInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') parsePolicy(); }}
                placeholder='e.g. "Block invoices over $50K without a PO" or "Tighten tolerance to 1% for high-risk vendors"'
                className="inp flex-1 text-sm" />
              <button onClick={parsePolicy} disabled={nlpLoading || !nlpInput.trim()}
                className="btn-p text-xs whitespace-nowrap">
                {nlpLoading ? 'Parsing...' : 'Apply with AI'}
              </button>
            </div>
            {nlpResult && (
              <div className="mt-3 p-3 bg-white/70 rounded-xl border border-indigo-100">
                <div className="text-xs font-bold text-indigo-700 mb-2">AI Proposed Changes:</div>
                <div className="text-sm text-slate-800 mb-2">{nlpResult.interpretation || nlpResult.explanation || 'Policy changes identified'}</div>
                {nlpResult.changes && (
                  <div className="space-y-1 mb-3">
                    {Object.entries(nlpResult.changes).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs bg-indigo-50 p-2 rounded-lg">
                        <span className="text-slate-600">{k.replace(/_/g, ' ')}</span>
                        <span className="font-mono font-bold text-indigo-700">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={applyNlpChanges} className="btn bg-indigo-600 text-white hover:bg-indigo-700 text-xs"><Check className="w-3 h-3" /> Apply Changes</button>
                  <button onClick={() => setNlpResult(null)} className="btn-o text-xs">Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* R7: Data Governance Dashboard */}
      {(() => {
        const [gov, setGov] = useState(null);
        const [govLoading, setGovLoading] = useState(false);
        const [auditLog, setAuditLog] = useState(null);
        const [vendorCtl, setVendorCtl] = useState(null);
        const [vendorInput, setVendorInput] = useState('');
        const [showGov, setShowGov] = useState(false);

        async function loadGovernance() {
          setGovLoading(true);
          const r = await api('/api/data-governance');
          if (r && !r.error) setGov(r);
          setGovLoading(false);
        }
        async function loadAuditLog() {
          const r = await api('/api/data-governance/audit-log?limit=50');
          if (r) setAuditLog(r);
        }
        async function loadVendorCtl(v) {
          if (!v) return;
          const r = await api(`/api/data-governance/vendor-controls/${encodeURIComponent(v)}`);
          if (r) setVendorCtl(r);
        }
        async function toggleVendorCtl(vendor, field) {
          if (!vendorCtl) return;
          const current = vendorCtl.ai_controls?.[field] ?? true;
          await post(`/api/data-governance/vendor-controls/${encodeURIComponent(vendor)}`,
            { ...vendorCtl.ai_controls, [field]: !current });
          loadVendorCtl(vendor);
          toast(`${field.replace(/_/g, ' ')}: ${!current ? 'ON' : 'OFF'}`, 'success');
        }

        const tier = gov?.privacy_posture;
        const egress = gov?.egress_map || {};
        const audit = gov?.audit_summary || {};
        const preset = gov?.deployment_preset?.current_preset || 'standard';

        const riskColor = (r) => r === 'none' ? '#10b981' : r === 'low' ? '#3b82f6' : r === 'medium' ? '#f59e0b' : '#ef4444';
        const presetColor = { standard: '#f59e0b', enterprise_private: '#10b981', airgapped: '#06b6d4' };

        return (
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-emerald-600" />
                <div>
                  <div className="text-sm font-bold text-emerald-900">Data Governance & Privacy</div>
                  <div className="text-xs text-emerald-600">LLM data residency, PII redaction, audit trail, per-vendor controls</div>
                </div>
              </div>
              <button onClick={() => { setShowGov(!showGov); if (!gov) loadGovernance(); }}
                className="btn-o text-xs">{showGov ? 'Hide' : 'Show'} Governance</button>
            </div>

            {showGov && (
              <div className="space-y-4 mt-4">
                {govLoading && <div className="text-xs text-slate-500">Loading governance data...</div>}

                {/* Privacy Posture Summary */}
                {tier && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 bg-white rounded-xl border">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">LLM Provider</div>
                      <div className="text-sm font-bold" style={{ color: tier.llm_provider?.provider === 'anthropic' ? '#f59e0b' : '#10b981' }}>
                        {(tier.llm_provider?.provider || 'unknown').toUpperCase()}
                      </div>
                      <div className="text-[10px] text-slate-500">{tier.llm_provider?.data_residency}</div>
                    </div>
                    <div className="p-3 bg-white rounded-xl border">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Embeddings</div>
                      <div className="text-sm font-bold" style={{ color: tier.embedding_provider === 'voyage' ? '#f59e0b' : '#10b981' }}>
                        {tier.embedding_provider?.toUpperCase()}
                      </div>
                      <div className="text-[10px] text-slate-500">{tier.embedding_provider === 'voyage' ? 'Cloud API' : 'Local only'}</div>
                    </div>
                    <div className="p-3 bg-white rounded-xl border">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Fine-Tuning</div>
                      <div className="text-sm font-bold" style={{ color: tier.finetune_provider === 'together' ? '#f59e0b' : '#10b981' }}>
                        {tier.finetune_provider?.toUpperCase()}
                      </div>
                      <div className="text-[10px] text-slate-500">{tier.finetune_provider === 'together' ? 'Cloud (data egress)' : 'On-premise'}</div>
                    </div>
                    <div className="p-3 bg-white rounded-xl border">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">PII Redaction</div>
                      <div className="text-sm font-bold" style={{ color: tier.pii_redaction_enabled ? '#10b981' : '#94a3b8' }}>
                        {tier.pii_redaction_enabled ? 'ACTIVE' : 'OFF'}
                      </div>
                      <div className="text-[10px] text-slate-500">{tier.zero_data_retention ? 'ZDR active' : 'Standard retention'}</div>
                    </div>
                  </div>
                )}

                {/* Data Leaves Org Warning */}
                {tier?.data_leaves_organization && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <div className="text-xs text-amber-800">
                      <span className="font-bold">Data leaves your organization.</span> Current config sends data to external services.
                      Set <code className="bg-amber-100 px-1 rounded">DEPLOYMENT_PRESET=enterprise_private</code> for VPC-only mode.
                    </div>
                  </div>
                )}
                {tier && !tier.data_leaves_organization && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <div className="text-xs text-emerald-800">
                      <span className="font-bold">All data stays within your network.</span> No external LLM, embedding, or training API calls.
                    </div>
                  </div>
                )}

                {/* Deployment Preset */}
                {gov?.deployment_preset && (
                  <div className="p-3 bg-white rounded-xl border">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Deployment Preset</div>
                    <div className="flex gap-2">
                      {Object.entries(gov.deployment_preset.available_presets || {}).map(([k, desc]) => (
                        <div key={k} className={`flex-1 p-2 rounded-lg border text-center ${preset === k ? 'border-2' : 'opacity-60'}`}
                             style={{ borderColor: presetColor[k] || '#94a3b8' }}>
                          <div className="text-xs font-bold" style={{ color: presetColor[k] }}>{k.replace(/_/g, ' ').toUpperCase()}</div>
                          <div className="text-[10px] text-slate-500 mt-1">{desc.split('—')[0]}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Data Egress Map */}
                {Object.keys(egress).length > 0 && (
                  <div className="p-3 bg-white rounded-xl border">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Data Egress Map</div>
                    <div className="space-y-1">
                      {Object.entries(egress).map(([mod, info]) => (
                        <div key={mod} className="flex items-center justify-between text-xs p-2 bg-slate-50 rounded-lg">
                          <span className="font-semibold text-slate-700 w-28">{mod.replace(/_/g, ' ')}</span>
                          <span className="text-slate-500 flex-1 truncate">{info.destination}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                                style={{ backgroundColor: riskColor(info.risk) + '20', color: riskColor(info.risk) }}>
                            {info.risk?.toUpperCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Audit Log */}
                <div className="p-3 bg-white rounded-xl border">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">LLM API Audit Log</div>
                    <button onClick={loadAuditLog} className="text-xs text-blue-600 hover:underline">Load Log</button>
                  </div>
                  {audit.total_calls > 0 && (
                    <div className="flex gap-4 mb-2 text-[10px]">
                      <span>Total: <b>{audit.total_calls}</b></span>
                      <span>Avg: <b>{audit.avg_latency_ms}ms</b></span>
                      <span>PII Redacted: <b>{audit.pii_redacted_pct}%</b></span>
                      <span>Success: <b>{audit.success_rate}%</b></span>
                    </div>
                  )}
                  {auditLog?.entries?.length > 0 && (
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {auditLog.entries.slice(0, 20).map((e, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px] p-1.5 bg-slate-50 rounded">
                          <span className="text-slate-400 w-16 truncate">{e.timestamp?.slice(11, 19)}</span>
                          <span className="font-semibold w-20 truncate">{e.module}</span>
                          <span className="text-slate-500 w-20 truncate">{e.model}</span>
                          <span className={`px-1 rounded ${e.data_type === 'document' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{e.data_type}</span>
                          <span className="text-slate-400">{e.latency_ms}ms</span>
                          {e.vendor && <span className="text-purple-600 truncate">{e.vendor}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Per-Vendor AI Controls (R9) */}
                <div className="p-3 bg-white rounded-xl border">
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Per-Vendor AI Controls</div>
                  <div className="flex gap-2 mb-2">
                    <input value={vendorInput} onChange={e => setVendorInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') loadVendorCtl(vendorInput); }}
                      placeholder="Enter vendor name..." className="inp text-xs flex-1" />
                    <button onClick={() => loadVendorCtl(vendorInput)} className="btn-o text-xs">Load</button>
                  </div>
                  {vendorCtl && (
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700 mb-1">{vendorCtl.vendor}</div>
                      {['extraction_enabled', 'intelligence_enabled', 'include_in_training'].map(field => (
                        <div key={field} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                          <span className="text-xs text-slate-600">{field.replace(/_/g, ' ')}</span>
                          <button onClick={() => toggleVendorCtl(vendorCtl.vendor, field)}
                            className={`text-[10px] font-bold px-3 py-1 rounded-lg ${vendorCtl.ai_controls?.[field] !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {vendorCtl.ai_controls?.[field] !== false ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

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
            duplicateWarning: r.duplicateWarning,
          });
        }
      } catch (err) { res.push({ name: file.name, ok: false, error: 'Upload failed: ' + (err.message || 'network error') }); }
    }
    setResults(res); setUploading(false); setProcStep(-1); await load();
    const ok = res.filter(r => r.ok).length;
    const dupes = res.filter(r => r.ok && r.duplicateWarning).length;
    if (ok) toast(`${ok} document${ok > 1 ? 's' : ''} extracted${dupes ? ` (${dupes} possible duplicate${dupes > 1 ? 's' : ''})` : ''}`, dupes ? 'warning' : 'success');
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
                {r.ok && r.duplicateWarning && <Badge c="err">⚠ DUPLICATE</Badge>}
                {r.ok && r.confidence != null && <span className="font-mono text-sm font-semibold text-emerald-700">{pct(r.confidence)}</span>}
              </div>
              {r.duplicateWarning && (
                <div className="text-xs text-red-600 mt-1 px-3 pb-2">{r.duplicateWarning}</div>
              )}
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
            {(doc.possibleDuplicate || doc._isDuplicate) && <Badge c="err">⚠ DUPLICATE</Badge>}
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

            {/* Learning Context (Rec #3) */}
            {doc.vendor && (() => {
              const vendorCorr = (s.anomalies || []).filter(a => a.vendor === doc.vendor && (a.status === 'resolved' || a.status === 'dismissed')).length;
              const vendorInvs = (s.docs || []).filter(d => d.vendor === doc.vendor && d.type === 'invoice').length;
              const avgConf = vendorInvs > 0 ? Math.round((s.docs || []).filter(d => d.vendor === doc.vendor && d.type === 'invoice').reduce((s, d) => s + (d.extractionConfidence || d.confidence || 0), 0) / vendorInvs) : 0;
              if (vendorInvs <= 1) return null;
              return (
                <div className="p-3 rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50/50 to-indigo-50/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Brain className="w-3.5 h-3.5 text-purple-600" />
                    <span className="text-[11px] font-bold text-purple-700 uppercase tracking-wider">Vendor Learning Context</span>
                  </div>
                  <div className="text-xs text-slate-600">
                    <strong>{vendorInvs}</strong> invoices processed from <strong>{doc.vendor}</strong>
                    {avgConf > 0 && <span> · Avg extraction accuracy: <strong className="text-purple-700">{avgConf}%</strong></span>}
                    {vendorCorr > 0 && <span> · <strong className="text-emerald-600">{vendorCorr}</strong> corrections applied to future extractions</span>}
                  </div>
                </div>
              );
            })()}

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
/* ═══════════════════════════════════════════════════
   LANDING PAGE — Editorial Fintech Design
   Dark hero → Pipeline → AI Proof → Differentiators → Deploy → CTA
   ═══════════════════════════════════════════════════ */
function LandingPage({ onGo, onFeatures }) {
  const { s } = useStore();
  const ps = s.ps || {};
  const rc = ps.rc || 17;
  const ver = ps.v || '';
  const totalRules = rc + 8;

  return (
    <div className="min-h-screen bg-white overflow-hidden">

      {/* ═══ NAV — Frosted glass ═══ */}
      <nav className="fixed top-0 inset-x-0 z-50" style={{ background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}>
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight">
              <div className="text-base font-bold tracking-tight text-slate-900">AuditLens</div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-[.2em] -mt-0.5">AP Intelligence</div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <button onClick={onFeatures} className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors">Features</button>
            <button onClick={onGo} className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors">Sign In</button>
            <button onClick={onGo} className="px-5 py-2 text-[13px] font-semibold text-white rounded-lg transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0f172a, #1e293b)' }}>Get Started →</button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO — Dark, editorial, with product visual ═══ */}
      <section className="relative pt-16" style={{ background: 'linear-gradient(180deg, #0a0f1e 0%, #111827 60%, #1e293b 100%)' }}>
        {/* Ambient orbs */}
        <div className="absolute top-20 left-1/4 w-[500px] h-[500px] rounded-full lp-glow" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)' }} />
        <div className="absolute top-40 right-1/4 w-[400px] h-[400px] rounded-full lp-glow" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)', animationDelay: '2s' }} />

        <div className="relative z-10 max-w-6xl mx-auto px-6 pt-20 pb-24">
          <div className="grid grid-cols-12 gap-8 items-center">
            {/* Left: Copy */}
            <div className="col-span-5">
              <div className="lp-reveal lp-reveal-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                <span className="text-[11px] font-semibold text-blue-300 tracking-wide">AI-POWERED AP AUDIT</span>
              </div>

              <h1 className="lp-reveal lp-reveal-2 lp-serif text-[46px] font-extrabold leading-[1.05] tracking-[-0.02em] text-white mb-5">
                Every invoice<br />audited.<br /><span className="lp-gradient-text">Before you pay.</span>
              </h1>

              <p className="lp-reveal lp-reveal-3 text-[15px] text-slate-400 leading-relaxed mb-8 max-w-md">
                AI extracts, matches, and flags anomalies across every line item — recovering 1–3% of spend that manual review misses.
              </p>

              <div className="lp-reveal lp-reveal-4 flex gap-3 mb-8">
                <button onClick={onGo} className="px-6 py-3 text-sm font-semibold text-slate-900 bg-white rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10">Upload Your First Invoice →</button>
                <button onClick={onFeatures} className="px-6 py-3 text-sm font-semibold text-slate-300 border border-slate-700 rounded-xl hover:border-slate-500 hover:text-white transition-all">See Features</button>
              </div>

              {/* Micro-stats */}
              <div className="lp-reveal lp-reveal-5 flex gap-6">
                {[
                  { val: '<8s', label: 'End-to-end' },
                  { val: `${totalRules}`, label: 'Audit rules' },
                  { val: '100%', label: 'Coverage' },
                ].map(s => (
                  <div key={s.label}>
                    <div className="lp-number text-xl font-bold text-white lp-mono">{s.val}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Product mockup */}
            <div className="col-span-7 lp-scale">
              <div className="relative lp-float" style={{ animationDuration: '8s' }}>
                {/* Dashboard mockup */}
                <div className="rounded-2xl overflow-hidden border border-slate-700/50 shadow-2xl shadow-black/40" style={{ background: 'linear-gradient(145deg, #1e293b, #0f172a)' }}>
                  {/* Title bar */}
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700/50">
                    <div className="flex gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500/70" /><div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" /><div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" /></div>
                    <div className="text-[10px] text-slate-500 ml-2 lp-mono">auditlens.app/dashboard</div>
                  </div>
                  {/* Simulated dashboard content */}
                  <div className="p-5 grid grid-cols-4 gap-3">
                    {[
                      { label: 'Invoices Processed', val: '2,847', delta: '+124 today', color: '#3b82f6' },
                      { label: 'Anomalies Flagged', val: '183', delta: '6.4% rate', color: '#f59e0b' },
                      { label: 'Spend Recovered', val: '$847K', delta: '2.1% of total', color: '#10b981' },
                      { label: 'Auto-Approved', val: '71%', delta: 'Straight-through', color: '#8b5cf6' },
                    ].map(m => (
                      <div key={m.label} className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">{m.label}</div>
                        <div className="text-lg font-bold text-white lp-mono">{m.val}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: m.color }}>{m.delta}</div>
                      </div>
                    ))}
                  </div>
                  {/* Simulated table rows */}
                  <div className="px-5 pb-4">
                    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                      {[
                        { inv: 'INV-2024-0847', vendor: 'Acme Logistics', amt: '$124,800', status: 'Flagged', sc: '#f59e0b', anomaly: 'Price overcharge +$4,200 vs contract' },
                        { inv: 'INV-2024-0848', vendor: 'Global Shipping Co', amt: '$67,350', status: 'Matched', sc: '#10b981', anomaly: '3-way match ✓' },
                        { inv: 'INV-2024-0849', vendor: 'TechServe Ltd', amt: '$215,000', status: 'Blocked', sc: '#ef4444', anomaly: 'Duplicate of INV-2024-0712' },
                      ].map((r, i) => (
                        <div key={r.inv} className="flex items-center justify-between px-3 py-2" style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] lp-mono text-slate-400">{r.inv}</span>
                            <span className="text-[11px] text-slate-300">{r.vendor}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-slate-400">{r.anomaly}</span>
                            <span className="text-[10px] lp-mono text-white">{r.amt}</span>
                            <span className="px-2 py-0.5 rounded text-[9px] font-bold" style={{ color: r.sc, background: `${r.sc}15` }}>{r.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Gradient fade to white */}
        <div className="h-24" style={{ background: 'linear-gradient(180deg, #1e293b, #ffffff)' }} />
      </section>

      {/* ═══ ENSEMBLE PIPELINE — The technical differentiator, visualized ═══ */}
      <section className="px-6 pb-20 -mt-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <div className="text-[11px] font-bold text-blue-500 uppercase tracking-[.15em] mb-2">How It Works</div>
            <h2 className="lp-serif text-3xl font-extrabold text-slate-900 tracking-tight">Two AI models. One source of truth.</h2>
            <p className="text-sm text-slate-500 mt-2 max-w-lg mx-auto">Every other AP tool runs one model and hopes it's right. AuditLens runs two, compares every field, and resolves disputes with your data.</p>
          </div>

          {/* Pipeline visualization */}
          <div className="relative rounded-2xl p-8 overflow-hidden" style={{ background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)', border: '1px solid #e2e8f0' }}>
            <div className="flex items-center justify-between gap-4">
              {/* Step 1: Document */}
              <div className="flex-shrink-0 text-center">
                <div className="w-16 h-20 rounded-xl mx-auto mb-2 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1e293b, #334155)' }}>
                  <FileText className="w-7 h-7 text-white" />
                </div>
                <div className="text-xs font-bold text-slate-700">Invoice PDF</div>
                <div className="text-[10px] text-slate-400">uploaded</div>
              </div>

              {/* Arrow */}
              <div className="flex-shrink-0"><ChevronRight className="w-5 h-5 text-slate-300" /></div>

              {/* Step 2: Parallel models */}
              <div className="flex-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl p-4 lp-card-lift" style={{ background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', border: '1px solid #c7d2fe' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-md bg-indigo-500 flex items-center justify-center"><Zap className="w-3 h-3 text-white" /></div>
                      <span className="text-xs font-bold text-indigo-800">Model A · Sonnet</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px]"><span className="text-indigo-400">vendor</span><span className="text-indigo-700 font-semibold lp-mono">Acme Corp</span></div>
                      <div className="flex justify-between text-[10px]"><span className="text-indigo-400">total</span><span className="text-indigo-700 font-semibold lp-mono">$124,800.00</span></div>
                      <div className="flex justify-between text-[10px]"><span className="text-indigo-400">tax</span><span className="text-indigo-700 font-semibold lp-mono">$11,232.00</span></div>
                    </div>
                  </div>
                  <div className="rounded-xl p-4 lp-card-lift" style={{ background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '1px solid #bbf7d0' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-md bg-emerald-500 flex items-center justify-center"><Zap className="w-3 h-3 text-white" /></div>
                      <span className="text-xs font-bold text-emerald-800">Model B · Haiku</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px]"><span className="text-emerald-400">vendor</span><span className="text-emerald-700 font-semibold lp-mono">Acme Corp</span></div>
                      <div className="flex justify-between text-[10px]"><span className="text-emerald-400">total</span><span className="text-emerald-700 font-semibold lp-mono">$124,800.00</span></div>
                      <div className="flex justify-between text-[10px]"><span className="text-emerald-400">tax</span><span className="font-semibold lp-mono text-amber-600">$11,322.00</span></div>
                    </div>
                  </div>
                </div>
                <div className="text-center mt-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold" style={{ background: 'rgba(245,158,11,0.1)', color: '#d97706', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <AlertTriangle className="w-3 h-3" /> Tax field disputed — $90 difference
                  </span>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex-shrink-0"><ChevronRight className="w-5 h-5 text-slate-300" /></div>

              {/* Step 3: Resolution */}
              <div className="flex-shrink-0 text-center">
                <div className="w-16 h-16 rounded-xl mx-auto mb-2 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 8px 24px -4px rgba(99,102,241,0.3)' }}>
                  <Brain className="w-7 h-7 text-white" />
                </div>
                <div className="text-xs font-bold text-slate-700">Agentic Resolver</div>
                <div className="text-[10px] text-slate-400">re-examines with<br/>vendor history</div>
              </div>

              {/* Arrow */}
              <div className="flex-shrink-0"><ChevronRight className="w-5 h-5 text-slate-300" /></div>

              {/* Step 4: Result */}
              <div className="flex-shrink-0">
                <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg, #0f172a, #1e293b)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider mb-2">✓ Verified Result</div>
                  <div className="space-y-1">
                    <div className="flex justify-between gap-4 text-[10px]"><span className="text-slate-500">total</span><span className="text-white font-semibold lp-mono">$124,800</span></div>
                    <div className="flex justify-between gap-4 text-[10px]"><span className="text-slate-500">tax</span><span className="text-emerald-400 font-semibold lp-mono">$11,232</span></div>
                    <div className="flex justify-between gap-4 text-[10px]"><span className="text-slate-500">confidence</span><span className="text-blue-400 font-bold lp-mono">98.7%</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ AI CAUGHT THIS — Real proof moment ═══ */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a, #1a2744)' }}>
            <div className="grid grid-cols-2">
              {/* Left: The story */}
              <div className="p-10">
                <div className="text-[11px] font-bold text-amber-400 uppercase tracking-[.15em] mb-4">AI Caught This</div>
                <h3 className="lp-serif text-2xl font-extrabold text-white leading-tight mb-4">
                  $47,200 overcharge<br />flagged in 3 seconds.
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed mb-6">
                  A logistics vendor submitted a $172,400 invoice. AuditLens extracted every line item, matched against the purchase order, and flagged a unit price increase of $8.40/unit across 5,619 items — a $47,200 variance from the contracted rate. The AI drafted the dispute letter with contract reference, PO number, and corrected amount.
                </p>
                <div className="flex gap-4">
                  <div>
                    <div className="text-2xl font-bold text-white lp-mono">$47.2K</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Overcharge caught</div>
                  </div>
                  <div className="w-px bg-slate-700" />
                  <div>
                    <div className="text-2xl font-bold text-white lp-mono">3.1s</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Detection time</div>
                  </div>
                  <div className="w-px bg-slate-700" />
                  <div>
                    <div className="text-2xl font-bold text-white lp-mono">Auto</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Dispute drafted</div>
                  </div>
                </div>
              </div>

              {/* Right: The evidence */}
              <div className="p-8 flex items-center" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="w-full space-y-3">
                  {/* Anomaly card */}
                  <div className="rounded-xl p-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-amber-300">PRICE_OVERCHARGE · High Severity</span>
                    </div>
                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex justify-between"><span className="text-slate-500">Invoice unit price</span><span className="text-red-400 lp-mono font-semibold">$22.40</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Contract rate</span><span className="text-emerald-400 lp-mono font-semibold">$14.00</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Qty affected</span><span className="text-white lp-mono">5,619 units</span></div>
                      <div className="flex justify-between pt-1 border-t border-slate-700"><span className="text-slate-400 font-semibold">Overpayment risk</span><span className="text-amber-400 lp-mono font-bold">$47,199.60</span></div>
                    </div>
                  </div>
                  {/* Match card */}
                  <div className="rounded-xl p-3" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.12)' }}>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-[11px] text-emerald-400">Matched to PO-2024-1847 · Contract CNT-0094</span>
                    </div>
                  </div>
                  {/* AI draft card */}
                  <div className="rounded-xl p-3" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.12)' }}>
                    <div className="flex items-center gap-2">
                      <Send className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-[11px] text-purple-300">AI drafted vendor dispute — ready to send</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ THREE PILLARS — Asymmetric differentiator layout ═══ */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="lp-serif text-3xl font-extrabold text-slate-900 tracking-tight">Built different.</h2>
            <p className="text-sm text-slate-500 mt-2">Three capabilities no other AP tool combines.</p>
          </div>

          <div className="grid grid-cols-12 gap-5">
            {/* Pillar 1: Ensemble AI — takes more space */}
            <div className="col-span-5 rounded-2xl p-7 lp-card-lift" style={{ background: 'linear-gradient(160deg, #eef2ff 0%, #e0e7ff 100%)', border: '1px solid #c7d2fe' }}>
              <div className="w-11 h-11 rounded-xl bg-indigo-500 flex items-center justify-center mb-5 shadow-lg shadow-indigo-200/60">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-lg font-extrabold text-slate-900 mb-2">Ensemble AI Extraction</h3>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Two frontier models cross-check every field. Consensus merging with field-level confidence. Agentic dispute resolution with vendor context.
              </p>
              <div className="text-xs font-bold text-indigo-600">↳ Higher accuracy than any single-model approach</div>
            </div>

            {/* Right column: two stacked */}
            <div className="col-span-7 flex flex-col gap-5">
              {/* Pillar 2: Deterministic Core */}
              <div className="flex-1 rounded-2xl p-7 lp-card-lift" style={{ background: 'linear-gradient(160deg, #fffbeb 0%, #fef3c7 100%)', border: '1px solid #fde68a' }}>
                <div className="flex gap-5">
                  <div className="w-11 h-11 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-200/60">
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-900 mb-1">Deterministic Audit Core</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {totalRules} rule-based checks run locally. No LLM dependency for compliance-critical decisions. Same result every time — auditor-grade consistency.
                    </p>
                    <div className="text-xs font-bold text-amber-600 mt-2">↳ 70% of capability requires zero AI calls</div>
                  </div>
                </div>
              </div>

              {/* Pillar 3: Data Privacy */}
              <div className="flex-1 rounded-2xl p-7 lp-card-lift" style={{ background: 'linear-gradient(160deg, #ecfdf5 0%, #d1fae5 100%)', border: '1px solid #a7f3d0' }}>
                <div className="flex gap-5">
                  <div className="w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-200/60">
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-900 mb-1">Your Data, Your Cloud</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      AI runs inside your VPC via AWS Bedrock or Google Vertex. PII redaction, LLM audit logs, per-vendor controls. Or go fully air-gapped.
                    </p>
                    <div className="text-xs font-bold text-emerald-600 mt-2">↳ Zero data leaves your network</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ DEPLOY MODES — Refined, no emojis ═══ */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl p-8" style={{ background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)', border: '1px solid #e2e8f0' }}>
            <div className="text-center mb-8">
              <h2 className="lp-serif text-2xl font-extrabold text-slate-900">Deploys how you need it</h2>
              <p className="text-sm text-slate-500 mt-1">Same product. Three privacy levels. One config change.</p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[
                { name: 'Standard', desc: 'Managed API', for: 'Demo & SMBs', icon: <Zap className="w-4 h-4" />, color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' },
                { name: 'Enterprise VPC', desc: 'Bedrock / Vertex AI', for: 'SOX-regulated F&A', icon: <Building2 className="w-4 h-4" />, color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', recommended: true },
                { name: 'Air-Gapped', desc: 'Self-hosted vLLM', for: 'Defense / Gov / Banking', icon: <Shield className="w-4 h-4" />, color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
              ].map(m => (
                <div key={m.name} className="rounded-xl p-5 text-center lp-card-lift relative" style={{ background: m.bg, border: `1.5px solid ${m.border}` }}>
                  {m.recommended && <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[9px] font-bold text-white" style={{ background: m.color }}>RECOMMENDED</div>}
                  <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: m.color, color: 'white' }}>{m.icon}</div>
                  <div className="text-sm font-bold text-slate-900">{m.name}</div>
                  <div className="text-xs text-slate-500 mt-1">{m.desc}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{m.for}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 text-center">
              <code className="lp-mono text-xs px-4 py-2 rounded-lg inline-block" style={{ background: '#0f172a', color: '#94a3b8' }}>
                <span style={{ color: '#34d399' }}>DEPLOYMENT_PRESET</span><span style={{ color: '#475569' }}>=</span><span style={{ color: '#fbbf24' }}>enterprise_private</span>
              </code>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ TRUST — Compact horizontal ═══ */}
      <section className="px-6 pb-20">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-3 flex-wrap">
          {['SOX 404', 'SOC 2', 'GDPR', 'RBAC', 'ZDR', 'Audit Trail', `${totalRules} Rules`, 'PII Redaction'].map(b => (
            <span key={b} className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 text-[11px] font-semibold text-slate-500">{b}</span>
          ))}
          <button onClick={onFeatures} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition-all">
            View all →
          </button>
        </div>
      </section>

      {/* ═══ CTA — Dark premium ═══ */}
      <section className="px-6 pb-20">
        <div className="max-w-4xl mx-auto relative overflow-hidden rounded-2xl" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1a2744 100%)' }}>
          {/* Ambient gradient */}
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)' }} />
          <div className="relative z-10 p-12 text-center">
            <h2 className="lp-serif text-3xl font-extrabold text-white tracking-tight mb-3">See what your AP team is missing.</h2>
            <p className="text-sm text-slate-400 mb-8 max-w-md mx-auto">Upload your first invoice — extracted, matched, and audited in under 8 seconds. No credit card required.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={onGo} className="px-8 py-3.5 text-sm font-semibold text-slate-900 bg-white rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10">Start Auditing →</button>
              <button onClick={onFeatures} className="px-8 py-3.5 text-sm font-semibold text-slate-300 border border-slate-600 rounded-xl hover:border-slate-400 hover:text-white transition-all">Full Feature Specs</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-8 px-6" style={{ borderTop: '1px solid #f1f5f9' }}>
        <div className="max-w-6xl mx-auto flex justify-between items-center text-[11px] text-slate-400">
          <span>© 2026 AuditLens{ver ? ` · v${ver}` : ''}</span>
          <span className="lp-mono">Enterprise AP Audit · SOX-Ready · VPC-Isolated AI</span>
        </div>
      </footer>
    </div>
  );
}

function FeaturesPage({ onBack, onGo }) {
  const { s } = useStore();
  const ps = s.ps || {};
  const rc = ps.rc || 17;
  const totalRules = rc + 8;
  const ver = ps.v || '';
  const [section, setSection] = useState('ap');

  const ruleNames = (ps.rules || []).map(r => r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace('Po', 'PO').replace('Grn', 'GRN').replace('Qty', 'QTY'));
  const oppNames = (ps.opp || []).map(r => r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

  const sections = [
    { id: 'ap', label: 'For AP Teams' },
    { id: 'ai', label: 'AI Intelligence' },
    { id: 'security', label: 'IT & Security' },
    { id: 'compliance', label: 'Compliance' },
    { id: 'integrations', label: 'Integrations' },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50" style={{ background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors">
              ← Back
            </button>
            <div className="h-5 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center"><Shield className="w-3.5 h-3.5 text-white" /></div>
              <span className="text-base font-bold text-slate-900">AuditLens Features</span>
            </div>
          </div>
          <button onClick={onGo} className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-500 rounded-lg hover:opacity-90 transition-all">Get Started →</button>
        </div>
      </nav>

      <div className="pt-20 pb-8 px-6">
        <div className="max-w-5xl mx-auto">

          {/* Section tabs */}
          <div className="flex gap-1 mb-8 bg-slate-100 rounded-xl p-1 w-fit">
            {sections.map(sec => (
              <button key={sec.id} onClick={() => setSection(sec.id)}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition ${section === sec.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {sec.label}
              </button>
            ))}
          </div>

          {/* ═══ FOR AP TEAMS ═══ */}
          {section === 'ap' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900 mb-1 lp-serif">AP Operations Features</h2>
                <p className="text-sm text-slate-500">Everything your AP team needs from upload to resolution.</p>
              </div>

              {/* Extraction Pipeline */}
              <FeatureBlock icon={<Zap className="w-5 h-5 text-indigo-600" />} title="Ensemble Extraction Engine" tag="AI">
                <p>Two frontier AI models (Sonnet + Haiku) extract every field in parallel — vendor name, invoice number, line items, tax details, payment terms, and more. A consensus engine merges results with field-level confidence scoring. When critical fields disagree, a third agentic model re-examines the document with vendor history, correction patterns, and PO context to break the tie.</p>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <MiniStat label="Extraction time" value="3–6 sec" />
                  <MiniStat label="Fields extracted" value="25+" />
                  <MiniStat label="Supported formats" value="PDF, PNG, JPEG" />
                </div>
              </FeatureBlock>

              {/* Anomaly Detection */}
              <FeatureBlock icon={<AlertTriangle className="w-5 h-5 text-amber-600" />} title="Rule-Based Anomaly Detection" tag="DETERMINISTIC">
                <p>{rc} anomaly rules run locally with zero LLM dependency. Every invoice is checked for duplicates, price overcharges, quantity mismatches, missing POs, tax anomalies, stale invoices, weekend submissions, and more.</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(ruleNames.length > 0 ? ruleNames : ['Duplicate Invoice', 'Price Overcharge', 'Missing PO', 'Quantity Mismatch', 'Amount Discrepancy', 'Tax Rate Anomaly', 'Stale Invoice', 'Weekend Invoice', 'Round Number', 'Terms Violation', 'Currency Mismatch', 'Unauthorized Item', 'Line Item Mismatch', 'Unreceipted Invoice', 'Overbilled vs Received', 'Qty Received Mismatch', 'Short Shipment']).map(r => (
                    <span key={r} className="px-2 py-0.5 text-[11px] rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">{r}</span>
                  ))}
                </div>
              </FeatureBlock>

              {/* Matching */}
              <FeatureBlock icon={<Link2 className="w-5 h-5 text-emerald-600" />} title="3-Way Smart Matching" tag="AI + ALGO">
                <p>Automatically matches invoices to purchase orders and goods receipts using multi-signal scoring: amount tolerance, vendor name fuzzy matching, date proximity, line-item cross-reference, and PO number extraction. AI-powered fuzzy resolution handles partial matches and format inconsistencies.</p>
              </FeatureBlock>

              {/* Triage */}
              <FeatureBlock icon={<ClipboardList className="w-5 h-5 text-blue-600" />} title="Intelligent Triage" tag="RULES">
                <p>Invoices are automatically classified into three lanes — Auto-Approve (clean, matched, within tolerance), Review (anomalies detected but recoverable), and Blocked (critical issues requiring investigation). Classification is deterministic and fully auditable.</p>
              </FeatureBlock>

              {/* Case Management */}
              <FeatureBlock icon={<FileText className="w-5 h-5 text-purple-600" />} title="Case Management & Workflows" tag="CORE">
                <p>Blocked and review invoices generate investigation cases with severity scoring, SLA tracking, and assignment recommendations. Cases flow through configurable workflows with escalation rules, delegation of authority, and complete audit trails.</p>
              </FeatureBlock>
            </div>
          )}

          {/* ═══ AI INTELLIGENCE ═══ */}
          {section === 'ai' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900 mb-1 lp-serif">AI Intelligence Layer</h2>
                <p className="text-sm text-slate-500">AI augments every decision — grounded in your data, never hallucinated.</p>
              </div>

              <FeatureBlock icon={<Brain className="w-5 h-5 text-indigo-600" />} title="AI Investigation Briefs" tag="AI">
                <p>One-click AI-generated investigation summaries for flagged cases. Grounded in actual invoice data, anomaly context, vendor history, and contract terms — with fact verification to prevent hallucination. Falls back to deterministic analysis when AI is unavailable.</p>
              </FeatureBlock>

              <FeatureBlock icon={<AlertCircle className="w-5 h-5 text-amber-600" />} title="Anomaly Explanations" tag="AI">
                <p>AI explains each flagged anomaly in plain language — what was expected, what was found, and why it matters. Analysts understand the issue immediately instead of interpreting raw rule outputs.</p>
              </FeatureBlock>

              <FeatureBlock icon={<Send className="w-5 h-5 text-purple-600" />} title="Vendor Communication Drafts" tag="AI">
                <p>AI-drafted dispute letters, information requests, debit note justifications, and payment delay notices — pre-populated with invoice details, anomaly evidence, contract references, and correct amounts.</p>
              </FeatureBlock>

              <FeatureBlock icon={<TrendingUp className="w-5 h-5 text-emerald-600" />} title="Vendor Behavior Analytics" tag="AI">
                <p>AI-synthesized vendor insights: spending trends, anomaly patterns, risk trajectory, and procurement recommendations. Backed by 9-factor risk scoring with monthly trend analysis.</p>
              </FeatureBlock>

              <FeatureBlock icon={<Shield className="w-5 h-5 text-blue-600" />} title="Contract Intelligence" tag="AI + RULES">
                <p>Price drift detection, expiry risk alerts, over-utilization warnings, underbilling audit, volume commitment tracking, and currency validation — combining contract clause analysis with real-time invoice data.</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {['Price Drift', 'Expiry Risk', 'Over-Utilization', 'Underbilling', 'Volume Commitment', 'Currency Validation', 'Chronic Short Shipment', 'Stale PO Fulfillment'].map(r => (
                    <span key={r} className="px-2 py-0.5 text-[11px] rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">{r}</span>
                  ))}
                </div>
              </FeatureBlock>

              <FeatureBlock icon={<Brain className="w-5 h-5 text-rose-600" />} title="Continuous Learning (LoRA Fine-Tuning)" tag="AI">
                <p>AuditLens learns from analyst corrections. When an analyst corrects an extraction error, the correction is stored and used to fine-tune a custom model via LoRA — improving accuracy for that vendor's specific invoice formats over time.</p>
              </FeatureBlock>

              {/* Grounded AI guarantee */}
              <div className="rounded-2xl bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 p-6">
                <h3 className="text-sm font-bold text-indigo-800 mb-2">Grounded AI Guarantee</h3>
                <p className="text-sm text-indigo-600">Every AI-generated insight cites specific invoice fields, anomaly rules, or vendor statistics. AI never invents data. If the model can't ground a claim in actual numbers, the claim is not made. Deterministic fallbacks exist for every AI feature — if the LLM is unavailable, you get rule-based analysis, not a blank screen.</p>
              </div>
            </div>
          )}

          {/* ═══ IT & SECURITY ═══ */}
          {section === 'security' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900 mb-1 lp-serif">Data Privacy & AI Governance</h2>
                <p className="text-sm text-slate-500">Enterprise-grade data controls. Provable data residency. Full audit trail.</p>
              </div>

              {/* Deployment Modes */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { icon: '🚀', name: 'Standard', target: 'Demo & SMBs', provider: 'Anthropic Cloud', embed: 'Voyage API', train: 'Together.ai',
                    data: true, details: 'Fastest setup. Managed API with optional ZDR.', envs: 'LLM_PROVIDER=anthropic', color: 'border-blue-200 bg-blue-50/30' },
                  { icon: '🏢', name: 'Enterprise VPC', target: 'SOX-regulated F&A', provider: 'AWS Bedrock / Vertex AI', embed: 'Local', train: 'Local PEFT/LoRA',
                    data: false, details: 'Same models, your cloud account. Data never leaves VPC.', envs: 'LLM_PROVIDER=bedrock', color: 'border-emerald-300 bg-emerald-50/30' },
                  { icon: '🔒', name: 'Air-Gapped', target: 'Defense / Gov / Banking', provider: 'Self-hosted vLLM / Ollama', embed: 'Local TF-IDF', train: 'Local',
                    data: false, details: 'Zero external network calls. Fully on-premise.', envs: 'LLM_PROVIDER=openai LLM_ENDPOINT=http://localhost:8000', color: 'border-purple-300 bg-purple-50/30' },
                ].map(m => (
                  <div key={m.name} className={`rounded-2xl border-2 ${m.color} p-6`}>
                    <div className="text-2xl mb-2">{m.icon}</div>
                    <div className="text-base font-bold text-slate-900 mb-1">{m.name}</div>
                    <div className="text-xs text-slate-400 mb-3">{m.target}</div>
                    <div className="space-y-2 text-xs mb-4">
                      <div className="flex justify-between"><span className="text-slate-400">LLM</span><span className="text-slate-700 font-medium">{m.provider}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Embeddings</span><span className="text-slate-700 font-medium">{m.embed}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Fine-tuning</span><span className="text-slate-700 font-medium">{m.train}</span></div>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">{m.details}</p>
                    <code className="text-[10px] bg-slate-100 px-2 py-1 rounded text-slate-600 font-mono">{m.envs}</code>
                    <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${m.data ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                      <span className={`text-[11px] font-semibold ${m.data ? 'text-amber-700' : 'text-emerald-700'}`}>{m.data ? 'External egress' : 'All data stays in-network'}</span>
                    </div>
                  </div>
                ))}
              </div>

              <FeatureBlock icon={<Shield className="w-5 h-5 text-emerald-600" />} title="PII Redaction" tag="PRIVACY">
                <p>Pre-LLM redaction layer detects and masks bank account numbers, routing numbers, SWIFT/IBAN codes, tax IDs (EIN, PAN, GSTIN, VAT), SSNs, credit cards (Luhn-validated), email addresses, and phone numbers. Redaction is reversible — tokens are replaced with placeholders and restored in the output.</p>
              </FeatureBlock>

              <FeatureBlock icon={<Activity className="w-5 h-5 text-blue-600" />} title="LLM Call Audit Log" tag="SOX">
                <p>Every external LLM call logged with: timestamp, provider, model, module, data type (text/document), vendor name, response latency, PII redaction status, ZDR status, and success/failure. Accessible via API and the Data Governance dashboard.</p>
              </FeatureBlock>

              <FeatureBlock icon={<Settings className="w-5 h-5 text-purple-600" />} title="Per-Vendor AI Controls" tag="GOVERNANCE">
                <p>Per-vendor toggles: enable/disable AI extraction (manual entry only), AI intelligence features (briefs, explanations, drafts), and fine-tuning data inclusion. Strategic suppliers can be excluded from all LLM processing.</p>
              </FeatureBlock>

              <FeatureBlock icon={<CheckCircle2 className="w-5 h-5 text-slate-600" />} title="Zero Data Retention" tag="PRIVACY">
                <p>ZDR header on all Anthropic API calls. Bedrock and Vertex AI have inherent ZDR — data is never stored by the model provider. Self-hosted mode: zero external network calls.</p>
              </FeatureBlock>

              {/* Deterministic core callout */}
              <div className="rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 p-6">
                <h3 className="text-sm font-bold text-emerald-800 mb-2">70% of AuditLens Requires Zero LLM Calls</h3>
                <p className="text-sm text-emerald-600">Anomaly detection ({rc} rules), PO matching (multi-signal scoring), 3-way reconciliation, and triage classification are entirely deterministic and local. Even in a complete LLM outage, your core audit capability continues uninterrupted.</p>
              </div>
            </div>
          )}

          {/* ═══ COMPLIANCE ═══ */}
          {section === 'compliance' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900 mb-1 lp-serif">Compliance & Controls</h2>
                <p className="text-sm text-slate-500">Built for regulated environments.</p>
              </div>

              <div className="grid grid-cols-2 gap-5">
                {[
                  { badge: 'SOX Section 404', items: ['Segregation of duties via 4-tier RBAC', 'Configurable approval authority by role, amount, and currency', 'Complete audit trail — who, what, when, and why', 'Deterministic anomaly detection (no AI dependency for compliance)'] },
                  { badge: 'SOC 2 Type II', items: ['JWT authentication with token expiration', 'Role-based access control (Analyst → Manager → Director → Admin)', 'All API endpoints authenticated', 'Activity logging for every action'] },
                  { badge: 'GDPR / DPDP', items: ['Configurable data residency (EU Bedrock/Vertex regions)', 'PII detection and redaction before LLM calls', 'Zero Data Retention mode', 'Per-vendor data processing controls'] },
                  { badge: 'Data Governance', items: ['Live data egress map showing all external calls', 'LLM audit log with provider, latency, PII status', 'Deployment preset system (Standard / Enterprise / Air-Gapped)', 'Data Processing Agreement (DPA) template included'] },
                ].map(c => (
                  <div key={c.badge} className="rounded-2xl bg-white border border-slate-200 p-6">
                    <span className="inline-block px-3 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold border border-blue-100 mb-3">{c.badge}</span>
                    <ul className="space-y-2">
                      {c.items.map(item => (
                        <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Authority Matrix */}
              <FeatureBlock icon={<Users className="w-5 h-5 text-indigo-600" />} title="Delegation of Authority Matrix" tag="SOX">
                <p>Four-tier approval hierarchy with configurable limits per role and currency. AP Analysts, Managers, Procurement, and Controllers each have defined authority thresholds. Invoices above threshold automatically escalate. All authority decisions logged.</p>
              </FeatureBlock>

              <FeatureBlock icon={<Activity className="w-5 h-5 text-slate-600" />} title="SLA Tracking & Escalation" tag="OPS">
                <p>Configurable SLA targets per triage lane with real-time aging tracking. Cases approaching breach automatically escalate. Dashboard shows SLA compliance rates across the AP operation.</p>
              </FeatureBlock>
            </div>
          )}

          {/* ═══ INTEGRATIONS ═══ */}
          {section === 'integrations' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900 mb-1 lp-serif">Integrations & Deployment</h2>
                <p className="text-sm text-slate-500">Fits your existing AP stack.</p>
              </div>

              <FeatureBlock icon={<Database className="w-5 h-5 text-blue-600" />} title="ERP Connectivity" tag="INTEGRATION">
                <p>REST API + file-based integration with no ERP modifications required. Supports batch and real-time modes.</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {['SAP S/4HANA', 'Oracle EBS', 'NetSuite', 'Microsoft Dynamics', 'QuickBooks', 'Sage', 'Workday', 'Xero'].map(e => (
                    <span key={e} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 shadow-sm">{e}</span>
                  ))}
                </div>
              </FeatureBlock>

              <FeatureBlock icon={<FileText className="w-5 h-5 text-emerald-600" />} title="Document Support" tag="CORE">
                <p>PDF and image (PNG, JPEG) invoice extraction. Multi-page document support. Handles Indian number formatting (lakhs/crores), multiple currencies, and multi-language invoices ({ps.lc || 10}+ locales).</p>
              </FeatureBlock>

              <FeatureBlock icon={<Zap className="w-5 h-5 text-purple-600" />} title="API-First Architecture" tag="TECHNICAL">
                <p>Full REST API for every operation — upload, extract, match, flag, resolve. Webhook support for real-time event notifications. Batch import for historical data migration. Export capability for reporting and compliance.</p>
              </FeatureBlock>

              <FeatureBlock icon={<UploadCloud className="w-5 h-5 text-amber-600" />} title="Deployment Options" tag="DEPLOY">
                <p>Docker containerized. Deploy on Railway, Render, AWS, GCP, Azure, or any container platform. Single Dockerfile, environment variable configuration. No complex infrastructure requirements.</p>
              </FeatureBlock>
            </div>
          )}
        </div>
      </div>

      {/* Footer CTA */}
      <div className="px-6 pb-10">
        <div className="max-w-5xl mx-auto rounded-2xl p-8 text-center text-white" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
          <h2 className="text-2xl font-extrabold tracking-tight mb-2">Ready to see it on your invoices?</h2>
          <p className="text-sm text-slate-400 mb-5">Full product. No credit card. Upload and audit in under a minute.</p>
          <button onClick={onGo} className="px-8 py-3 text-sm font-semibold text-slate-900 bg-white rounded-xl hover:bg-slate-50 transition-all shadow-lg">Get Started →</button>
        </div>
      </div>

      <footer className="py-6 px-6 border-t border-slate-100">
        <div className="max-w-6xl mx-auto flex justify-between items-center text-[11px] text-slate-400">
          <span>© 2026 AuditLens{ver ? ` · v${ver}` : ''}</span>
          <span>Enterprise AP Audit · SOX-Ready · VPC-Isolated AI</span>
        </div>
      </footer>
    </div>
  );
}

/* Feature block helper */
function FeatureBlock({ icon, title, tag, children }) {
  return (
    <div className="rounded-2xl bg-white p-6 lp-card-lift" style={{ border: '1px solid #e2e8f0' }}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>{icon}</div>
        <div className="flex items-center gap-3">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <span className="px-2 py-0.5 text-[10px] font-bold rounded lp-mono" style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' }}>{tag}</span>
        </div>
      </div>
      <div className="text-sm text-slate-600 leading-relaxed space-y-2 ml-[52px]">{children}</div>
    </div>
  );
}

/* Mini stat helper */
function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
      <div className="text-lg font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
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
   R7: DATA GOVERNANCE DASHBOARD
   Privacy posture, egress map, audit log, vendor controls, deployment presets
   ═══════════════════════════════════════════════════ */
function DataGovernancePage() {
  const [governance, setGovernance] = useState(null);
  const [auditLog, setAuditLog] = useState(null);
  const [vendorControls, setVendorControls] = useState({});
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api('/api/data-governance').then(r => setGovernance(r)).catch(() => {}),
      api('/api/data-governance/audit-log?limit=50').then(r => setAuditLog(r)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const loadVendorControls = async (vendor) => {
    try {
      const r = await api(`/api/data-governance/vendor-controls/${encodeURIComponent(vendor)}`);
      setVendorControls(prev => ({ ...prev, [vendor]: r.ai_controls }));
    } catch (e) { console.error(e); }
  };

  const updateVendorControl = async (vendor, field, value) => {
    const current = vendorControls[vendor] || {};
    const updated = { ...current, [field]: value };
    try {
      await api(`/api/data-governance/vendor-controls/${encodeURIComponent(vendor)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      setVendorControls(prev => ({ ...prev, [vendor]: updated }));
    } catch (e) { console.error(e); }
  };

  if (loading) return <div className="text-center py-12 text-slate-400">Loading governance data...</div>;

  const pp = governance?.privacy_posture || {};
  const provider = pp.llm_provider || {};
  const preset = governance?.deployment_preset || {};
  const egress = governance?.egress_map || {};
  const audit = governance?.audit_summary || {};

  const riskColor = (r) => r === 'none' ? '#059669' : r === 'low' ? '#0ea5e9' : r === 'medium' ? '#d97706' : '#dc2626';
  const riskBg = (r) => r === 'none' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    r === 'low' ? 'bg-sky-50 text-sky-700 border-sky-200' :
    r === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
    'bg-red-50 text-red-700 border-red-200';

  const tabs = [
    { id: 'overview', label: 'Privacy Posture' },
    { id: 'egress', label: 'Data Egress Map' },
    { id: 'audit', label: 'LLM Audit Log' },
    { id: 'vendors', label: 'Vendor Controls' },
    { id: 'presets', label: 'Deployment Presets' },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Shield className="w-6 h-6 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">Data Governance</h1>
        {!pp.data_leaves_organization
          ? <span className="ml-3 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">✓ All Data Stays In-Network</span>
          : <span className="ml-3 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">⚠ External Data Egress Active</span>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${tab === t.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Provider Status Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border p-5">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">LLM Provider</div>
              <div className="text-lg font-bold text-slate-900">{(provider.provider || 'unknown').toUpperCase()}</div>
              <div className="text-sm text-slate-500 mt-1">{provider.data_residency || '—'}</div>
              <span className={`mt-2 inline-block px-2 py-0.5 text-xs rounded border ${provider.privacy_tier === 'vpc' || provider.privacy_tier === 'on_prem' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                {provider.privacy_label || '—'}
              </span>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Embeddings</div>
              <div className="text-lg font-bold text-slate-900">{(pp.embedding_provider || 'voyage').toUpperCase()}</div>
              <div className="text-sm text-slate-500 mt-1">{pp.embedding_provider === 'local' || pp.embedding_provider === 'sentence_transformers' ? 'Local — no external calls' : 'Voyage API (external)'}</div>
              <span className={`mt-2 inline-block px-2 py-0.5 text-xs rounded border ${pp.embedding_provider !== 'voyage' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                {pp.embedding_provider !== 'voyage' ? '✓ Private' : '⚠ Cloud'}
              </span>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Fine-Tuning</div>
              <div className="text-lg font-bold text-slate-900">{(pp.finetune_provider || 'together').toUpperCase()}</div>
              <div className="text-sm text-slate-500 mt-1">{pp.finetune_provider === 'local' ? 'Local — training data stays on-prem' : 'Together.ai (external)'}</div>
              <span className={`mt-2 inline-block px-2 py-0.5 text-xs rounded border ${pp.finetune_provider === 'local' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                {pp.finetune_provider === 'local' ? '✓ Private' : '✗ External'}
              </span>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">PII Redaction</div>
              <div className="text-lg font-bold text-slate-900">{pp.pii_redaction_enabled ? 'ENABLED' : 'DISABLED'}</div>
              <div className="text-sm text-slate-500 mt-1">{pp.pii_redaction_enabled ? 'SSN, bank accts, tax IDs masked' : 'Raw data sent to LLM'}</div>
              <span className={`mt-2 inline-block px-2 py-0.5 text-xs rounded border ${pp.pii_redaction_enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                {pp.pii_redaction_enabled ? '✓ Active' : '⚠ Inactive'}
              </span>
            </div>
          </div>

          {/* ZDR + Audit Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold text-slate-700 mb-3">Zero Data Retention (ZDR)</h3>
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${pp.zero_data_retention ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="text-sm">{pp.zero_data_retention ? 'Active — Anthropic does not retain prompt/completion data' : 'Inactive — standard API data handling'}</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">Set LLM_ZERO_DATA_RETENTION=true to enable. Only applies to Anthropic direct API — Bedrock/Vertex have inherent ZDR.</p>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold text-slate-700 mb-3">LLM Call Audit Summary</h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><div className="text-2xl font-bold text-indigo-600">{audit.total_calls || 0}</div><div className="text-xs text-slate-400">Total Calls</div></div>
                <div><div className="text-2xl font-bold text-emerald-600">{audit.success_rate || 100}%</div><div className="text-xs text-slate-400">Success Rate</div></div>
                <div><div className="text-2xl font-bold text-purple-600">{audit.pii_redacted_pct || 0}%</div><div className="text-xs text-slate-400">PII Redacted</div></div>
              </div>
            </div>
          </div>

          {/* Deterministic Core Banner */}
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 p-5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <h3 className="font-semibold text-emerald-800">Deterministic Core — No LLM Required</h3>
            </div>
            <p className="text-sm text-emerald-700">
              Anomaly detection (19 rules), PO matching (multi-signal scoring), and triage (agentic classification)
              are entirely local and deterministic. 70% of AuditLens capability requires zero LLM calls.
            </p>
          </div>
        </div>
      )}

      {/* ── EGRESS MAP ── */}
      {tab === 'egress' && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3 font-medium text-slate-500">Module</th>
                <th className="text-left p-3 font-medium text-slate-500">Data Sent</th>
                <th className="text-left p-3 font-medium text-slate-500">Destination</th>
                <th className="text-left p-3 font-medium text-slate-500">Provider Layer</th>
                <th className="text-left p-3 font-medium text-slate-500">Risk</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(egress).map(([mod, info]) => (
                <tr key={mod} className="border-t hover:bg-slate-25">
                  <td className="p-3 font-medium text-slate-900 capitalize">{mod.replace(/_/g, ' ')}</td>
                  <td className="p-3 text-slate-600 max-w-xs">{info.data_type}</td>
                  <td className="p-3 text-slate-600">{info.destination}</td>
                  <td className="p-3">{info.uses_provider_layer ? <span className="text-emerald-600 font-medium">✓ Yes</span> : <span className="text-slate-400">N/A</span>}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-medium border ${riskBg(info.risk)}`}>{info.risk.toUpperCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── AUDIT LOG ── */}
      {tab === 'audit' && (
        <div>
          {/* Summary bar */}
          {auditLog?.summary && (
            <div className="grid grid-cols-5 gap-3 mb-4">
              {Object.entries(auditLog.summary.by_module || {}).map(([mod, count]) => (
                <div key={mod} className="bg-white rounded-lg border p-3 text-center">
                  <div className="text-lg font-bold text-indigo-600">{count}</div>
                  <div className="text-xs text-slate-400 capitalize">{mod.replace(/_/g, ' ')}</div>
                </div>
              ))}
            </div>
          )}
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left p-3 font-medium text-slate-500">Timestamp</th>
                  <th className="text-left p-3 font-medium text-slate-500">Module</th>
                  <th className="text-left p-3 font-medium text-slate-500">Model</th>
                  <th className="text-left p-3 font-medium text-slate-500">Type</th>
                  <th className="text-left p-3 font-medium text-slate-500">Provider</th>
                  <th className="text-left p-3 font-medium text-slate-500">Latency</th>
                  <th className="text-left p-3 font-medium text-slate-500">PII</th>
                  <th className="text-left p-3 font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {(auditLog?.entries || []).length === 0 ? (
                  <tr><td colSpan={8} className="p-8 text-center text-slate-400">No LLM calls recorded yet. Upload a document or trigger an AI feature to see audit entries.</td></tr>
                ) : (auditLog?.entries || []).map((e, i) => (
                  <tr key={i} className="border-t hover:bg-slate-25">
                    <td className="p-3 text-xs text-slate-500 font-mono">{e.timestamp?.replace('T', ' ').replace('Z', '').slice(0, 19)}</td>
                    <td className="p-3 font-medium text-slate-700 capitalize">{e.module?.replace(/_/g, ' ')}</td>
                    <td className="p-3 text-xs text-slate-600 font-mono">{e.model?.split('-').slice(1, 2).join('') || e.model}</td>
                    <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs ${e.data_type === 'document' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'}`}>{e.data_type}</span></td>
                    <td className="p-3 text-xs text-slate-600">{e.provider}</td>
                    <td className="p-3 text-xs text-slate-600">{e.latency_ms}ms</td>
                    <td className="p-3">{e.pii_redacted ? <span className="text-emerald-600 text-xs font-medium">✓</span> : <span className="text-slate-300 text-xs">—</span>}</td>
                    <td className="p-3">{e.success ? <span className="text-emerald-600 text-xs">✓</span> : <span className="text-red-600 text-xs">✗ {e.error?.slice(0, 30)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── VENDOR CONTROLS ── */}
      {tab === 'vendors' && <VendorAIControls loadVendorControls={loadVendorControls} vendorControls={vendorControls} updateVendorControl={updateVendorControl} />}

      {/* ── DEPLOYMENT PRESETS ── */}
      {tab === 'presets' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 mb-4">Deployment presets configure all privacy-related settings at once. Set via <code className="bg-slate-100 px-1 rounded text-xs">DEPLOYMENT_PRESET</code> environment variable.</p>
          <div className="grid grid-cols-3 gap-4">
            {[
              { key: 'standard', name: 'Standard', desc: 'Anthropic Cloud + Voyage + Together.ai', icon: '🚀', suited: 'Demo, non-regulated SMBs', color: 'blue' },
              { key: 'enterprise_private', name: 'Enterprise Private Cloud', desc: 'Bedrock/Vertex + local embeddings + no Together.ai', icon: '🏢', suited: 'SOX-regulated, enterprise F&A', color: 'emerald' },
              { key: 'airgapped', name: 'Air-Gapped / Sovereign', desc: 'Self-hosted vLLM/Ollama + local TF-IDF + local fine-tuning', icon: '🔒', suited: 'Defense, government, banking', color: 'purple' },
            ].map(p => {
              const isCurrent = preset.current_preset === p.key;
              return (
                <div key={p.key} className={`rounded-xl border-2 p-6 ${isCurrent ? `border-${p.color}-500 bg-${p.color}-50/30` : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-2xl">{p.icon}</span>
                    {isCurrent && <span className="px-2 py-0.5 text-xs font-semibold bg-indigo-100 text-indigo-700 rounded-full">ACTIVE</span>}
                  </div>
                  <h3 className="font-bold text-slate-900 mb-1">{p.name}</h3>
                  <p className="text-sm text-slate-500 mb-3">{p.desc}</p>
                  <p className="text-xs text-slate-400">Best for: {p.suited}</p>
                  <div className="mt-3 pt-3 border-t text-xs text-slate-400 space-y-1">
                    <div>Data leaves org: {p.key === 'standard' ? <span className="text-amber-600 font-medium">Yes</span> : <span className="text-emerald-600 font-medium">No</span>}</div>
                    <div>PII redaction: {p.key !== 'standard' ? <span className="text-emerald-600 font-medium">Enabled</span> : <span className="text-slate-400">Disabled</span>}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Current effective config */}
          {preset.effective_config && (
            <div className="bg-white rounded-xl border p-5 mt-4">
              <h3 className="font-semibold text-slate-700 mb-3">Current Effective Configuration</h3>
              <div className="grid grid-cols-5 gap-4 text-sm">
                {Object.entries(preset.effective_config).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-xs text-slate-400 uppercase">{k.replace(/_/g, ' ')}</div>
                    <div className="font-medium text-slate-700">{String(v)}</div>
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

/* Vendor AI Controls sub-component */
function VendorAIControls({ loadVendorControls, vendorControls, updateVendorControl }) {
  const { s } = useStore();
  const vendors = (s.data?.vendor_profiles || []).map(v => v.vendor).filter(Boolean);

  useEffect(() => {
    vendors.forEach(v => { if (!vendorControls[v]) loadVendorControls(v); });
  }, [vendors.length]);

  const Toggle = ({ checked, onChange, label }) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <div onClick={onChange} className={`w-9 h-5 rounded-full transition relative ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </div>
      <span className="text-sm text-slate-600">{label}</span>
    </label>
  );

  return (
    <div>
      <p className="text-sm text-slate-500 mb-4">Control which vendors have AI features enabled. Disabling extraction means documents from this vendor require manual entry. Disabling intelligence skips AI-powered analysis. Excluding from training prevents correction data from being used in fine-tuning.</p>
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left p-3 font-medium text-slate-500">Vendor</th>
              <th className="text-left p-3 font-medium text-slate-500">AI Extraction</th>
              <th className="text-left p-3 font-medium text-slate-500">AI Intelligence</th>
              <th className="text-left p-3 font-medium text-slate-500">Include in Training</th>
            </tr>
          </thead>
          <tbody>
            {vendors.length === 0 ? (
              <tr><td colSpan={4} className="p-8 text-center text-slate-400">No vendors found. Upload documents to populate vendor list.</td></tr>
            ) : vendors.map(v => {
              const c = vendorControls[v] || { extraction_enabled: true, intelligence_enabled: true, include_in_training: true };
              return (
                <tr key={v} className="border-t">
                  <td className="p-3 font-medium text-slate-900">{v}</td>
                  <td className="p-3"><Toggle checked={c.extraction_enabled} onChange={() => updateVendorControl(v, 'extraction_enabled', !c.extraction_enabled)} label={c.extraction_enabled ? 'Enabled' : 'Disabled'} /></td>
                  <td className="p-3"><Toggle checked={c.intelligence_enabled} onChange={() => updateVendorControl(v, 'intelligence_enabled', !c.intelligence_enabled)} label={c.intelligence_enabled ? 'Enabled' : 'Disabled'} /></td>
                  <td className="p-3"><Toggle checked={c.include_in_training} onChange={() => updateVendorControl(v, 'include_in_training', !c.include_in_training)} label={c.include_in_training ? 'Included' : 'Excluded'} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
    team: TeamManagement, workforce: Workforce, data_governance: DataGovernancePage,
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

  if (view === 'landing') return <LandingPage onGo={() => setView('login')} onFeatures={() => setView('features')} />;
  if (view === 'features') return <FeaturesPage onBack={() => setView('landing')} onGo={() => setView('login')} />;
  if (view === 'login' && !s.user) return <LoginScreen />;
  return <ErrorBoundary><AppShell /></ErrorBoundary>;
}

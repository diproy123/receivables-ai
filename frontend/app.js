// AuditLens by AIvoraLabs — Frontend v2.1
// Anomaly detection, contracts, tax handling, multi-currency, invoice workflow

let S={scr:'landing',tab:'dashboard',docs:[],matches:[],anomalies:[],dash:{},proc:null,sel:null,toast:null,ut:'auto',api:'unknown'};

// --- Currency-Aware Formatters ---
const CUR_SYM={USD:'$',INR:'\u20b9',EUR:'\u20ac',GBP:'\u00a3',AED:'AED ',JPY:'\u00a5',CAD:'C$',AUD:'A$'};
function fmt(n,cur){cur=cur||'USD';const s=CUR_SYM[cur]||cur+' ';if(Math.abs(n)>=1e6)return s+(n/1e6).toFixed(1)+'M';if(Math.abs(n)>=1e4)return s+(n/1e3).toFixed(1)+'K';return s+n.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}
function fmtx(n,cur){cur=cur||'USD';const s=CUR_SYM[cur]||cur+' ';return s+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
const D=d=>d?new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'\u2014';
const E=s=>{const d=document.createElement('div');d.textContent=s||'';return d.innerHTML};
function SR(sc,sz=44){const r=(sz-6)/2,c=2*Math.PI*r,o=c*(1-sc/100),cl=sc>=90?'var(--ok)':sc>=75?'var(--wn)':'var(--dg)';return`<svg width="${sz}" height="${sz}" style="transform:rotate(-90deg);flex-shrink:0"><circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="var(--bd)" stroke-width="3"/><circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${cl}" stroke-width="3" stroke-dasharray="${c}" stroke-dashoffset="${o}" stroke-linecap="round"/><text x="${sz/2}" y="${sz/2}" text-anchor="middle" dominant-baseline="central" fill="${cl}" font-size="11" font-weight="700" font-family="var(--mn)" style="transform:rotate(90deg);transform-origin:center">${sc}</text></svg>`}

const LOGO_URL='/logo.jpg';
const I={logo:'<img src="'+LOGO_URL+'" width="28" height="28" style="border-radius:7px">',up:'\u2B06',doc:'\uD83D\uDCC4',lnk:'\uD83D\uDD17',chr:'\uD83D\uDCCA',sp:'\u2728',ck:'\u2713',wn:'\u26A0',x:'\u2715',ar:'\u2192',pl:'\u25B6',dl:'$',zp:'\u26A1',sh:'\uD83D\uDEE1',cl:'\uD83D\uDD52',tr:'\uD83D\uDDD1',al:'\uD83D\uDD14',ct:'\uD83D\uDCDD',fx:'\uD83D\uDD27'};

// --- Severity/Status badge helpers ---
function sevBg(s){return s==='high'?'bg-e':s==='medium'?'bg-w':'bg-d'}
function stBg(s){return{unpaid:'bg-w',paid:'bg-s',disputed:'bg-e',under_review:'bg-i',approved:'bg-s',on_hold:'bg-p',scheduled:'bg-d',open:'bg-w',active:'bg-s',pending:'bg-d',resolved:'bg-s',dismissed:'bg-d'}[s]||'bg-d'}
function typLabel(t){return{invoice:'INV',purchase_order:'PO',contract:'CTR',credit_note:'CN',debit_note:'DN'}[t]||t}
function typBg(t){return{invoice:'bg-i',purchase_order:'bg-p',contract:'bg-s',credit_note:'bg-w',debit_note:'bg-e'}[t]||'bg-d'}

// --- API ---
async function api(p,o={}){try{const r=await fetch(p,o);if(!r.ok)throw r.status;return await r.json()}catch(e){console.error('API:',e);return null}}
async function loadAll(){
  const[d,dc,m,an]=await Promise.all([api('/api/dashboard'),api('/api/documents'),api('/api/matches'),api('/api/anomalies')]);
  if(d){S.dash=d;S.api=d.api_mode}
  if(dc)S.docs=dc.documents||[];
  if(m)S.matches=m.matches||[];
  if(an)S.anomalies=an.anomalies||[];
  R();
}
async function uploadFile(f){
  const fd=new FormData();fd.append('file',f);fd.append('document_type',S.ut);
  S.proc={fn:f.name,st:0};R();
  const si=setInterval(()=>{if(S.proc&&S.proc.st<5){S.proc.st++;R()}},600);
  const r=await api('/api/upload',{method:'POST',body:fd});
  clearInterval(si);S.proc=null;
  if(r&&r.success){
    const dt=r.document.type;const nm=r.new_anomalies?.length||0;
    let msg=`${typLabel(dt)} extracted \u2014 ${Math.round(r.document.confidence)}% confidence`;
    if(nm>0) msg+=` | ${nm} anomal${nm===1?'y':'ies'} detected!`;
    toast(msg);await loadAll()
  }else{toast('Extraction failed');R()}
}
async function approveMt(id){await api(`/api/matches/${id}/approve`,{method:'POST'});await loadAll();toast('Match approved')}
async function rejectMt(id){await api(`/api/matches/${id}/reject`,{method:'POST'});await loadAll();toast('Match rejected')}
async function markPaid(id){await api(`/api/invoices/${id}/mark-paid`,{method:'POST'});S.sel=null;await loadAll();toast('Marked paid')}
async function setStatus(id,st){const fd=new FormData();fd.append('status',st);await api(`/api/invoices/${id}/status`,{method:'POST',body:fd});S.sel=null;await loadAll();toast(`Status: ${st}`)}
async function resolveAnomaly(id){await api(`/api/anomalies/${id}/resolve`,{method:'POST'});await loadAll();toast('Anomaly resolved')}
async function dismissAnomaly(id){await api(`/api/anomalies/${id}/dismiss`,{method:'POST'});await loadAll();toast('Anomaly dismissed')}
async function resetAll(){if(confirm('Reset all demo data?')){await api('/api/reset',{method:'POST'});await loadAll();toast('Data cleared')}}
function toast(m){S.toast=m;R();setTimeout(()=>{S.toast=null;R()},4000)}

// --- Render ---
function R(){document.getElementById('app').innerHTML=`<style>${CSS}</style>`+(S.scr==='landing'?landing():app());bindEvents()}

const CSS=`:root{--bg:#05070e;--sf:#0a0f1a;--sa:#0e1424;--bd:#151d2e;--bh:#1e2d47;--tx:#e8ecf4;--tm:#7a8ba8;--td:#4a5876;--ac:#2563eb;--al:#3b82f6;--ag:rgba(37,99,235,.15);--ok:#10b981;--okb:#052e16;--wn:#f59e0b;--wnb:#422006;--dg:#ef4444;--dgb:#450a0a;--pp:#a78bfa;--ppb:#1e1147;--ft:'Outfit',sans-serif;--mn:'JetBrains Mono',monospace}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--ft);background:var(--bg);color:var(--tx)}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06);opacity:.85}}
@keyframes loading{0%{width:0;margin-left:0}50%{width:55%;margin-left:25%}100%{width:0;margin-left:100%}}
@keyframes toastIn{from{opacity:0;transform:translate(-50%,20px)}to{opacity:1;transform:translate(-50%,0)}}
.fu{animation:fadeUp .4s ease both}
.bg{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:6px;font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}.bg-d{background:var(--sa);color:var(--tm)}.bg-s{background:var(--okb);color:var(--ok)}.bg-w{background:var(--wnb);color:var(--wn)}.bg-e{background:var(--dgb);color:var(--dg)}.bg-i{background:var(--ag);color:var(--al)}.bg-p{background:var(--ppb);color:var(--pp)}
.bt{display:inline-flex;align-items:center;gap:8px;padding:10px 22px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:600;font-family:var(--ft);transition:all .2s}.bt-p{background:linear-gradient(135deg,var(--ac),#4f46e5);color:#fff;box-shadow:0 2px 16px rgba(37,99,235,.25)}.bt-p:hover{transform:translateY(-1px)}.bt-s{background:var(--sa);color:var(--tx);border:1px solid var(--bd)}.bt-g{background:transparent;color:var(--tm);border:1px solid var(--bd)}.bt-sm{padding:6px 14px;font-size:12px;border-radius:8px}
.cd{background:var(--sf);border:1px solid var(--bd);border-radius:16px;padding:24px;transition:border-color .25s}
.ly{display:flex;min-height:100vh}.sidebar{width:250px;background:var(--sf);border-right:1px solid var(--bd);padding:20px 0;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:50}.mc{flex:1;margin-left:250px;padding:32px;overflow-y:auto}
.sbi{display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;border-radius:10px;border:none;cursor:pointer;font-size:13.5px;font-weight:500;font-family:var(--ft);margin-bottom:2px;text-align:left;background:transparent;color:var(--tm);transition:all .15s}.sbi:hover{background:var(--sa)}.sbi.on{background:var(--ag);color:var(--al)}
.tw{border-radius:16px;overflow:hidden;border:1px solid var(--bd);background:var(--sf)}table{width:100%;border-collapse:collapse;font-size:13px}thead tr{background:var(--sa)}th{padding:12px 16px;text-align:left;color:var(--td);font-weight:700;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}td{padding:12px 16px}tbody tr{border-top:1px solid var(--bd);cursor:pointer;transition:background .15s}tbody tr:hover{background:var(--sa)}
.mn{font-family:var(--mn);font-size:12px}.fb{font-weight:700}
.uz{border:2px dashed var(--bd);border-radius:16px;padding:60px 40px;text-align:center;cursor:pointer;transition:all .3s;background:var(--sf)}.uz:hover{border-color:var(--ac);background:var(--sa)}
.mo{position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:200}
.po{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;z-index:300}
.tt{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:400;background:var(--sf);border:1px solid rgba(16,185,129,.3);border-radius:12px;padding:12px 24px;font-size:13px;font-weight:600;color:var(--ok);display:flex;align-items:center;gap:8px;animation:toastIn .3s ease;box-shadow:0 8px 32px rgba(0,0,0,.4);max-width:600px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.anomaly-card{background:var(--sa);border:1px solid var(--bd);border-radius:12px;padding:16px;margin-bottom:10px;transition:border-color .2s}.anomaly-card:hover{border-color:var(--bh)}
.anomaly-card.sev-high{border-left:3px solid var(--dg)}.anomaly-card.sev-medium{border-left:3px solid var(--wn)}.anomaly-card.sev-low{border-left:3px solid var(--tm)}`;

function landing(){return`
<div style="min-height:100vh;position:relative">
<div style="position:fixed;top:-200px;right:-200px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(37,99,235,.08) 0%,transparent 70%);pointer-events:none"></div>
<nav style="padding:20px 48px;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:10">
<div style="display:flex;align-items:center;gap:12px"><img src="${LOGO_URL}" width="42" height="42" style="border-radius:10px"><div><span style="font-size:20px;font-weight:800;letter-spacing:-.03em;background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent">AIvoraLabs</span><div style="font-size:9px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.1em">Shaping Tomorrow with AI</div></div></div>
<div style="display:flex;gap:8px"><button class="bt bt-g" data-go>Log In</button><button class="bt bt-p" data-go>Start Free Trial ${I.ar}</button></div></nav>
<section class="fu" style="padding:80px 48px 60px;max-width:900px;margin:0 auto;text-align:center;position:relative;z-index:10">
<div style="margin-bottom:16px"><img src="${LOGO_URL}" width="72" height="72" style="border-radius:16px;box-shadow:0 8px 32px rgba(37,99,235,.3)"></div>
<div style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;background:var(--ag);border:1px solid rgba(37,99,235,.2);margin-bottom:24px;font-size:12px;font-weight:600;color:var(--al)">${I.zp} AI-Powered Spend Compliance Auditing</div>
<h1 style="font-size:48px;font-weight:800;letter-spacing:-.04em;line-height:1.1;margin-bottom:20px;background:linear-gradient(135deg,#f1f5f9,#94a3b8);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Stop overpaying vendors.<br>Start saving money.</h1>
<p style="font-size:18px;color:var(--tm);line-height:1.6;max-width:640px;margin:0 auto 36px">AuditLens reads your invoices, cross-references contracts and POs, and catches overcharges, duplicate payments, and compliance violations automatically.</p>
<div style="display:flex;gap:12px;justify-content:center"><button class="bt bt-p" style="padding:14px 32px;font-size:16px" data-go>${I.pl} Launch Demo</button><button class="bt bt-s" style="padding:14px 32px;font-size:16px">Book a Call</button></div></section>
<section style="padding:0 48px 60px;max-width:800px;margin:0 auto"><div style="display:flex;gap:1px;background:var(--bd);border-radius:16px;overflow:hidden">
${[{v:'$44.9K',l:'Anomalies Found in Test'},{v:'8',l:'Anomaly Types Detected'},{v:'96%',l:'Extraction Accuracy'},{v:'<2sec',l:'Per Document'}].map(m=>`<div style="flex:1;background:var(--sf);padding:24px 20px;text-align:center"><div style="font-size:28px;font-weight:800;color:var(--al);font-family:var(--mn)">${m.v}</div><div style="font-size:11px;color:var(--td);font-weight:500;margin-top:4px;text-transform:uppercase;letter-spacing:.05em">${m.l}</div></div>`).join('')}
</div></section>
<section style="padding:20px 48px 80px;max-width:1000px;margin:0 auto"><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${[
{i:I.sh,t:'Compliance Auditing',d:'Cross-references invoices against contracts and POs. Catches price overcharges, quantity mismatches, and terms violations.'},
{i:I.wn,t:'Anomaly Detection',d:'Smart duplicate detection, unauthorized charges, tax rate anomalies, and over-invoicing alerts with AI reasoning.'},
{i:I.dl,t:'Tax-Aware Matching',d:'Handles GST, VAT, and sales tax. Compares pre-tax subtotals against POs to eliminate false positives.'},
{i:I.lnk,t:'Multi-Invoice PO Tracking',d:'Tracks cumulative fulfillment per PO. Flags when total invoices exceed authorized amounts.'}
].map(f=>`<div class="cd" style="padding:28px"><div style="width:40px;height:40px;border-radius:10px;background:var(--ag);display:flex;align-items:center;justify-content:center;color:var(--al);margin-bottom:16px;font-size:20px">${f.i}</div><div style="font-size:16px;font-weight:700;margin-bottom:8px">${f.t}</div><div style="font-size:13.5px;color:var(--tm);line-height:1.6">${f.d}</div></div>`).join('')}</div></section>
<footer style="padding:48px;text-align:center;border-top:1px solid var(--bd)"><div style="font-size:12px;color:var(--td)">Built by AIvoraLabs \u00B7 Powered by Claude AI \u00B7 Enterprise-ready</div></footer></div>`}

function statCard(icon,label,val,sub,color){return`<div class="cd" style="flex:1;min-width:170px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><div style="width:32px;height:32px;border-radius:8px;background:${color}18;display:flex;align-items:center;justify-content:center;color:${color};font-size:16px">${icon}</div><span style="font-size:11px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.06em">${label}</span></div><div style="font-size:26px;font-weight:700;letter-spacing:-.02em">${val}</div>${sub?`<div style="font-size:12px;color:var(--td);margin-top:4px">${sub}</div>`:''}</div>`}

function app(){
  const d=S.dash||{};const ag=(d.aging||{buckets:{},counts:{}});const rv=d.review_needed||0;const ac=d.anomaly_count||0;
  return`${S.proc?processing():''}${S.sel?modal():''}${S.toast?`<div class="tt">${I.ck} ${E(S.toast)}</div>`:''}
<div class="ly"><aside class="sidebar">
<div style="display:flex;align-items:center;gap:10px;padding:0 20px;margin-bottom:32px"><img src="${LOGO_URL}" width="36" height="36" style="border-radius:9px"><div><div style="font-size:16px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent">AuditLens</div><div style="font-size:9px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.08em">by AIvoraLabs</div></div></div>
<div style="padding:0 10px;flex:1"><div style="font-size:10px;color:var(--td);font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:0 12px;margin-bottom:8px">Main</div>
${[{id:'dashboard',l:'Dashboard',i:I.chr},{id:'documents',l:'Documents',i:I.doc},{id:'anomalies',l:'Anomalies',i:I.wn,b:ac,bc:'dg'},{id:'matching',l:'PO Matching',i:I.lnk,b:rv,bc:'wn'},{id:'contracts',l:'Contracts',i:I.ct},{id:'upload',l:'Upload',i:I.up}].map(t=>`<button class="sbi ${S.tab===t.id?'on':''}" data-tab="${t.id}">${t.i} ${t.l}${t.b?`<span style="margin-left:auto;background:var(--${t.bc||'wn'}b);color:var(--${t.bc||'wn'});font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px">${t.b}</span>`:''}</button>`).join('')}
<div style="font-size:10px;color:var(--td);font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:0 12px;margin:20px 0 8px">Admin</div>
<button class="sbi" data-act="reset" style="color:var(--dg)">${I.tr} Reset Demo</button></div>
<div style="padding:16px 20px;border-top:1px solid var(--bd)"><div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:8px;font-size:11px;font-weight:600;${S.api==='claude_api'?'background:var(--okb);color:var(--ok)':'background:var(--wnb);color:var(--wn)'}">${I.sp} ${S.api==='claude_api'?'Claude API Live':'Mock Mode'}</div></div></aside>
<main class="mc">${S.tab==='dashboard'?dashboard(d,ag):S.tab==='documents'?documents():S.tab==='anomalies'?anomaliesTab():S.tab==='matching'?matching():S.tab==='contracts'?contractsTab():upload()}</main></div>`}

function dashboard(d,ag){
  const bk=[{k:'current',l:'Current',c:'var(--al)'},{k:'1_30',l:'1-30',c:'var(--wn)'},{k:'31_60',l:'31-60',c:'#f97316'},{k:'61_90',l:'61-90',c:'var(--dg)'},{k:'90_plus',l:'90+',c:'#b91c1c'}];
  const mx=Math.max(...bk.map(b=>ag.buckets[b.k]||0),1);
  const tv=d.top_vendors||[];
  return`<div class="fu"><div style="margin-bottom:28px"><h1 style="font-size:24px;font-weight:800;letter-spacing:-.03em;margin-bottom:4px">Dashboard</h1><p style="font-size:13.5px;color:var(--tm)">Spend compliance overview</p></div>
<div style="display:flex;gap:14px;margin-bottom:20px;flex-wrap:wrap">${statCard(I.dl,'Total Outstanding',fmt(d.total_ar),`${d.unpaid_count||0} unpaid invoices`,'var(--al)')}${statCard(I.wn,'Open Anomalies',d.anomaly_count||0,d.high_severity?`${d.high_severity} high severity`:'\u2014','var(--dg)')}${statCard(I.sh,'Money at Risk',fmt(d.total_risk),d.anomaly_count?'From open anomalies':'\u2014','var(--wn)')}${statCard(I.ck,'Auto-Matched',d.auto_matched||0,`${d.review_needed||0} need review`,'var(--ok)')}</div>
<div style="display:flex;gap:14px;margin-bottom:20px;flex-wrap:wrap">${statCard(I.doc,'Documents',d.total_documents||0,`${d.invoice_count||0} INV \u00B7 ${d.po_count||0} PO \u00B7 ${d.contract_count||0} CTR`,'var(--pp)')}${statCard(I.sp,'Avg Confidence',`${d.avg_confidence||0}%`,'Extraction accuracy','var(--al)')}${statCard(I.cl,'Due in 7 Days',d.due_in_7_days||0,d.due_in_7_days_amount?fmt(d.due_in_7_days_amount):'\u2014','var(--wn)')}${statCard(I.zp,'Early Pay Savings',fmt(d.early_payment_savings||0),'Available discounts','var(--ok)')}</div>
<div class="g2"><div class="cd"><div style="display:flex;align-items:center;gap:8px;margin-bottom:24px"><span style="font-size:16px">${I.chr}</span><span style="font-size:14px;font-weight:700">AR Aging</span></div>
<div style="display:flex;gap:10px;align-items:flex-end;height:150px">${bk.map(b=>{const a=ag.buckets[b.k]||0,n=ag.counts[b.k]||0,h=Math.max(6,(a/mx)*110);return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px"><div style="font-size:10px;color:var(--tm);font-weight:600;font-family:var(--mn)">${fmt(a)}</div><div style="width:100%;max-width:56px;min-height:6px;height:${h}px;background:linear-gradient(180deg,${b.c},${b.c}44);border-radius:8px 8px 3px 3px;transition:height .6s"></div><div style="font-size:11px;color:var(--tm);font-weight:600">${b.l}</div><div style="font-size:10px;color:var(--td)">${n} inv</div></div>`}).join('')}</div></div>
<div class="cd"><div style="display:flex;align-items:center;gap:8px;margin-bottom:20px"><span style="font-size:14px">${I.dl}</span><span style="font-size:14px;font-weight:700">Top Vendors by Spend</span></div>
${tv.length===0?'<div style="text-align:center;padding:40px;color:var(--td)">No data yet</div>':tv.map((v,i)=>{const pct=tv[0].spend>0?(v.spend/tv[0].spend)*100:0;return`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="color:var(--tm);font-weight:500">${E(v.vendor||'Unknown')}</span><span class="mn fb">${fmt(v.spend)}</span></div><div style="height:6px;background:var(--sa);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--ac),#7c3aed);border-radius:3px"></div></div></div>`}).join('')}</div></div>
<div class="cd" style="margin-top:16px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:20px"><span style="font-size:14px">${I.cl}</span><span style="font-size:14px;font-weight:700">Recent Activity</span></div>
${S.docs.length===0?'<div style="text-align:center;padding:40px;color:var(--td)">No documents yet \u2014 upload to start</div>':S.docs.slice(0,6).map(it=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:8px;cursor:pointer;background:var(--sa);margin-bottom:6px" data-view="${it.id}"><div><div style="font-size:13px;font-weight:600">${E(it.invoiceNumber||it.poNumber||it.contractNumber||it.id)}</div><div style="font-size:11px;color:var(--td)">${E(it.vendor)} \u00B7 ${D(it.issueDate)}</div></div><div style="display:flex;align-items:center;gap:10px"><span class="mn fb">${fmtx(it.amount,it.currency)}</span><span class="bg ${typBg(it.type)}">${typLabel(it.type)}</span></div></div>`).join('')}</div></div>`}

function documents(){
  return`<div class="fu"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><div><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">Documents</h1><p style="font-size:13.5px;color:var(--tm)">${S.docs.length} documents extracted</p></div><button class="bt bt-p" data-tab="upload">${I.up} Upload</button></div>
${S.docs.length===0?`<div class="cd" style="text-align:center;padding:60px"><p style="color:var(--td);margin-bottom:16px">No documents yet</p><button class="bt bt-p" data-tab="upload">Upload First Document</button></div>`:
`<div class="tw"><table><thead><tr><th>Type</th><th>Number</th><th>Vendor</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Currency</th><th>Date</th><th>Status</th><th>Conf.</th></tr></thead><tbody>
${S.docs.map(it=>{const num=it.invoiceNumber||it.poNumber||it.contractNumber||it.documentNumber||it.id;
return`<tr data-view="${it.id}"><td><span class="bg ${typBg(it.type)}">${typLabel(it.type)}</span></td><td class="mn fb">${E(num)}</td><td style="color:var(--tm);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${E(it.vendor)}</td><td class="mn" style="text-align:right">${it.subtotal?fmtx(it.subtotal,it.currency):'\u2014'}</td><td class="mn" style="text-align:right;color:var(--td)">${it.totalTax?fmtx(it.totalTax,it.currency):'\u2014'}</td><td class="mn fb" style="text-align:right">${fmtx(it.amount,it.currency)}</td><td><span class="bg bg-d">${it.currency||'USD'}</span></td><td style="color:var(--tm);font-size:12px">${D(it.issueDate)}</td><td><span class="bg ${stBg(it.status)}">${it.status}</span></td><td>${SR(Math.round(it.confidence),36)}</td></tr>`}).join('')}
</tbody></table></div>`}</div>`}

function anomaliesTab(){
  const open=S.anomalies.filter(a=>a.status==='open');
  const resolved=S.anomalies.filter(a=>a.status!=='open');
  const risk=open.reduce((s,a)=>s+(a.amount_at_risk||0),0);
  return`<div class="fu"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><div><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">${I.wn} Anomalies</h1><p style="font-size:13.5px;color:var(--tm)">${open.length} open \u00B7 ${resolved.length} resolved \u00B7 ${fmt(risk)} at risk</p></div></div>
${open.length===0&&resolved.length===0?`<div class="cd" style="text-align:center;padding:60px"><div style="font-size:40px;margin-bottom:16px">${I.ck}</div><p style="color:var(--td)">No anomalies detected. Upload invoices with matching POs and contracts to start auditing.</p></div>`:
`${open.length>0?`<div style="margin-bottom:28px"><div style="font-size:13px;font-weight:700;color:var(--dg);margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">${I.wn} Open (${open.length})</div>
${open.map(a=>`<div class="anomaly-card sev-${a.severity||'low'}">
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="bg ${sevBg(a.severity)}">${a.severity}</span><span class="bg bg-d">${(a.type||'').replace(/_/g,' ')}</span><span style="font-size:12px;color:var(--tm)">${E(a.invoiceNumber)} \u00B7 ${E(a.vendor)}</span></div><div class="mn fb" style="color:var(--dg);font-size:14px">${a.amount_at_risk>=0?fmtx(a.amount_at_risk,a.currency||'USD'):fmtx(Math.abs(a.amount_at_risk),a.currency||'USD')+' savings'}</div></div>
<div style="font-size:13px;color:var(--tx);line-height:1.5;margin-bottom:8px">${E(a.description)}</div>
${a.contract_clause?`<div style="font-size:11px;color:var(--al);background:var(--ag);padding:6px 10px;border-radius:6px;margin-bottom:8px">${I.ct} ${E(a.contract_clause)}</div>`:''}
${a.recommendation?`<div style="font-size:12px;color:var(--ok);margin-bottom:10px">${I.ck} ${E(a.recommendation)}</div>`:''}
<div style="display:flex;gap:8px"><button class="bt bt-sm" style="background:var(--okb);color:var(--ok);border:1px solid rgba(16,185,129,.2)" data-resolve="${a.id}">${I.ck} Resolve</button><button class="bt bt-sm bt-g" data-dismiss="${a.id}">${I.x} Dismiss</button></div></div>`).join('')}</div>`:''}
${resolved.length>0?`<div><div style="font-size:13px;font-weight:700;color:var(--tm);margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">${I.ck} Resolved / Dismissed (${resolved.length})</div>
${resolved.slice(0,10).map(a=>`<div class="anomaly-card" style="opacity:.6"><div style="display:flex;justify-content:space-between;align-items:center"><div style="display:flex;gap:8px;align-items:center"><span class="bg ${stBg(a.status)}">${a.status}</span><span class="bg bg-d">${(a.type||'').replace(/_/g,' ')}</span><span style="font-size:12px;color:var(--tm)">${E(a.invoiceNumber)} \u00B7 ${E(a.vendor)}</span></div><span class="mn" style="color:var(--td)">${fmtx(Math.abs(a.amount_at_risk||0),a.currency||'USD')}</span></div></div>`).join('')}</div>`:''}`}</div>`}

function matching(){
  const mt=S.matches.filter(m=>m.status==='auto_matched').length,rv=S.matches.filter(m=>m.status==='review_needed');
  return`<div class="fu"><div style="margin-bottom:24px"><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">${I.lnk} PO Matching</h1><p style="font-size:13.5px;color:var(--tm)">${mt} auto-matched \u00B7 ${rv.length} need review</p></div>
${S.matches.length===0?`<div class="cd" style="text-align:center;padding:60px"><p style="color:var(--td)">No matches yet. Upload invoices with PO references.</p></div>`:
`<div class="tw"><table><thead><tr><th>Invoice</th><th>Vendor</th><th>Invoice Amt</th><th>${I.ar} PO</th><th>PO Amt</th><th>Fulfilled</th><th>Score</th><th>Status</th><th>Actions</th></tr></thead><tbody>
${S.matches.map(m=>{const oi=m.overInvoiced;const fulPct=m.poAmount>0?Math.round(((m.poAlreadyInvoiced||0)+m.invoiceAmount)/m.poAmount*100):0;
return`<tr><td class="mn fb">${E(m.invoiceNumber)}</td><td style="color:var(--tm)">${E(m.vendor)}</td><td class="mn fb">${fmtx(m.invoiceAmount)}</td><td class="mn" style="color:var(--al)">${E(m.poNumber)}</td><td class="mn">${fmtx(m.poAmount)}</td><td><div style="display:flex;align-items:center;gap:6px"><div style="width:60px;height:5px;background:var(--sa);border-radius:3px;overflow:hidden"><div style="height:100%;width:${Math.min(fulPct,100)}%;background:${oi?'var(--dg)':fulPct>90?'var(--wn)':'var(--ok)'};border-radius:3px"></div></div><span class="mn" style="font-size:10px;color:${oi?'var(--dg)':'var(--tm)'}">${fulPct}%</span></div></td><td>${SR(m.matchScore,36)}</td><td><span class="bg ${m.status==='auto_matched'?'bg-s':'bg-w'}">${m.status==='auto_matched'?'matched':'review'}</span>${oi?'<span class="bg bg-e" style="margin-left:4px">OVER</span>':''}</td><td>${m.status==='review_needed'?`<button class="bt bt-sm bt-p" data-appr="${m.id}" style="margin-right:4px">${I.ck}</button><button class="bt bt-sm bt-g" data-rej="${m.id}">${I.x}</button>`:'\u2014'}</td></tr>`}).join('')}
</tbody></table></div>`}</div>`}

function contractsTab(){
  const contracts=S.docs.filter(d=>d.type==='contract');
  return`<div class="fu"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><div><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">${I.ct} Contracts</h1><p style="font-size:13.5px;color:var(--tm)">${contracts.length} vendor contracts</p></div><button class="bt bt-p" data-tab="upload">${I.up} Upload Contract</button></div>
${contracts.length===0?`<div class="cd" style="text-align:center;padding:60px"><div style="font-size:40px;margin-bottom:16px">${I.ct}</div><p style="color:var(--td);margin-bottom:8px">No contracts uploaded yet</p><p style="font-size:12px;color:var(--td)">Upload vendor contracts to enable contract pricing compliance checks</p></div>`:
contracts.map(c=>`<div class="cd" style="margin-bottom:12px;cursor:pointer" data-view="${c.id}">
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px"><div><div style="font-size:16px;font-weight:700">${E(c.contractNumber||c.id)}</div><div style="font-size:13px;color:var(--tm)">${E(c.vendor)}</div></div><span class="bg bg-s">Active</span></div>
${c.pricingTerms&&c.pricingTerms.length?`<div style="margin-bottom:12px"><div style="font-size:11px;color:var(--td);font-weight:600;text-transform:uppercase;margin-bottom:6px">Pricing Terms</div>${c.pricingTerms.map(pt=>`<div style="display:flex;justify-content:space-between;padding:6px 10px;background:var(--sa);border-radius:6px;margin-bottom:4px;font-size:12px"><span style="color:var(--tm)">${E(pt.item)}</span><span class="mn fb">${fmtx(pt.rate,c.currency)} / ${pt.unit||'unit'}</span></div>`).join('')}</div>`:''}
${c.contractTerms?`<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--td)">${c.contractTerms.effective_date?`<span>Effective: ${D(c.contractTerms.effective_date)}</span>`:''}${c.contractTerms.expiry_date?`<span>Expires: ${D(c.contractTerms.expiry_date)}</span>`:''}${c.contractTerms.auto_renewal?'<span class="bg bg-w">Auto-Renew</span>':''}${c.contractTerms.liability_cap?`<span>Liability Cap: ${fmtx(c.contractTerms.liability_cap,c.currency)}</span>`:''}</div>`:''}
<div style="margin-top:8px;font-size:11px;color:var(--td)">Payment: ${c.paymentTerms||'\u2014'} \u00B7 ${c.currency||'USD'}</div></div>`).join('')}</div>`}

function upload(){return`<div class="fu"><div style="margin-bottom:24px"><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">${I.up} Upload Document</h1><p style="font-size:13.5px;color:var(--tm)">Upload invoices, POs, contracts, or credit/debit notes</p></div>
<div style="display:flex;gap:8px;margin-bottom:20px">${['auto','invoice','purchase_order','contract','credit_note','debit_note'].map(t=>`<button class="bt bt-sm ${S.ut===t?'bt-p':'bt-g'}" data-ut="${t}">${{auto:'Auto-Detect',invoice:'Invoice',purchase_order:'Purchase Order',contract:'Contract',credit_note:'Credit Note',debit_note:'Debit Note'}[t]}</button>`).join('')}</div>
<div class="uz" id="uz"><div style="font-size:40px;margin-bottom:16px">${I.up}</div><div style="font-size:16px;font-weight:700;margin-bottom:8px">Drop files here or click to upload</div><div style="font-size:13px;color:var(--td);margin-bottom:16px">PDF, JPEG, PNG \u2014 scanned docs supported</div>
<span class="bg bg-i">${I.sp} ${S.api==='claude_api'?'Claude API \u2014 real extraction':'Demo mode \u2014 mock extraction'}</span>
<input type="file" id="fi" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff" style="display:none"></div>
<div class="cd" style="margin-top:24px;padding:22px"><div style="font-size:12px;font-weight:700;color:var(--tm);margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em">How AuditLens Works</div>
${[{n:'1',t:'Upload',d:'Invoices, POs, contracts, credit/debit notes'},{n:'2',t:'AI Extract',d:'Claude extracts all fields including tax, subtotal, pricing terms'},{n:'3',t:'Match & Audit',d:'Auto-match to POs, cross-reference contracts, detect anomalies'},{n:'4',t:'Review & Resolve',d:'See anomalies with risk amounts, resolve or dispute'}].map(s=>`<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px"><div style="width:28px;height:28px;border-radius:8px;flex-shrink:0;background:var(--ag);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--al);font-family:var(--mn)">${s.n}</div><div><div style="font-size:13px;font-weight:600">${s.t}</div><div style="font-size:12px;color:var(--td);margin-top:2px">${s.d}</div></div></div>`).join('')}</div></div>`}

function processing(){const st=['Reading document','Extracting fields & tax details','Parsing line items','Matching to POs & contracts','Running anomaly detection','Scoring confidence'];const cs=S.proc?S.proc.st:0;
return`<div class="po"><div class="cd" style="padding:44px 52px;text-align:center;max-width:440px;border:1px solid rgba(37,99,235,.2);box-shadow:0 0 80px var(--ag)"><div style="width:56px;height:56px;border-radius:14px;margin:0 auto 20px;background:linear-gradient(135deg,var(--ac),#7c3aed);display:flex;align-items:center;justify-content:center;animation:pulse 1.5s ease-in-out infinite;color:#fff;font-size:20px">${I.sp}</div><div style="font-size:17px;font-weight:700;margin-bottom:6px">Auditing...</div><div style="font-size:13px;color:var(--tm);margin-bottom:20px">${E(S.proc.fn)}</div>
<div style="text-align:left">${st.map((s,i)=>`<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:6px;color:${i<=cs?'var(--ok)':'var(--td)'}">${i<=cs?I.ck:'\u25CB'} ${s}</div>`).join('')}</div>
<div style="height:3px;background:var(--bd);border-radius:2px;overflow:hidden;margin-top:20px"><div style="height:100%;background:linear-gradient(90deg,var(--ac),#7c3aed);border-radius:2px;animation:loading 1.8s ease-in-out infinite"></div></div></div></div>`}

function modal(){const it=S.sel;if(!it)return'';const iv=it.type==='invoice';const isCtr=it.type==='contract';const cur=it.currency||'USD';
// Find anomalies for this doc
const docAnoms=S.anomalies.filter(a=>a.invoiceId===it.id&&a.status==='open');
return`<div class="mo" data-cls><div class="cd" style="padding:0;max-width:620px;width:94%;max-height:88vh;overflow-y:auto;border:1px solid var(--bh)" onclick="event.stopPropagation()">
<div style="padding:24px 28px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center"><div style="display:flex;align-items:center;gap:10px"><span class="bg ${typBg(it.type)}">${typLabel(it.type)}</span><span style="font-size:17px;font-weight:700">${E(it.invoiceNumber||it.poNumber||it.contractNumber||it.documentNumber||it.id)}</span><span class="bg bg-d">${cur}</span></div><button style="background:none;border:none;color:var(--tm);cursor:pointer;font-size:18px" data-cls>${I.x}</button></div>
<div style="padding:24px 28px">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
${[['Vendor',it.vendor],['Subtotal',fmtx(it.subtotal,cur)],['Tax',it.totalTax?fmtx(it.totalTax,cur)+' ('+(it.taxDetails||[]).map(t=>t.type+' '+t.rate+'%').join(', ')+')':'\u2014'],['Total',fmtx(it.amount,cur)],['Issued',D(it.issueDate)],[iv?'Due':'Delivery',D(iv?it.dueDate:it.deliveryDate)],['Status',(it.status||'').replace(/_/g,' ').toUpperCase()],['Confidence',Math.round(it.confidence)+'%'],['Source',it.extractionSource==='claude_api'?'Claude API':'Mock'],['Terms',it.paymentTerms||'\u2014']].map(([l,v])=>`<div><div style="font-size:10.5px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${l}</div><div style="font-size:14px;font-weight:600">${E(String(v||'\u2014'))}</div></div>`).join('')}</div>
${it.earlyPaymentDiscount?`<div style="margin-bottom:16px;padding:10px 14px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.15);border-radius:8px;font-size:12px;color:var(--ok);font-weight:500">${I.zp} Early payment discount: ${it.earlyPaymentDiscount.discount_percent}% off if paid within ${it.earlyPaymentDiscount.days} days (save ${fmtx(it.amount*(it.earlyPaymentDiscount.discount_percent/100),cur)})</div>`:''}
${it.poReference?`<div style="margin-bottom:16px;padding:10px 14px;background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.13);border-radius:8px;font-size:12px;color:var(--al);font-weight:500">${I.lnk} PO Reference: ${E(it.poReference)}</div>`:''}
${docAnoms.length>0?`<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;color:var(--dg);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">${I.wn} ${docAnoms.length} Anomal${docAnoms.length===1?'y':'ies'} Detected</div>
${docAnoms.map(a=>`<div style="padding:10px 14px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.12);border-radius:8px;margin-bottom:6px;font-size:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span class="bg ${sevBg(a.severity)}">${a.severity} \u00B7 ${(a.type||'').replace(/_/g,' ')}</span><span class="mn fb" style="color:var(--dg)">${fmtx(Math.abs(a.amount_at_risk||0),cur)}</span></div><div style="color:var(--tm);line-height:1.4">${E(a.description)}</div></div>`).join('')}</div>`:''}
${isCtr&&it.pricingTerms&&it.pricingTerms.length?`<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;color:var(--tm);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Contract Pricing</div>${it.pricingTerms.map(pt=>`<div style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--sa);border-radius:6px;margin-bottom:4px;font-size:13px"><span>${E(pt.item)}</span><span class="mn fb">${fmtx(pt.rate,cur)} / ${pt.unit||'unit'}</span></div>`).join('')}</div>`:''}
<div style="font-size:11px;font-weight:700;color:var(--tm);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Line Items</div>
<div class="tw" style="border-radius:10px"><table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead><tbody>
${(it.lineItems||[]).map(li=>`<tr style="cursor:default"><td>${E(li.description)}</td><td class="mn" style="text-align:right">${li.quantity}</td><td class="mn" style="text-align:right">${fmtx(li.unitPrice,cur)}</td><td class="mn fb" style="text-align:right">${fmtx(li.total||li.quantity*li.unitPrice,cur)}</td></tr>`).join('')}
</tbody></table></div>
${it.taxDetails&&it.taxDetails.length?`<div style="margin-top:10px;padding:10px 14px;background:var(--sa);border-radius:8px">${it.taxDetails.map(t=>`<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--tm)"><span>${E(t.type)} @ ${t.rate}%</span><span class="mn">${fmtx(t.amount,cur)}</span></div>`).join('')}<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-top:6px;padding-top:6px;border-top:1px solid var(--bd)"><span>Total</span><span class="mn">${fmtx(it.amount,cur)}</span></div></div>`:''}
${iv?`<div style="margin-top:20px;display:flex;gap:8px;flex-wrap:wrap">
${it.status!=='paid'?`<button class="bt bt-sm" style="background:var(--okb);color:var(--ok);border:1px solid rgba(16,185,129,.2)" data-paid="${it.id}">${I.ck} Mark Paid</button>`:''}
${it.status==='unpaid'?`<button class="bt bt-sm bt-s" data-status="${it.id}:under_review">${I.cl} Under Review</button>`:''}
${it.status==='under_review'?`<button class="bt bt-sm" style="background:var(--okb);color:var(--ok)" data-status="${it.id}:approved">${I.ck} Approve</button>`:''}
${it.status!=='disputed'&&it.status!=='paid'?`<button class="bt bt-sm" style="background:var(--dgb);color:var(--dg);border:1px solid rgba(239,68,68,.2)" data-status="${it.id}:disputed">${I.wn} Dispute</button>`:''}
${it.status==='disputed'?`<button class="bt bt-sm bt-s" data-status="${it.id}:unpaid">${I.ar} Re-open</button>`:''}
</div>`:''}</div></div></div>`}

function bindEvents(){
  document.querySelectorAll('[data-tab]').forEach(e=>e.onclick=()=>{S.tab=e.dataset.tab;R()});
  document.querySelectorAll('[data-go]').forEach(e=>e.onclick=async()=>{S.scr='app';R();await loadAll()});
  document.querySelectorAll('[data-cls]').forEach(e=>e.onclick=ev=>{if(ev.target===e||e.tagName==='BUTTON'){S.sel=null;R()}});
  document.querySelectorAll('[data-view]').forEach(e=>e.onclick=()=>{const d=S.docs.find(x=>x.id===e.dataset.view);if(d){S.sel=d;R()}});
  document.querySelectorAll('[data-ut]').forEach(e=>e.onclick=()=>{S.ut=e.dataset.ut;R()});
  document.querySelectorAll('[data-appr]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();approveMt(e.dataset.appr)});
  document.querySelectorAll('[data-rej]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();rejectMt(e.dataset.rej)});
  document.querySelectorAll('[data-paid]').forEach(e=>e.onclick=()=>markPaid(e.dataset.paid));
  document.querySelectorAll('[data-status]').forEach(e=>e.onclick=()=>{const[id,st]=e.dataset.status.split(':');setStatus(id,st)});
  document.querySelectorAll('[data-resolve]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();resolveAnomaly(e.dataset.resolve)});
  document.querySelectorAll('[data-dismiss]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();dismissAnomaly(e.dataset.dismiss)});
  document.querySelectorAll('[data-act="reset"]').forEach(e=>e.onclick=resetAll);
  const z=document.getElementById('uz'),fi=document.getElementById('fi');
  if(z&&fi){z.onclick=()=>fi.click();z.ondragover=e=>{e.preventDefault();z.style.borderColor='var(--ac)'};z.ondragleave=()=>{z.style.borderColor='var(--bd)'};
  z.ondrop=e=>{e.preventDefault();z.style.borderColor='var(--bd)';if(e.dataTransfer.files.length)uploadFile(e.dataTransfer.files[0])};
  fi.onchange=()=>{if(fi.files.length)uploadFile(fi.files[0])}}
}
R();

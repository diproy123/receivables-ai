// Receivables AI — Frontend App
// Connects to FastAPI backend at same origin

// --- State ---
let S = { scr:'landing', tab:'dashboard', docs:[], matches:[], dash:{}, proc:null, sel:null, toast:null, ut:'auto', api:'unknown' };

// --- Utils ---
const $=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:0}).format(n||0);
const $$=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n||0);
const D=d=>d?new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'\u2014';
const E=s=>{const d=document.createElement('div');d.textContent=s||'';return d.innerHTML};
function SR(sc,sz=44){const r=(sz-6)/2,c=2*Math.PI*r,o=c*(1-sc/100),cl=sc>=90?'var(--ok)':sc>=75?'var(--wn)':'var(--dg)';return`<svg width="${sz}" height="${sz}" style="transform:rotate(-90deg);flex-shrink:0"><circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="var(--bd)" stroke-width="3"/><circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${cl}" stroke-width="3" stroke-dasharray="${c}" stroke-dashoffset="${o}" stroke-linecap="round"/><text x="${sz/2}" y="${sz/2}" text-anchor="middle" dominant-baseline="central" fill="${cl}" font-size="11" font-weight="700" font-family="var(--mn)" style="transform:rotate(90deg);transform-origin:center">${sc}</text></svg>`}

// --- Icons ---
const I={logo:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="7" fill="url(#lg)"/><path d="M8 14l4 4 8-8" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="lg" x1="0" y1="0" x2="28" y2="28"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs></svg>',up:'\u2B06',doc:'\uD83D\uDCC4',lnk:'\uD83D\uDD17',chr:'\uD83D\uDCCA',sp:'\u2728',ck:'\u2713',wn:'\u26A0',x:'\u2715',ar:'\u2192',pl:'\u25B6',dl:'$',zp:'\u26A1',sh:'\uD83D\uDEE1',cl:'\uD83D\uDD52',tr:'\uD83D\uDDD1'};

// --- API ---
async function api(p,o={}){try{const r=await fetch(p,o);if(!r.ok)throw r.status;return await r.json()}catch(e){console.error('API:',e);return null}}
async function loadAll(){
  const[d,dc,m]=await Promise.all([api('/api/dashboard'),api('/api/documents'),api('/api/matches')]);
  if(d){S.dash=d;S.api=d.api_mode}
  if(dc)S.docs=dc.documents||[];
  if(m)S.matches=m.matches||[];
  R();
}

async function uploadFile(f){
  const fd=new FormData();fd.append('file',f);fd.append('document_type',S.ut);
  S.proc={fn:f.name,st:0};R();
  const si=setInterval(()=>{if(S.proc&&S.proc.st<4){S.proc.st++;R()}},500);
  const r=await api('/api/upload',{method:'POST',body:fd});
  clearInterval(si);S.proc=null;
  if(r&&r.success){toast(`${r.document.type==='invoice'?'Invoice':'PO'} extracted \u2014 ${Math.round(r.document.confidence)}% confidence`);await loadAll()}
  else{toast('Extraction failed');R()}
}
async function approveMt(id){await api(`/api/matches/${id}/approve`,{method:'POST'});await loadAll();toast('Match approved')}
async function rejectMt(id){await api(`/api/matches/${id}/reject`,{method:'POST'});await loadAll();toast('Match rejected')}
async function markPaid(id){await api(`/api/invoices/${id}/mark-paid`,{method:'POST'});S.sel=null;await loadAll();toast('Marked paid')}
async function resetAll(){if(confirm('Reset all demo data?')){await api('/api/reset',{method:'POST'});await loadAll();toast('Data cleared')}}
function toast(m){S.toast=m;R();setTimeout(()=>{S.toast=null;R()},3500)}

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
.ly{display:flex;min-height:100vh}.sidebar{width:240px;background:var(--sf);border-right:1px solid var(--bd);padding:20px 0;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:50}.mc{flex:1;margin-left:240px;padding:32px;overflow-y:auto}
.sbi{display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;border-radius:10px;border:none;cursor:pointer;font-size:13.5px;font-weight:500;font-family:var(--ft);margin-bottom:2px;text-align:left;background:transparent;color:var(--tm);transition:all .15s}.sbi:hover{background:var(--sa)}.sbi.on{background:var(--ag);color:var(--al)}
.tw{border-radius:16px;overflow:hidden;border:1px solid var(--bd);background:var(--sf)}table{width:100%;border-collapse:collapse;font-size:13px}thead tr{background:var(--sa)}th{padding:12px 16px;text-align:left;color:var(--td);font-weight:700;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}td{padding:12px 16px}tbody tr{border-top:1px solid var(--bd);cursor:pointer;transition:background .15s}tbody tr:hover{background:var(--sa)}
.mn{font-family:var(--mn);font-size:12px}.fb{font-weight:700}
.uz{border:2px dashed var(--bd);border-radius:16px;padding:60px 40px;text-align:center;cursor:pointer;transition:all .3s;background:var(--sf)}.uz:hover{border-color:var(--ac);background:var(--sa)}
.mo{position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:200}
.po{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;z-index:300}
.tt{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:400;background:var(--sf);border:1px solid rgba(16,185,129,.3);border-radius:12px;padding:12px 24px;font-size:13px;font-weight:600;color:var(--ok);display:flex;align-items:center;gap:8px;animation:toastIn .3s ease;box-shadow:0 8px 32px rgba(0,0,0,.4)}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}`;

function landing(){return`
<div style="min-height:100vh;position:relative">
<div style="position:fixed;top:-200px;right:-200px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(37,99,235,.08) 0%,transparent 70%);pointer-events:none"></div>
<nav style="padding:20px 48px;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:10">
<div style="display:flex;align-items:center;gap:10px">${I.logo}<span style="font-size:18px;font-weight:700;letter-spacing:-.03em">Receivables AI</span></div>
<div style="display:flex;gap:8px"><button class="bt bt-g" data-go>Log In</button><button class="bt bt-p" data-go>Start Free Trial ${I.ar}</button></div></nav>
<section class="fu" style="padding:80px 48px 60px;max-width:900px;margin:0 auto;text-align:center;position:relative;z-index:10">
<div style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;background:var(--ag);border:1px solid rgba(37,99,235,.2);margin-bottom:24px;font-size:12px;font-weight:600;color:var(--al)">${I.zp} Now processing 50,000+ documents/month</div>
<h1 style="font-size:52px;font-weight:800;letter-spacing:-.04em;line-height:1.1;margin-bottom:20px;background:linear-gradient(135deg,#f1f5f9,#94a3b8);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Stop chasing invoices.<br>Start collecting revenue.</h1>
<p style="font-size:18px;color:var(--tm);line-height:1.6;max-width:600px;margin:0 auto 36px">AI-powered accounts receivable automation that reads your documents, matches POs to invoices, and gives you real-time visibility into your cash flow.</p>
<div style="display:flex;gap:12px;justify-content:center"><button class="bt bt-p" style="padding:14px 32px;font-size:16px" data-go>${I.pl} Launch Demo</button><button class="bt bt-s" style="padding:14px 32px;font-size:16px">Book a Call</button></div></section>
<section style="padding:0 48px 60px;max-width:800px;margin:0 auto"><div style="display:flex;gap:1px;background:var(--bd);border-radius:16px;overflow:hidden">
${[{v:'94%',l:'Extraction Accuracy'},{v:'87%',l:'Auto-Match Rate'},{v:'3.2x',l:'Faster Processing'},{v:'$2.4M',l:'Avg AR Managed'}].map(m=>`<div style="flex:1;background:var(--sf);padding:24px 20px;text-align:center"><div style="font-size:28px;font-weight:800;color:var(--al);font-family:var(--mn)">${m.v}</div><div style="font-size:11px;color:var(--td);font-weight:500;margin-top:4px;text-transform:uppercase;letter-spacing:.05em">${m.l}</div></div>`).join('')}
</div></section>
<section style="padding:20px 48px 80px;max-width:1000px;margin:0 auto"><div style="text-align:center;margin-bottom:48px"><h2 style="font-size:32px;font-weight:700;letter-spacing:-.03em;margin-bottom:10px">Automate your entire AR workflow</h2><p style="color:var(--tm);font-size:15px">From document intake to cash collection \u2014 powered by Claude AI</p></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${[{i:I.sp,t:'AI-Powered Extraction',d:'Claude reads invoices and POs \u2014 extracts vendor, amounts, line items, dates, and PO references from any PDF or scan.'},{i:I.lnk,t:'Intelligent PO Matching',d:'Auto-matches invoices to POs using multi-signal analysis. Flags discrepancies with confidence scores.'},{i:I.dl,t:'AR Aging Dashboard',d:'Real-time visibility into outstanding receivables. Track aging buckets and prioritize collections.'},{i:I.sh,t:'Enterprise Grade',d:'SOC 2 compliant. Documents never leave your environment. Built for teams of 5 to 5,000.'}].map(f=>`<div class="cd" style="padding:28px"><div style="width:40px;height:40px;border-radius:10px;background:var(--ag);display:flex;align-items:center;justify-content:center;color:var(--al);margin-bottom:16px;font-size:20px">${f.i}</div><div style="font-size:16px;font-weight:700;margin-bottom:8px">${f.t}</div><div style="font-size:13.5px;color:var(--tm);line-height:1.6">${f.d}</div></div>`).join('')}</div></section>
<footer style="padding:48px;text-align:center;border-top:1px solid var(--bd)"><div style="font-size:12px;color:var(--td)">Built with Claude AI by Anthropic \u00B7 Enterprise-ready</div></footer></div>`}

function statCard(icon,label,val,sub,color){return`<div class="cd" style="flex:1;min-width:180px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><div style="width:32px;height:32px;border-radius:8px;background:${color}18;display:flex;align-items:center;justify-content:center;color:${color};font-size:16px">${icon}</div><span style="font-size:11px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.06em">${label}</span></div><div style="font-size:28px;font-weight:700;letter-spacing:-.02em">${val}</div>${sub?`<div style="font-size:12px;color:var(--td);margin-top:6px">${sub}</div>`:''}</div>`}

function app(){
  const d=S.dash||{};const ag=(d.aging||{buckets:{},counts:{}});const rv=d.review_needed||0;
  return`${S.proc?processing():''}${S.sel?modal():''}${S.toast?`<div class="tt">${I.ck} ${E(S.toast)}</div>`:''}
<div class="ly"><aside class="sidebar">
<div style="display:flex;align-items:center;gap:10px;padding:0 20px;margin-bottom:32px">${I.logo}<div><div style="font-size:15px;font-weight:700;letter-spacing:-.02em">Receivables AI</div><div style="font-size:10px;color:var(--td);font-weight:500;text-transform:uppercase;letter-spacing:.05em">Enterprise</div></div></div>
<div style="padding:0 10px;flex:1"><div style="font-size:10px;color:var(--td);font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:0 12px;margin-bottom:8px">Main</div>
${[{id:'dashboard',l:'Dashboard',i:I.chr},{id:'documents',l:'Documents',i:I.doc},{id:'matching',l:'PO Matching',i:I.lnk,b:rv},{id:'upload',l:'Upload',i:I.up}].map(t=>`<button class="sbi ${S.tab===t.id?'on':''}" data-tab="${t.id}">${t.i} ${t.l}${t.b?`<span style="margin-left:auto;background:var(--wnb);color:var(--wn);font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px">${t.b}</span>`:''}</button>`).join('')}
<div style="font-size:10px;color:var(--td);font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:0 12px;margin:20px 0 8px">Admin</div>
<button class="sbi" data-act="reset" style="color:var(--dg)">${I.tr} Reset Demo</button></div>
<div style="padding:16px 20px;border-top:1px solid var(--bd)"><div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:8px;font-size:11px;font-weight:600;${S.api==='claude_api'?'background:var(--okb);color:var(--ok)':'background:var(--wnb);color:var(--wn)'}">${I.sp} ${S.api==='claude_api'?'Claude API Live':'Mock Mode'}</div></div></aside>
<main class="mc">${S.tab==='dashboard'?dashboard(d,ag):S.tab==='documents'?documents():S.tab==='matching'?matching():upload()}</main></div>`}

function dashboard(d,ag){
  const bk=[{k:'current',l:'Current',c:'var(--al)'},{k:'1_30',l:'1-30',c:'var(--wn)'},{k:'31_60',l:'31-60',c:'#f97316'},{k:'61_90',l:'61-90',c:'var(--dg)'},{k:'90_plus',l:'90+',c:'#b91c1c'}];
  const mx=Math.max(...bk.map(b=>ag.buckets[b.k]||0),1);
  return`<div class="fu"><div style="margin-bottom:28px"><h1 style="font-size:24px;font-weight:800;letter-spacing:-.03em;margin-bottom:4px">Dashboard</h1><p style="font-size:13.5px;color:var(--tm)">Real-time AR pipeline overview</p></div>
<div style="display:flex;gap:14px;margin-bottom:24px;flex-wrap:wrap">${statCard(I.dl,'Total AR Outstanding',$(d.total_ar),`${d.unpaid_count||0} unpaid`,'var(--al)')}${statCard(I.ck,'Auto-Matched',d.auto_matched||0,`${d.review_needed||0} need review`,'var(--ok)')}${statCard(I.doc,'Documents',d.total_documents||0,`${d.invoice_count||0} INV \u00B7 ${d.po_count||0} PO`,'var(--pp)')}${statCard(I.sp,'Avg Confidence',`${d.avg_confidence||0}%`,'Extraction accuracy','var(--wn)')}</div>
<div class="g2"><div class="cd"><div style="display:flex;align-items:center;gap:8px;margin-bottom:24px"><span style="font-size:16px">${I.chr}</span><span style="font-size:14px;font-weight:700">AR Aging</span></div>
<div style="display:flex;gap:10px;align-items:flex-end;height:150px">${bk.map(b=>{const a=ag.buckets[b.k]||0,n=ag.counts[b.k]||0,h=Math.max(6,(a/mx)*110);return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px"><div style="font-size:10px;color:var(--tm);font-weight:600;font-family:var(--mn)">${$(a)}</div><div style="width:100%;max-width:56px;min-height:6px;height:${h}px;background:linear-gradient(180deg,${b.c},${b.c}44);border-radius:8px 8px 3px 3px;transition:height .6s"></div><div style="font-size:11px;color:var(--tm);font-weight:600">${b.l}</div><div style="font-size:10px;color:var(--td)">${n}</div></div>`}).join('')}</div></div>
<div class="cd"><div style="display:flex;align-items:center;gap:8px;margin-bottom:20px"><span style="font-size:14px">${I.cl}</span><span style="font-size:14px;font-weight:700">Recent</span></div>
${S.docs.length===0?'<div style="text-align:center;padding:40px;color:var(--td)">No documents yet \u2014 upload to start</div>':S.docs.slice(0,7).map(it=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:8px;cursor:pointer;background:var(--sa);margin-bottom:6px" data-view="${it.id}"><div><div style="font-size:13px;font-weight:600">${E(it.invoiceNumber||it.poNumber||it.id)}</div><div style="font-size:11px;color:var(--td)">${E(it.vendor)}</div></div><div style="display:flex;align-items:center;gap:10px"><span class="mn fb">${$(it.amount)}</span><span class="bg ${it.type==='invoice'?'bg-i':'bg-p'}">${it.type==='invoice'?'INV':'PO'}</span></div></div>`).join('')}</div></div></div>`}

function documents(){return`<div class="fu"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><div><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">Documents</h1><p style="font-size:13.5px;color:var(--tm)">${S.docs.length} documents extracted</p></div><button class="bt bt-p" data-tab="upload">${I.up} Upload</button></div>
${S.docs.length===0?`<div class="cd" style="text-align:center;padding:60px"><p style="color:var(--td);margin-bottom:16px">No documents yet</p><button class="bt bt-p" data-tab="upload">Upload First Document</button></div>`:
`<div class="tw"><table><thead><tr><th>Type</th><th>Number</th><th>Vendor</th><th>Amount</th><th>Date</th><th>Status</th><th>Confidence</th></tr></thead><tbody>
${S.docs.map(it=>{const iv=it.type==='invoice',sc=it.status==='paid'?'bg-s':it.status==='overdue'?'bg-e':it.status==='unpaid'?'bg-w':'bg-d';
return`<tr data-view="${it.id}"><td><span class="bg ${iv?'bg-i':'bg-p'}">${iv?'INV':'PO'}</span></td><td class="mn fb">${E(iv?it.invoiceNumber:it.poNumber)}</td><td style="color:var(--tm)">${E(it.vendor)}</td><td class="mn fb">${$(it.amount)}</td><td style="color:var(--tm);font-size:12px">${D(it.issueDate)}</td><td><span class="bg ${sc}">${it.status}</span></td><td><span style="font-size:11px;color:var(--td);font-family:var(--mn)">${Math.round(it.confidence)}%</span></td></tr>`}).join('')}
</tbody></table></div>`}</div>`}

function matching(){
  const mt=S.matches.filter(m=>m.status==='auto_matched').length,rv=S.matches.filter(m=>m.status==='review_needed').length;
  return`<div class="fu"><div style="margin-bottom:24px"><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">PO \u2194 Invoice Matching</h1><p style="font-size:13.5px;color:var(--tm)">AI-powered matching with confidence scoring</p></div>
<div style="display:flex;gap:14px;margin-bottom:24px">${statCard(I.ck,'Auto-Matched',mt,'','var(--ok)')}${statCard(I.wn,'Needs Review',rv,'','var(--wn)')}</div>
<div style="display:flex;flex-direction:column;gap:10px">${S.matches.length===0?'<div class="cd" style="text-align:center;padding:60px;color:var(--td)">No matches yet. Upload invoices with PO references.</div>':
S.matches.map(m=>`<div class="cd" style="display:flex;align-items:center;gap:20px;padding:18px 22px;border-left:3px solid ${m.status==='auto_matched'?'var(--ok)':'var(--wn)'}">
${SR(m.matchScore)}<div style="flex:1"><div style="display:flex;align-items:center;gap:10px;margin-bottom:4px"><span class="mn fb" style="color:var(--al)">${E(m.invoiceNumber)}</span><span style="color:var(--td)">\u2194</span><span class="mn fb" style="color:var(--pp)">${E(m.poNumber)}</span></div><div style="font-size:12px;color:var(--td)">${E(m.vendor)}</div>
${m.signals?`<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${m.signals.map(s=>`<span class="bg bg-d" style="font-size:9px">${s.replace(/_/g,' ')}</span>`).join('')}</div>`:''}</div>
<div style="text-align:right;min-width:140px"><div style="font-size:12px;color:var(--tm)">INV: <span class="mn fb">${$(m.invoiceAmount)}</span></div><div style="font-size:12px;color:var(--tm)">PO: <span class="mn fb" style="color:var(--pp)">${$(m.poAmount)}</span></div>${m.amountDifference>0?`<div style="font-size:11px;font-family:var(--mn);color:${m.amountDifference<200?'var(--ok)':'var(--wn)'};margin-top:2px">\u0394 ${$$(m.amountDifference)}</div>`:''}</div>
<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;min-width:100px"><span class="bg ${m.status==='auto_matched'?'bg-s':'bg-w'}">${m.status==='auto_matched'?I.ck+' Matched':I.wn+' Review'}</span>
${m.status==='review_needed'?`<div style="display:flex;gap:4px"><button class="bt bt-sm" style="background:var(--okb);color:var(--ok);border:1px solid rgba(16,185,129,.2)" data-appr="${m.id}">${I.ck}</button><button class="bt bt-sm" style="background:var(--dgb);color:var(--dg);border:1px solid rgba(239,68,68,.2)" data-rej="${m.id}">${I.x}</button></div>`:''}</div></div>`).join('')}</div></div>`}

function upload(){return`<div class="fu" style="max-width:600px"><div style="margin-bottom:28px"><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">Upload Documents</h1><p style="font-size:13.5px;color:var(--tm)">Upload invoices or POs for AI extraction</p></div>
<div style="display:flex;gap:8px;margin-bottom:24px">${['auto','invoice','purchase_order'].map(t=>`<button class="bt ${S.ut===t?'bt-p':'bt-s'}" style="flex:1;justify-content:center" data-ut="${t}">${t==='auto'?I.sp+' Auto':t==='invoice'?I.doc+' Invoice':I.doc+' PO'}</button>`).join('')}</div>
<div class="uz" id="uz"><div style="font-size:40px;margin-bottom:16px">${I.up}</div><div style="font-size:16px;font-weight:700;margin-bottom:8px">Drop files here or click to upload</div><div style="font-size:13px;color:var(--td);margin-bottom:16px">PDF, JPEG, PNG \u2014 scanned docs supported</div>
<span class="bg bg-i">${I.sp} ${S.api==='claude_api'?'Claude API \u2014 real extraction':'Demo mode \u2014 mock extraction'}</span>
<input type="file" id="fi" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff" style="display:none"></div>
<div class="cd" style="margin-top:24px;padding:22px"><div style="font-size:12px;font-weight:700;color:var(--tm);margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em">How It Works</div>
${[{n:'1',t:'Upload',d:'PDF invoices, POs, or scanned images'},{n:'2',t:'Extract',d:'Claude extracts vendor, amounts, line items, dates'},{n:'3',t:'Match',d:'Auto-match invoices to POs by reference + signals'},{n:'4',t:'Track',d:'AR aging dashboard, flag discrepancies, collections'}].map(s=>`<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px"><div style="width:28px;height:28px;border-radius:8px;flex-shrink:0;background:var(--ag);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--al);font-family:var(--mn)">${s.n}</div><div><div style="font-size:13px;font-weight:600">${s.t}</div><div style="font-size:12px;color:var(--td);margin-top:2px">${s.d}</div></div></div>`).join('')}</div>
<div class="cd" style="margin-top:16px;padding:16px 22px;border:1px solid rgba(37,99,235,.15);background:rgba(37,99,235,.05)"><div style="font-size:12px;color:var(--al);font-weight:600">${I.sp} Set <code style="background:var(--sa);padding:2px 6px;border-radius:4px;font-family:var(--mn);font-size:11px">ANTHROPIC_API_KEY</code> to enable real Claude extraction from actual documents.</div></div></div>`}

function processing(){const st=['Reading document','Extracting data','Parsing line items','Matching POs','Scoring confidence'],cs=S.proc?S.proc.st:0;
return`<div class="po"><div class="cd" style="padding:44px 52px;text-align:center;max-width:440px;border:1px solid rgba(37,99,235,.2);box-shadow:0 0 80px var(--ag)"><div style="width:56px;height:56px;border-radius:14px;margin:0 auto 20px;background:linear-gradient(135deg,var(--ac),#7c3aed);display:flex;align-items:center;justify-content:center;animation:pulse 1.5s ease-in-out infinite;color:#fff;font-size:20px">${I.sp}</div><div style="font-size:17px;font-weight:700;margin-bottom:6px">Processing...</div><div style="font-size:13px;color:var(--tm);margin-bottom:20px">${E(S.proc.fn)}</div>
<div style="text-align:left">${st.map((s,i)=>`<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:6px;color:${i<=cs?'var(--ok)':'var(--td)'}">${i<=cs?I.ck:'\u25CB'} ${s}</div>`).join('')}</div>
<div style="height:3px;background:var(--bd);border-radius:2px;overflow:hidden;margin-top:20px"><div style="height:100%;background:linear-gradient(90deg,var(--ac),#7c3aed);border-radius:2px;animation:loading 1.8s ease-in-out infinite"></div></div></div></div>`}

function modal(){const it=S.sel;if(!it)return'';const iv=it.type==='invoice';
return`<div class="mo" data-cls><div class="cd" style="padding:0;max-width:560px;width:92%;max-height:85vh;overflow-y:auto;border:1px solid var(--bh)" onclick="event.stopPropagation()">
<div style="padding:24px 28px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center"><div style="display:flex;align-items:center;gap:10px"><span class="bg ${iv?'bg-i':'bg-p'}">${iv?'Invoice':'PO'}</span><span style="font-size:17px;font-weight:700">${E(iv?it.invoiceNumber:it.poNumber)}</span></div><button style="background:none;border:none;color:var(--tm);cursor:pointer;font-size:18px" data-cls>${I.x}</button></div>
<div style="padding:24px 28px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:24px">${[['Vendor',it.vendor],['Amount',$$(it.amount)],['Issued',D(it.issueDate)],[iv?'Due':'Delivery',D(iv?it.dueDate:it.deliveryDate)],['Status',(it.status||'').toUpperCase()],['Confidence',Math.round(it.confidence)+'%'],['Source',it.extractionSource==='claude_api'?'Claude API':'Mock'],['Terms',it.paymentTerms||'\u2014']].map(([l,v])=>`<div><div style="font-size:10.5px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${l}</div><div style="font-size:14px;font-weight:600">${E(v||'\u2014')}</div></div>`).join('')}</div>
${it.poReference?`<div style="margin-bottom:20px;padding:10px 14px;background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.13);border-radius:8px;font-size:12px;color:var(--al);font-weight:500">PO Reference: ${E(it.poReference)}</div>`:''}
<div style="font-size:12px;font-weight:700;color:var(--tm);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Line Items</div>
<div class="tw" style="border-radius:10px"><table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead><tbody>
${(it.lineItems||[]).map(li=>`<tr style="cursor:default"><td>${E(li.description)}</td><td class="mn" style="text-align:right">${li.quantity}</td><td class="mn" style="text-align:right">${$$(li.unitPrice)}</td><td class="mn fb" style="text-align:right">${$$(li.total||li.quantity*li.unitPrice)}</td></tr>`).join('')}</tbody></table></div>
${iv&&it.status!=='paid'?`<div style="margin-top:20px"><button class="bt bt-sm" style="background:var(--okb);color:var(--ok);border:1px solid rgba(16,185,129,.2)" data-paid="${it.id}">${I.ck} Mark Paid</button></div>`:''}</div></div></div>`}

function bindEvents(){
  document.querySelectorAll('[data-tab]').forEach(e=>e.onclick=()=>{S.tab=e.dataset.tab;R()});
  document.querySelectorAll('[data-go]').forEach(e=>e.onclick=async()=>{S.scr='app';R();await loadAll()});
  document.querySelectorAll('[data-cls]').forEach(e=>e.onclick=ev=>{if(ev.target===e||e.tagName==='BUTTON'){S.sel=null;R()}});
  document.querySelectorAll('[data-view]').forEach(e=>e.onclick=()=>{const d=S.docs.find(x=>x.id===e.dataset.view);if(d){S.sel=d;R()}});
  document.querySelectorAll('[data-ut]').forEach(e=>e.onclick=()=>{S.ut=e.dataset.ut;R()});
  document.querySelectorAll('[data-appr]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();approveMt(e.dataset.appr)});
  document.querySelectorAll('[data-rej]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();rejectMt(e.dataset.rej)});
  document.querySelectorAll('[data-paid]').forEach(e=>e.onclick=()=>markPaid(e.dataset.paid));
  document.querySelectorAll('[data-act="reset"]').forEach(e=>e.onclick=resetAll);
  const z=document.getElementById('uz'),fi=document.getElementById('fi');
  if(z&&fi){z.onclick=()=>fi.click();z.ondragover=e=>{e.preventDefault();z.style.borderColor='var(--ac)'};z.ondragleave=()=>{z.style.borderColor='var(--bd)'};
  z.ondrop=e=>{e.preventDefault();z.style.borderColor='var(--bd)';if(e.dataTransfer.files.length)uploadFile(e.dataTransfer.files[0])};
  fi.onchange=()=>{if(fi.files.length)uploadFile(fi.files[0])}}
}
R();

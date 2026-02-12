// AuditLens — Frontend v2.5
// Anomaly detection, contracts, tax handling, multi-currency, invoice workflow
// F1: Agentic triage (auto-approve/review/block) + F3: Vendor risk scoring

let S={scr:'landing',tab:'dashboard',docs:[],matches:[],anomalies:[],dash:{},vendors:[],triageData:{},proc:null,sel:null,toast:null,ut:'auto',api:'unknown',editing:false,editFields:{},modalView:'split',currentRole:'analyst',policy:{},
  // Auth state
  authToken:null,authUser:null,authMode:'login',authError:null,authLoading:false};

// Restore token from sessionStorage
try{const t=sessionStorage.getItem('al_token');const u=sessionStorage.getItem('al_user');if(t&&u){S.authToken=t;S.authUser=JSON.parse(u);S.currentRole=S.authUser.role||'analyst'}}catch(e){}

// --- Currency-Aware Formatters ---
const CUR_SYM={USD:'$',INR:'\u20b9',EUR:'\u20ac',GBP:'\u00a3',AED:'AED ',JPY:'\u00a5',CAD:'C$',AUD:'A$'};
function fmt(n,cur){n=Number(n)||0;cur=cur||'USD';const s=CUR_SYM[cur]||cur+' ';if(Math.abs(n)>=1e6)return s+(n/1e6).toFixed(1)+'M';if(Math.abs(n)>=1e4)return s+(n/1e3).toFixed(1)+'K';return s+n.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}
function fmtx(n,cur){n=Number(n)||0;cur=cur||'USD';const s=CUR_SYM[cur]||cur+' ';return s+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
const D=d=>d?new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'\u2014';
const E=s=>{const d=document.createElement('div');d.textContent=s||'';return d.innerHTML};
function SR(sc,sz=44){const r=(sz-6)/2,c=2*Math.PI*r,o=c*(1-sc/100),cl=sc>=90?'var(--ok)':sc>=75?'var(--wn)':'var(--dg)';return`<svg width="${sz}" height="${sz}" style="transform:rotate(-90deg);flex-shrink:0"><circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="var(--bd)" stroke-width="3"/><circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${cl}" stroke-width="3" stroke-dasharray="${c}" stroke-dashoffset="${o}" stroke-linecap="round"/><text x="${sz/2}" y="${sz/2}" text-anchor="middle" dominant-baseline="central" fill="${cl}" font-size="11" font-weight="700" font-family="var(--mn)" style="transform:rotate(90deg);transform-origin:center">${sc}</text></svg>`}

const LOGO_URL='/logo.jpg';
const I={logo:'<img src="'+LOGO_URL+'" width="34" height="34" style="border-radius:8px">',up:'\u2B06',doc:'\uD83D\uDCC4',lnk:'\uD83D\uDD17',chr:'\uD83D\uDCCA',sp:'\u2728',ck:'\u2713',wn:'\u26A0',x:'\u2715',ar:'\u2192',pl:'\u25B6',dl:'$',zp:'\u26A1',sh:'\uD83D\uDEE1',cl:'\uD83D\uDD52',tr:'\uD83D\uDDD1',al:'\uD83D\uDD14',ct:'\uD83D\uDCDD',fx:'\uD83D\uDD27'};

// --- Severity/Status badge helpers ---
function sevBg(s){return s==='high'?'bg-e':s==='medium'?'bg-w':'bg-d'}
function stBg(s){return{unpaid:'bg-w',paid:'bg-s',disputed:'bg-e',under_review:'bg-i',approved:'bg-s',on_hold:'bg-p',scheduled:'bg-d',open:'bg-w',active:'bg-s',pending:'bg-d',resolved:'bg-s',dismissed:'bg-d'}[s]||'bg-d'}
function typLabel(t){return{invoice:'INV',purchase_order:'PO',contract:'CTR',credit_note:'CN',debit_note:'DN',goods_receipt:'GRN'}[t]||t}
function typBg(t){return{invoice:'bg-i',purchase_order:'bg-p',contract:'bg-s',credit_note:'bg-w',debit_note:'bg-e',goods_receipt:'bg-d'}[t]||'bg-d'}
function laneBg(l){return l==='AUTO_APPROVE'?'bg-s':l==='BLOCK'?'bg-e':l==='REVIEW'?'bg-w':'bg-d'}
function laneLabel(l){return l==='AUTO_APPROVE'?'\u2713 Approved':l==='BLOCK'?'\u26D4 Blocked':l==='REVIEW'?'\uD83D\uDD0D Review':'\u2014'}
function riskBg(l){return l==='high'?'bg-e':l==='medium'?'bg-w':'bg-s'}
function riskIcon(l){return l==='high'?'\uD83D\uDD34':l==='medium'?'\uD83D\uDFE1':'\uD83D\uDFE2'}
function trendIcon(t){return t==='worsening'?'\u2191\uFE0F':t==='improving'?'\u2193\uFE0F':'\u2192\uFE0F'}

// --- API ---
async function api(p,o={}){try{
  const h={...o.headers||{}};
  if(S.authToken)h['Authorization']='Bearer '+S.authToken;
  else h['X-User-Role']=S.currentRole;
  o.headers=h;
  const r=await fetch(p,o);
  if(r.status===401){S.authToken=null;S.authUser=null;S.scr='login';sessionStorage.removeItem('al_token');sessionStorage.removeItem('al_user');R();return null}
  const j=await r.json();if(!r.ok){console.error('API:',r.status,j);if(r.status===403){toast(j.detail||'Insufficient authority');return null}}return j}catch(e){console.error('API:',e);return null}}
async function loadAll(){
  const[d,dc,m,an,vnd,tri,pol]=await Promise.all([api('/api/dashboard'),api('/api/documents'),api('/api/matches'),api('/api/anomalies'),api('/api/vendors'),api('/api/triage'),api('/api/policy')]);
  if(d){S.dash=d;S.api=d.api_mode}
  if(dc)S.docs=dc.documents||[];
  if(m)S.matches=m.matches||[];
  if(an)S.anomalies=an.anomalies||[];
  if(vnd)S.vendors=vnd.vendors||[];
  if(tri)S.triageData=tri||{};
  if(pol)S.policy=pol.policy||{};
  R();
}
async function uploadFile(f){
  const fd=new FormData();fd.append('file',f);fd.append('document_type',S.ut);
  S.proc={fn:f.name,st:0,cur:1,total:1};R();
  const si=setInterval(()=>{if(S.proc&&S.proc.st<5){S.proc.st++;R()}},600);
  const r=await api('/api/upload',{method:'POST',body:fd});
  clearInterval(si);S.proc=null;
  if(r&&r.success){
    const dt=r.document.type;const nm=r.new_anomalies?.length||0;const tri=r.triage;const pt=r.processing_time;
    let msg=`${typLabel(dt)} extracted \u2014 ${Math.round(r.document.confidence)}% confidence`;
    if(pt&&pt.total_ms) msg+=` | ${(pt.total_ms/1000).toFixed(1)}s total`;
    if(nm>0) msg+=` | ${nm} anomal${nm===1?'y':'ies'} detected!`;
    if(tri&&dt==='invoice') msg+=` | Triage: ${tri.lane==='AUTO_APPROVE'?'\u2713 Auto-Approved':tri.lane==='BLOCK'?'\u26D4 Blocked':'\uD83D\uDD0D Review'}`;
    toast(msg);await loadAll()
  }else{toast(r?.error||'Extraction failed');R()}
}
async function uploadBulk(files){
  const total=files.length;let ok=0,fail=0;
  for(let i=0;i<total;i++){
    const f=files[i];
    S.proc={fn:f.name,st:0,cur:i+1,total};R();
    const fd=new FormData();fd.append('file',f);fd.append('document_type',S.ut);
    const si=setInterval(()=>{if(S.proc&&S.proc.st<5){S.proc.st++;R()}},500);
    const r=await api('/api/upload',{method:'POST',body:fd});
    clearInterval(si);
    if(r&&r.success)ok++;else fail++;
  }
  S.proc=null;await loadAll();
  toast(`Bulk upload: ${ok} succeeded${fail?', '+fail+' failed':''} out of ${total} files`);
}
async function approveMt(id){await api(`/api/matches/${id}/approve`,{method:'POST'});await loadAll();toast('Match approved')}
async function rejectMt(id){await api(`/api/matches/${id}/reject`,{method:'POST'});await loadAll();toast('Match rejected')}
async function markPaid(id){await api(`/api/invoices/${id}/mark-paid`,{method:'POST'});S.sel=null;await loadAll();toast('Marked paid')}
async function setStatus(id,st){const fd=new FormData();fd.append('status',st);await api(`/api/invoices/${id}/status`,{method:'POST',body:fd});S.sel=null;await loadAll();toast(`Status: ${st}`)}
async function resolveAnomaly(id){await api(`/api/anomalies/${id}/resolve`,{method:'POST'});await loadAll();toast('Anomaly resolved')}
async function dismissAnomaly(id){await api(`/api/anomalies/${id}/dismiss`,{method:'POST'});await loadAll();toast('Anomaly dismissed')}
async function resetAll(){if(confirm('Reset all data? This cannot be undone.')){await api('/api/reset',{method:'POST'});await loadAll();toast('Data cleared')}}
async function seedDemo(){
  const st=await api('/api/data-status');
  if(st&&st.total_records>0){if(!confirm(`DB has ${st.total_records} records. Reset first?\n\nClick OK to reset & seed, Cancel to abort.`))return;await api('/api/reset',{method:'POST'})}
  const r=await api('/api/seed-demo',{method:'POST'});
  if(r&&r.success){await loadAll();toast(r.message||'Demo data seeded')}else{toast(r?.error||'Seed failed')}
}
async function exportDb(){
  const r=await api('/api/export');
  if(r){const b=new Blob([JSON.stringify(r,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='auditlens_backup_'+new Date().toISOString().slice(0,10)+'.json';a.click();toast('Database exported')}
}
async function importDb(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json';
  inp.onchange=async()=>{if(!inp.files[0])return;if(!confirm('This will replace all current data. Continue?'))return;const fd=new FormData();fd.append('file',inp.files[0]);const r=await api('/api/import',{method:'POST',body:fd});if(r&&r.success){await loadAll();toast(r.message||'Imported')}else{toast(r?.error||'Import failed')}};
  inp.click();
}
async function saveEdits(){
  if(!S.sel||!S.editing)return;
  const ef=S.editFields;if(!Object.keys(ef).length){S.editing=false;R();return}
  // Build line items from edit fields if any li_ keys exist
  const liKeys=Object.keys(ef).filter(k=>k.startsWith('li_'));
  if(liKeys.length>0){
    const lis=[...(S.sel.lineItems||[])];
    liKeys.forEach(k=>{const[_,idx,field]=k.split('_');const i=parseInt(idx);
      if(lis[i]){if(field==='qty')lis[i]={...lis[i],quantity:parseFloat(ef[k])||0};
        else if(field==='price')lis[i]={...lis[i],unitPrice:parseFloat(ef[k])||0};
        else if(field==='desc')lis[i]={...lis[i],description:ef[k]};
        lis[i].total=lis[i].quantity*lis[i].unitPrice}
      delete ef[k]});
    ef.lineItems=lis}
  // Parse numeric fields
  ['amount','subtotal'].forEach(f=>{if(ef[f])ef[f]=parseFloat(ef[f])||0});
  const fd=new FormData();fd.append('fields',JSON.stringify(ef));
  const r=await api(`/api/documents/${S.sel.id}/edit-fields`,{method:'POST',body:fd});
  if(r&&r.success){
    S.editing=false;S.editFields={};S.sel=null;await loadAll();
    let msg=r.anomalies_rerun?`Saved \u2014 ${r.new_anomalies?.length||0} anomalies after re-check`:'Saved corrections';
    if(r.patterns_learned>0) msg+=` | ${r.patterns_learned} pattern${r.patterns_learned>1?'s':''} learned for future extractions`;
    toast(msg)}
  else{toast('Save failed')}
}
function startEdit(){S.editing=true;S.editFields={};R()}
function cancelEdit(){S.editing=false;S.editFields={};R()}
function toast(m){S.toast=m;R();setTimeout(()=>{S.toast=null;R()},4000)}

// --- Render ---
async function doAuth(mode){
  const emailEl=document.getElementById('auth-email');
  const passEl=document.getElementById('auth-password');
  const nameEl=document.getElementById('auth-name');
  const roleEl=document.getElementById('auth-role');
  const email=(emailEl?emailEl.value:'').trim();
  const password=passEl?passEl.value:'';
  const name=(nameEl?nameEl.value:'').trim();
  const role=roleEl?roleEl.value:'analyst';
  if(!email||!email.includes('@')){S.authError='Please enter a valid email address';R();return}
  if(password.length<6){S.authError='Password must be at least 6 characters';R();return}
  if(mode==='register'&&!name){S.authError='Please enter your name';R();return}
  S.authError=null;S.authLoading=true;R();
  const endpoint=mode==='register'?'/api/auth/register':'/api/auth/login';
  const body=mode==='register'?{email,password,name,role}:{email,password};
  try{
    const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    S.authLoading=false;
    if(!r.ok){S.authError=j.detail||'Authentication failed';R();return}
    S.authToken=j.token;S.authUser=j.user;S.currentRole=j.user.role;
    sessionStorage.setItem('al_token',j.token);sessionStorage.setItem('al_user',JSON.stringify(j.user));
    S.scr='app';R();await loadAll();toast(`Welcome, ${j.user.name}!`);
  }catch(e){S.authLoading=false;S.authError='Network error';R()}}
function logout(){S.authToken=null;S.authUser=null;S.scr='login';S.authError=null;sessionStorage.removeItem('al_token');sessionStorage.removeItem('al_user');R();toast('Logged out')}

function loginScreen(){
  const m=S.authMode||'login';
  return`<div style="min-height:100vh;display:flex;background:var(--bg)">
<div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:60px;max-width:480px;position:relative">
<div style="position:absolute;top:-200px;left:-100px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(26,86,219,.04) 0%,transparent 60%);pointer-events:none"></div>
<div style="position:relative;z-index:1">
<div style="display:flex;align-items:center;gap:12px;margin-bottom:40px"><div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#dc2626,#ef4444);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(220,38,38,.2)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/><path d="M12 22V12"/><path d="M2 7l10 5 10-5"/></svg></div><span style="font-size:20px;font-weight:800;color:var(--tx);letter-spacing:-.02em">AuditLens</span></div>
<h1 style="font-size:28px;font-weight:800;color:var(--tx);margin-bottom:6px;letter-spacing:-.03em">${m==='login'?'Welcome back':'Create your account'}</h1>
<p style="font-size:14px;color:var(--td);margin-bottom:28px">${m==='login'?'Sign in to your AP dashboard':'Start auditing invoices in minutes'}</p>
<div style="display:flex;margin-bottom:24px;border-radius:10px;overflow:hidden;border:1px solid var(--bd)"><button style="flex:1;padding:10px;border:none;cursor:pointer;font-weight:600;font-size:13px;font-family:var(--ft);transition:all .2s;${m==='login'?'background:var(--ag);color:var(--ac)':'background:var(--sf);color:var(--td)'}" onclick="S.authMode='login';S.authError=null;R()">Sign In</button><button style="flex:1;padding:10px;border:none;cursor:pointer;font-weight:600;font-size:13px;font-family:var(--ft);transition:all .2s;${m==='register'?'background:var(--ag);color:var(--ac)':'background:var(--sf);color:var(--td)'}" onclick="S.authMode='register';S.authError=null;R()">Register</button></div>
${S.authError?`<div style="padding:10px 14px;background:var(--dgb);color:var(--dg);border-radius:10px;font-size:13px;font-weight:500;margin-bottom:16px;border:1px solid rgba(190,18,60,.15)">${E(S.authError)}</div>`:''}
${m==='register'?`<div style="margin-bottom:14px"><label class="lbl">Full Name</label><input id="auth-name" type="text" placeholder="Your name" class="inp"></div>`:''}
<div style="margin-bottom:14px"><label class="lbl">Email</label><input id="auth-email" type="email" placeholder="name@company.com" class="inp"></div>
<div style="margin-bottom:14px"><label class="lbl">Password</label><input id="auth-password" type="password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" class="inp"></div>
${m==='register'?`<div style="margin-bottom:20px"><label class="lbl">Role</label><select id="auth-role" class="inp" style="cursor:pointer"><option value="analyst">AP Analyst</option><option value="manager">AP Manager</option><option value="vp">VP Finance</option><option value="cfo">CFO</option></select><div style="font-size:11px;color:var(--td);margin-top:4px">Select your role in the organization</div></div>`:''}
<button id="auth-submit" class="bt bt-p" style="width:100%;padding:12px;font-size:15px;font-weight:700" ${S.authLoading?'disabled':''}>${S.authLoading?'Authenticating...':m==='login'?'Sign In \u2192':'Create Account \u2192'}</button>
</div></div>
<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:40px;background:var(--sf);border-left:1px solid var(--bd);position:relative">
<div style="max-width:380px;text-align:center;position:relative;z-index:1">
<div style="font-size:48px;margin-bottom:20px">\uD83D\uDEE1\uFE0F</div>
<div style="font-size:22px;font-weight:700;color:var(--tx);margin-bottom:12px">Enterprise AP Automation</div>
<div style="font-size:14px;color:var(--tm);line-height:1.7;margin-bottom:28px">Three-way matching, anomaly detection, delegation of authority, and configurable policies \u2014 all powered by AI.</div>
<div style="display:flex;flex-direction:column;gap:10px;text-align:left">${[
  {i:'\u2705',t:'15+ anomaly detectors catch what humans miss'},
  {i:'\uD83D\uDD12',t:'SOX-compliant audit trail with user identity'},
  {i:'\u26A1',t:'Process invoices in under 2 seconds'},
].map(f=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--sa);border-radius:10px;border:1px solid var(--bd)"><span style="font-size:16px">${f.i}</span><span style="font-size:13px;color:var(--tm);font-weight:500">${f.t}</span></div>`).join('')}
</div></div></div></div>`}

function R(){document.getElementById('app').innerHTML=`<style>${CSS}</style>`+(S.scr==='login'?loginScreen():S.scr==='landing'?landing():app());bindEvents()}

const CSS=`:root{--bg:#f8f9fb;--sf:#ffffff;--sa:#f1f3f8;--bd:#e4e7ef;--bh:#c9cdd8;--tx:#0f1729;--tm:#3d4663;--td:#6b7493;--ac:#1a56db;--al:#1a56db;--ag:rgba(26,86,219,.06);--ok:#047857;--okb:#ecfdf5;--wn:#b45309;--wnb:#fffbeb;--dg:#be123c;--dgb:#fef2f2;--pp:#6d28d9;--ppb:#f3f0ff;--ft:'DM Sans',sans-serif;--mn:'IBM Plex Mono',monospace;--rd:#dc2626}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--ft);background:var(--bg);color:var(--tx);-webkit-font-smoothing:antialiased}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
@keyframes loading{0%{width:0;margin-left:0}50%{width:55%;margin-left:25%}100%{width:0;margin-left:100%}}
@keyframes toastIn{from{opacity:0;transform:translate(-50%,20px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.fu{animation:fadeUp .45s cubic-bezier(.22,1,.36,1) both}
.bg{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase}.bg-d{background:var(--sa);color:var(--tm)}.bg-s{background:var(--okb);color:var(--ok)}.bg-w{background:var(--wnb);color:var(--wn)}.bg-e{background:var(--dgb);color:var(--dg)}.bg-i{background:var(--ag);color:var(--al)}.bg-p{background:var(--ppb);color:var(--pp)}
.bt{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 22px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:600;font-family:var(--ft);transition:all .2s ease}.bt-p{background:var(--ac);color:#fff;box-shadow:0 1px 2px rgba(26,86,219,.25),0 0 0 0 rgba(26,86,219,0)}.bt-p:hover{background:#1648b8;box-shadow:0 4px 12px rgba(26,86,219,.3),0 0 0 3px rgba(26,86,219,.08);transform:translateY(-1px)}.bt-s{background:var(--sf);color:var(--tx);border:1px solid var(--bd);box-shadow:0 1px 2px rgba(0,0,0,.04)}.bt-s:hover{background:var(--sa);border-color:var(--bh)}.bt-g{background:transparent;color:var(--tm);border:1px solid var(--bd)}.bt-g:hover{background:var(--sa)}.bt-sm{padding:6px 12px;font-size:13px;border-radius:8px}
.cd{background:var(--sf);border:1px solid var(--bd);border-radius:14px;padding:24px;transition:all .25s;box-shadow:0 1px 3px rgba(0,0,0,.03)}.cd:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);border-color:var(--bh)}
.ly{display:flex;min-height:100vh}.sidebar{width:260px;background:var(--sf);border-right:1px solid var(--bd);padding:24px 0;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:50;box-shadow:1px 0 8px rgba(0,0,0,.03)}.mc{flex:1;margin-left:260px;padding:32px 36px;overflow-y:auto;max-width:1280px}
.sbi{display:flex;align-items:center;gap:11px;width:calc(100% - 16px);padding:10px 14px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:500;font-family:var(--ft);margin:0 8px 2px;text-align:left;background:transparent;color:var(--tm);transition:all .15s}.sbi:hover{background:var(--sa);color:var(--tx)}.sbi.on{background:var(--ag);color:var(--al);font-weight:600}
.tw{border-radius:14px;overflow-x:auto;border:1px solid var(--bd);background:var(--sf)}table{width:100%;border-collapse:collapse;font-size:14px;white-space:nowrap}thead tr{background:var(--sa)}th{padding:12px 16px;text-align:left;color:var(--td);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.06em}td{padding:12px 16px}tbody tr{border-top:1px solid var(--bd);cursor:pointer;transition:background .15s}tbody tr:hover{background:var(--sa)}
.mn{font-family:var(--mn);font-size:13px}.fb{font-weight:600}
.uz{border:2px dashed var(--bd);border-radius:16px;padding:60px 40px;text-align:center;cursor:pointer;transition:all .3s;background:var(--sf)}.uz:hover{border-color:var(--ac);background:var(--ag)}
.mo{position:fixed;inset:0;background:rgba(15,23,41,.5);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:200}
.po{position:fixed;inset:0;background:rgba(15,23,41,.55);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;z-index:300}
.tt{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:400;background:var(--sf);border:1px solid rgba(4,120,87,.25);border-radius:12px;padding:12px 24px;font-size:14px;font-weight:600;color:var(--ok);display:flex;align-items:center;gap:8px;animation:toastIn .3s ease;box-shadow:0 8px 32px rgba(0,0,0,.12);max-width:600px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.anomaly-card{background:var(--sf);border:1px solid var(--bd);border-radius:14px;padding:16px;margin-bottom:10px;transition:all .2s}.anomaly-card:hover{border-color:var(--bh);box-shadow:0 2px 8px rgba(0,0,0,.04)}.anomaly-card.sev-high{border-left:3px solid var(--dg)}.anomaly-card.sev-medium{border-left:3px solid var(--wn)}.anomaly-card.sev-low{border-left:3px solid var(--td)}
.inp{width:100%;padding:11px 14px;border:1px solid var(--bd);border-radius:10px;font-size:14px;font-family:var(--ft);background:var(--bg);color:var(--tx);transition:border-color .2s,box-shadow .2s;outline:none}.inp:focus{border-color:var(--ac);box-shadow:0 0 0 3px rgba(26,86,219,.1)}
.lbl{font-size:13px;font-weight:600;color:var(--td);display:block;margin-bottom:6px}`;

function landing(){return`
<div style="min-height:100vh;background:var(--bg);position:relative;overflow:hidden">
<div style="position:absolute;top:-300px;right:-200px;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(26,86,219,.06) 0%,transparent 60%);pointer-events:none"></div>
<div style="position:absolute;bottom:-200px;left:-100px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(220,38,38,.04) 0%,transparent 60%);pointer-events:none"></div>
<nav style="padding:20px 56px;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:10">
<div style="display:flex;align-items:center;gap:12px"><div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#dc2626,#ef4444);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(220,38,38,.2)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/><path d="M12 22V12"/><path d="M2 7l10 5 10-5"/></svg></div><span style="font-size:20px;font-weight:800;letter-spacing:-.02em;color:var(--tx)">AuditLens</span></div>
<div style="display:flex;gap:10px"><button class="bt bt-g" data-go>Sign In</button><button class="bt bt-p" data-go>Get Started \u2192</button></div></nav>

<section class="fu" style="padding:80px 56px 60px;max-width:960px;margin:0 auto;text-align:center;position:relative;z-index:10">
<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:24px;background:var(--ag);border:1px solid rgba(26,86,219,.12);margin-bottom:28px;font-size:13px;font-weight:600;color:var(--ac)"><span style="width:6px;height:6px;border-radius:50%;background:var(--ac);animation:pulse 2s infinite"></span> AI-Powered Accounts Payable Intelligence</div>
<h1 style="font-size:52px;font-weight:800;letter-spacing:-.045em;line-height:1.08;margin-bottom:24px;color:var(--tx)">Every invoice audited.<br><span style="background:linear-gradient(135deg,var(--ac),#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Every dollar accounted.</span></h1>
<p style="font-size:18px;color:var(--tm);line-height:1.7;max-width:620px;margin:0 auto 40px;font-weight:400">Three-way matching, anomaly detection, and delegation of authority \u2014 AuditLens brings enterprise AP automation to every finance team.</p>
<div style="display:flex;gap:14px;justify-content:center"><button class="bt bt-p" style="padding:14px 32px;font-size:16px;font-weight:700" data-go>Start Auditing \u2192</button><button class="bt bt-s" style="padding:14px 32px;font-size:16px" onclick="window.open('mailto:sales@auditlens.ai')">Talk to Sales</button></div></section>

<section style="padding:0 56px 60px;max-width:1000px;margin:0 auto;position:relative;z-index:10"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:2px;background:var(--bd);border-radius:16px;overflow:hidden;border:1px solid var(--bd)">
${[{v:'15+',l:'Anomaly Types'},{v:'3-Way',l:'PO-GRN-Invoice Matching'},{v:'4-Tier',l:'Approval Authority'},{v:'<2s',l:'Per Document'}].map(m=>`<div style="background:var(--sf);padding:28px 20px;text-align:center"><div style="font-size:30px;font-weight:800;color:var(--ac);font-family:var(--mn);letter-spacing:-.02em">${m.v}</div><div style="font-size:12px;color:var(--td);font-weight:500;margin-top:6px;text-transform:uppercase;letter-spacing:.06em">${m.l}</div></div>`).join('')}
</div></section>

<section style="padding:20px 56px 80px;max-width:1060px;margin:0 auto;position:relative;z-index:10"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${[
{i:'\uD83D\uDD17',t:'Three-Way Matching',d:'PO \u2194 GRN \u2194 Invoice verification. Catches unreceipted invoices, quantity mismatches, and overbilling against actual deliveries.'},
{i:'\u26A1',t:'Intelligent Triage',d:'AI classifies every invoice into auto-approve, review, or block lanes. Configurable by role, authority level, and risk tolerance.'},
{i:'\uD83D\uDEE1\uFE0F',t:'15+ Anomaly Detectors',d:'Price overcharges, duplicates, tax fraud, stale invoices, round-number flags, weekend billing, and contract violations.'},
{i:'\uD83D\uDC65',t:'RBAC & Audit Trail',d:'JWT authentication, 4-tier authority matrix, and every action tracked with real user names for SOX compliance.'},
{i:'\u2699\uFE0F',t:'Configurable Policies',d:'Two-way or three-way matching, tolerance thresholds, and industry presets for manufacturing, services, and regulated industries.'},
{i:'\uD83D\uDCC8',t:'Vendor Risk Scoring',d:'Dynamic risk profiles based on anomaly history, correction frequency, and contract compliance. High-risk vendors get tighter controls.'}
].map((f,i)=>`<div class="cd" style="padding:28px;animation:fadeUp .5s cubic-bezier(.22,1,.36,1) ${i*0.08}s both"><div style="font-size:28px;margin-bottom:14px">${f.i}</div><div style="font-size:16px;font-weight:700;margin-bottom:8px;color:var(--tx)">${f.t}</div><div style="font-size:14px;color:var(--tm);line-height:1.65">${f.d}</div></div>`).join('')}</div></section>

<section style="padding:40px 56px 80px;max-width:800px;margin:0 auto;text-align:center;position:relative;z-index:10">
<div style="background:var(--ag);border:1px solid rgba(26,86,219,.12);border-radius:20px;padding:48px 40px">
<div style="font-size:28px;font-weight:800;color:var(--tx);margin-bottom:12px">Ready to stop overpaying?</div>
<div style="font-size:16px;color:var(--tm);margin-bottom:28px">Upload your first invoice and see AuditLens in action.</div>
<button class="bt bt-p" style="padding:14px 32px;font-size:16px;font-weight:700" data-go>Get Started Free \u2192</button>
</div></section>

<footer style="padding:36px 56px;border-top:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center;position:relative;z-index:10"><div style="font-size:13px;color:var(--td);font-weight:500">\u00A9 2026 AuditLens</div><div style="font-size:13px;color:var(--td)">Enterprise AP Automation</div></footer></div>`}

function statCard(icon,label,val,sub,color){return`<div class="cd" style="flex:1;min-width:175px;padding:22px 24px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="width:34px;height:34px;border-radius:9px;background:${color}12;display:flex;align-items:center;justify-content:center;color:${color};font-size:16px">${icon}</div><span style="font-size:12px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.06em">${label}</span></div><div style="font-size:26px;font-weight:700;letter-spacing:-.02em">${val}</div>${sub?`<div style="font-size:13px;color:var(--td);margin-top:5px">${sub}</div>`:''}</div>`}

function app(){
  const d=S.dash||{};const ag=(d.aging||{buckets:{},counts:{}});const rv=d.review_needed||0;const ac=d.anomaly_count||0;
  return`${S.proc?processing():''}${S.sel?modal():''}${S.toast?`<div class="tt">${I.ck} ${E(S.toast)}</div>`:''}
<div class="ly"><aside class="sidebar">
<div style="display:flex;align-items:center;gap:12px;padding:0 20px;margin-bottom:28px"><div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#dc2626,#ef4444);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(220,38,38,.25);flex-shrink:0"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/><path d="M12 22V12"/><path d="M2 7l10 5 10-5"/></svg></div><div><div style="font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--tx)">AuditLens</div><div style="font-size:10px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.1em">AP Intelligence</div></div></div>
<div style="padding:0 12px;flex:1;overflow-y:auto;min-height:0"><div style="font-size:11px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.08em;padding:0 16px;margin-bottom:10px">Navigation</div>
${(()=>{const ur=S.authUser?.role||S.currentRole||'analyst';const isAdmin=ur==='cfo'||ur==='vp';const isMgr=isAdmin||ur==='manager';const tabs=[{id:'dashboard',l:'Dashboard',i:I.chr},{id:'triage',l:'Triage',i:'\u26A1',b:S.dash.triage?.blocked||0,bc:'dg'},{id:'documents',l:'Documents',i:I.doc},{id:'anomalies',l:'Anomalies',i:I.wn,b:ac,bc:'dg'},{id:'matching',l:'PO Matching',i:I.lnk,b:rv,bc:'wn'},{id:'vendors',l:'Vendors',i:I.sh,b:S.dash.vendor_risk?.high_risk||0,bc:'dg'},{id:'contracts',l:'Contracts',i:I.ct},{id:'upload',l:'Upload',i:I.up}];if(isMgr)tabs.push({id:'settings',l:'AP Policy',i:'\u2699\uFE0F'});return tabs.map(t=>`<button class="sbi ${S.tab===t.id?'on':''}" data-tab="${t.id}">${t.i} ${t.l}${t.b?`<span style="margin-left:auto;background:var(--${t.bc||'wn'}b);color:var(--${t.bc||'wn'});font-size:12px;font-weight:700;padding:2px 7px;border-radius:10px">${t.b}</span>`:''}</button>`).join('')+(isAdmin?`
<div style="font-size:11px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.08em;padding:0 16px;margin:16px 0 6px">Admin</div>
<button class="sbi" data-act="seed" style="color:var(--ok);font-size:13px">${I.sp} Load Sample Data</button>
<button class="sbi" style="font-size:13px" data-act="export">${I.doc} Export</button>
<button class="sbi" style="font-size:13px" data-act="import">${I.up} Import</button>
<button class="sbi" data-act="reset" style="color:var(--dg);font-size:13px">${I.tr} Clear All Data</button>`:'')})()}</div>
${S.authUser?`<div style="padding:10px 16px;border-top:1px solid var(--bd);flex-shrink:0"><div style="display:flex;align-items:center;gap:8px"><div style="width:30px;height:30px;border-radius:50%;background:var(--ac);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0">${(S.authUser.name||'?')[0].toUpperCase()}</div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${E(S.authUser.name)} <span class="bg bg-s" style="font-size:10px;padding:2px 6px;vertical-align:middle">${{analyst:'Analyst',manager:'Manager',vp:'VP',cfo:'CFO'}[S.authUser.role]||S.authUser.role}</span></div><div style="font-size:10px;color:var(--td);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${E(S.authUser.email)}">${E(S.authUser.email)}</div></div><button class="bt bt-sm bt-g" data-act="logout" style="font-size:10px;padding:3px 8px;flex-shrink:0">Logout</button></div></div>`
:`<div style="padding:10px 16px;border-top:1px solid var(--bd);flex-shrink:0"><div style="display:flex;align-items:center;gap:6px"><select id="role-select" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--tx);font-size:11px;font-weight:600;cursor:pointer;font-family:var(--ft)">
<option value="analyst" ${S.currentRole==='analyst'?'selected':''}>AP Analyst</option>
<option value="manager" ${S.currentRole==='manager'?'selected':''}>AP Manager</option>
<option value="vp" ${S.currentRole==='vp'?'selected':''}>VP Finance</option>
<option value="cfo" ${S.currentRole==='cfo'?'selected':''}>CFO</option>
</select><button class="bt bt-sm bt-p" style="font-size:10px;padding:5px 8px" data-act="go-login">\u{1F512} Login</button></div></div>`}</aside>
<main class="mc">${S.tab==='dashboard'?dashboard(d,ag):S.tab==='triage'?triageTab():S.tab==='documents'?documents():S.tab==='anomalies'?anomaliesTab():S.tab==='matching'?matching():S.tab==='vendors'?vendorsTab():S.tab==='contracts'?contractsTab():S.tab==='settings'?((['cfo','vp','manager'].includes(S.authUser?.role||S.currentRole))?settingsTab():'<div class="fu" style="text-align:center;padding:60px"><h2>Access Restricted</h2><p style="color:var(--td)">Policy configuration requires Manager, VP, or CFO role.</p></div>'):upload()}</main></div>`}

function dashboard(d,ag){
  const bk=[{k:'current',l:'Current',c:'var(--al)'},{k:'1_30',l:'1-30',c:'var(--wn)'},{k:'31_60',l:'31-60',c:'#f97316'},{k:'61_90',l:'61-90',c:'var(--dg)'},{k:'90_plus',l:'90+',c:'#b91c1c'}];
  const mx=Math.max(...bk.map(b=>ag.buckets[b.k]||0),1);
  const tv=d.top_vendors||[];
  const sv=d.savings_discovered||0;
  const sb=d.savings_breakdown||{};
  const sp=d.processing_speed||{};
  const spd=sp.documents_with_timing?sp.avg_total_seconds:0;
  const sfactor=sp.speedup_factor;
  return`<div class="fu"><div style="margin-bottom:28px"><h1 style="font-size:26px;font-weight:800;letter-spacing:-.03em;margin-bottom:4px">Dashboard</h1><p style="font-size:15px;color:var(--tm)">Spend compliance overview</p></div>
${sv>0?`<div style="background:linear-gradient(135deg,#059669,#047857);border-radius:14px;padding:24px 30px;margin-bottom:20px;color:#fff;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px">
<div><div style="font-size:14.5px;opacity:.85;font-weight:500;margin-bottom:4px">\u2714 Total Savings Discovered</div><div style="font-size:38px;font-weight:800;letter-spacing:-.03em;line-height:1.1">${fmt(sv)}</div><div style="font-size:14px;opacity:.75;margin-top:6px">Across ${d.total_documents||0} documents processed</div></div>
<div style="display:flex;gap:20px;flex-wrap:wrap">${sb.overcharges?`<div style="text-align:center"><div style="font-size:20px;font-weight:700">${fmt(sb.overcharges)}</div><div style="font-size:12px;opacity:.75">Overcharges</div></div>`:''
}${sb.duplicates_prevented?`<div style="text-align:center"><div style="font-size:20px;font-weight:700">${fmt(sb.duplicates_prevented)}</div><div style="font-size:12px;opacity:.75">Duplicates</div></div>`:''
}${sb.contract_violations?`<div style="text-align:center"><div style="font-size:20px;font-weight:700">${fmt(sb.contract_violations)}</div><div style="font-size:12px;opacity:.75">Contract Violations</div></div>`:''
}${sb.unauthorized_items?`<div style="text-align:center"><div style="font-size:20px;font-weight:700">${fmt(sb.unauthorized_items)}</div><div style="font-size:12px;opacity:.75">Unauthorized</div></div>`:''
}${sb.early_payment_opportunities?`<div style="text-align:center"><div style="font-size:20px;font-weight:700">${fmt(sb.early_payment_opportunities)}</div><div style="font-size:12px;opacity:.75">Early Pay Savings</div></div>`:''
}</div></div>`:''}
${spd?`<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);border-radius:14px;padding:20px 30px;margin-bottom:20px;color:#fff;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px">
<div><div style="font-size:14.5px;opacity:.85;font-weight:500;margin-bottom:4px">\u26A1 Processing Speed</div><div style="font-size:34px;font-weight:800;letter-spacing:-.03em;line-height:1.1">${spd}s <span style="font-size:17px;opacity:.75">avg per document</span></div><div style="font-size:14px;opacity:.75;margin-top:4px">vs 15 min manual \u2014 <b>${sfactor}x faster</b></div></div>
<div style="display:flex;gap:20px;flex-wrap:wrap">
<div style="text-align:center"><div style="font-size:17px;font-weight:700">${sp.avg_extraction_ms||0}ms</div><div style="font-size:12px;opacity:.75">AI Extraction</div></div>
<div style="text-align:center"><div style="font-size:17px;font-weight:700">${sp.avg_matching_ms||0}ms</div><div style="font-size:12px;opacity:.75">PO Matching</div></div>
<div style="text-align:center"><div style="font-size:17px;font-weight:700">${sp.avg_anomaly_ms||0}ms</div><div style="font-size:12px;opacity:.75">Anomaly Detection</div></div>
<div style="text-align:center"><div style="font-size:17px;font-weight:700">${sp.avg_triage_ms||0}ms</div><div style="font-size:12px;opacity:.75">Triage</div></div>
</div></div>`:''}
<div style="display:flex;gap:14px;margin-bottom:20px;flex-wrap:wrap">${statCard(I.dl,'Total Outstanding',fmt(d.total_ar),`${d.unpaid_count||0} unpaid invoices`,'var(--al)')}${statCard(I.wn,'Open Anomalies',d.anomaly_count||0,d.high_severity?`${d.high_severity} high severity`:'\u2014','var(--dg)')}${statCard(I.sh,'Money at Risk',fmt(d.total_risk),d.anomaly_count?'From open anomalies':'\u2014','var(--wn)')}${statCard(I.ck,'Auto-Matched',d.auto_matched||0,`${d.review_needed||0} need review`,'var(--ok)')}</div>
<div style="display:flex;gap:14px;margin-bottom:20px;flex-wrap:wrap">${statCard('\u26A1','Auto-Approved',d.triage?.auto_approved||0,d.triage?.auto_approve_rate?d.triage.auto_approve_rate+'% rate':'Triage disabled','var(--ok)')}${statCard('\u26D4','Blocked',d.triage?.blocked||0,d.triage?.blocked_amount?fmt(d.triage.blocked_amount)+' held':'No blocked invoices','var(--dg)')}${statCard(I.sh,'High Risk Vendors',d.vendor_risk?.high_risk||0,d.vendor_risk?.worsening?d.vendor_risk.worsening+' worsening':'All stable','var(--wn)')}${statCard(I.sp,'Feedback Loop',d.correction_patterns||0,d.correction_patterns?'patterns learned for AI':'Corrections improve AI','var(--ok)')}</div>
<div class="g2"><div class="cd"><div style="display:flex;align-items:center;gap:8px;margin-bottom:24px"><span style="font-size:17px">${I.chr}</span><span style="font-size:15px;font-weight:700">AR Aging</span></div>
<div style="display:flex;gap:10px;align-items:flex-end;height:150px">${bk.map(b=>{const a=ag.buckets[b.k]||0,n=ag.counts[b.k]||0,h=Math.max(6,(a/mx)*110);return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px"><div style="font-size:12px;color:var(--tm);font-weight:600;font-family:var(--mn)">${fmt(a)}</div><div style="width:100%;max-width:56px;min-height:6px;height:${h}px;background:linear-gradient(180deg,${b.c},${b.c}44);border-radius:8px 8px 3px 3px;transition:height .6s"></div><div style="font-size:13px;color:var(--tm);font-weight:600">${b.l}</div><div style="font-size:12px;color:var(--td)">${n} inv</div></div>`}).join('')}</div></div>
<div class="cd"><div style="display:flex;align-items:center;gap:8px;margin-bottom:20px"><span style="font-size:15px">${I.dl}</span><span style="font-size:15px;font-weight:700">Top Vendors by Spend</span></div>
${tv.length===0?'<div style="text-align:center;padding:40px;color:var(--td)">No data yet</div>':tv.map((v,i)=>{const pct=tv[0].spend>0?(v.spend/tv[0].spend)*100:0;return`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px"><span style="color:var(--tm);font-weight:500">${E(v.vendor||'Unknown')}</span><span class="mn fb">${fmt(v.spend)}</span></div><div style="height:6px;background:var(--sa);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--ac),#7c3aed);border-radius:3px"></div></div></div>`}).join('')}</div></div>
<div class="cd" style="margin-top:16px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:20px"><span style="font-size:15px">${I.cl}</span><span style="font-size:15px;font-weight:700">Recent Activity</span></div>
${S.docs.length===0?'<div style="text-align:center;padding:40px;color:var(--td)">No documents yet \u2014 upload to start</div>':S.docs.slice(0,6).map(it=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:8px;cursor:pointer;background:var(--sa);margin-bottom:6px" data-view="${it.id}"><div><div style="font-size:14.5px;font-weight:600">${E(it.invoiceNumber||it.poNumber||it.contractNumber||it.grnNumber||it.id)}</div><div style="font-size:13px;color:var(--td)">${E(it.vendor)} \u00B7 ${D(it.issueDate)}</div></div><div style="display:flex;align-items:center;gap:10px"><span class="mn fb">${fmtx(it.amount,it.currency)}</span><span class="bg ${typBg(it.type)}">${typLabel(it.type)}</span></div></div>`).join('')}</div></div>`}

function documents(){
  return`<div class="fu"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><div><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">Documents</h1><p style="font-size:15px;color:var(--tm)">${S.docs.length} documents extracted</p></div><button class="bt bt-p" data-tab="upload">${I.up} Upload</button></div>
${S.docs.length===0?`<div class="cd" style="text-align:center;padding:60px"><p style="color:var(--td);margin-bottom:16px">No documents yet</p><button class="bt bt-p" data-tab="upload">Upload First Document</button></div>`:
`<div class="tw"><table><thead><tr><th>Type</th><th>Number</th><th>Vendor</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Currency</th><th>Date</th><th>Triage</th><th>Status</th><th>Conf.</th></tr></thead><tbody>
${S.docs.map(it=>{const num=it.invoiceNumber||it.poNumber||it.contractNumber||it.grnNumber||it.documentNumber||it.id;
return`<tr data-view="${it.id}"><td><span class="bg ${typBg(it.type)}">${typLabel(it.type)}</span></td><td class="mn fb">${E(num)}</td><td style="color:var(--tm);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${E(it.vendor)}</td><td class="mn" style="text-align:right">${it.subtotal?fmtx(it.subtotal,it.currency):'\u2014'}</td><td class="mn" style="text-align:right;color:var(--td)">${it.totalTax?fmtx(it.totalTax,it.currency):'\u2014'}</td><td class="mn fb" style="text-align:right">${fmtx(it.amount,it.currency)}</td><td><span class="bg bg-d">${it.currency||'USD'}</span></td><td style="color:var(--tm);font-size:14px">${D(it.issueDate)}</td><td>${it.triageLane?`<span class="bg ${laneBg(it.triageLane)}">${laneLabel(it.triageLane)}</span>`:'\u2014'}</td><td><span class="bg ${stBg(it.status)}">${it.status}</span></td><td>${SR(Math.round(it.confidence),36)}</td></tr>`}).join('')}
</tbody></table></div>`}</div>`}

function anomaliesTab(){
  const open=S.anomalies.filter(a=>a.status==='open');
  const resolved=S.anomalies.filter(a=>a.status!=='open');
  const risk=open.reduce((s,a)=>s+(a.amount_at_risk||0),0);
  return`<div class="fu"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><div><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">${I.wn} Anomalies</h1><p style="font-size:15px;color:var(--tm)">${open.length} open \u00B7 ${resolved.length} resolved \u00B7 ${fmt(risk)} at risk</p></div></div>
${open.length===0&&resolved.length===0?`<div class="cd" style="text-align:center;padding:60px"><div style="font-size:44px;margin-bottom:16px">${I.ck}</div><p style="color:var(--td)">No anomalies detected. Upload invoices with matching POs and contracts to start auditing.</p></div>`:
`${open.length>0?`<div style="margin-bottom:28px"><div style="font-size:14.5px;font-weight:700;color:var(--dg);margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">${I.wn} Open (${open.length})</div>
${open.map(a=>`<div class="anomaly-card sev-${a.severity||'low'}">
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="bg ${sevBg(a.severity)}">${a.severity}</span><span class="bg bg-d">${(a.type||'').replace(/_/g,' ')}</span><span style="font-size:14px;color:var(--tm)">${E(a.invoiceNumber)} \u00B7 ${E(a.vendor)}</span></div><div class="mn fb" style="color:var(--dg);font-size:15px">${a.amount_at_risk>=0?fmtx(a.amount_at_risk,a.currency||'USD'):fmtx(Math.abs(a.amount_at_risk),a.currency||'USD')+' savings'}</div></div>
<div style="font-size:14.5px;color:var(--tx);line-height:1.5;margin-bottom:8px">${E(a.description)}</div>
${a.contract_clause?`<div style="font-size:13px;color:var(--al);background:var(--ag);padding:6px 10px;border-radius:6px;margin-bottom:8px">${I.ct} ${E(a.contract_clause)}</div>`:''}
${a.recommendation?`<div style="font-size:14px;color:var(--ok);margin-bottom:10px">${I.ck} ${E(a.recommendation)}</div>`:''}
<div style="display:flex;gap:8px"><button class="bt bt-sm" style="background:var(--okb);color:var(--ok);border:1px solid rgba(16,185,129,.2)" data-resolve="${a.id}">${I.ck} Resolve</button><button class="bt bt-sm bt-g" data-dismiss="${a.id}">${I.x} Dismiss</button></div></div>`).join('')}</div>`:''}
${resolved.length>0?`<div><div style="font-size:14.5px;font-weight:700;color:var(--tm);margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">${I.ck} Resolved / Dismissed (${resolved.length})</div>
${resolved.slice(0,10).map(a=>`<div class="anomaly-card" style="opacity:.6"><div style="display:flex;justify-content:space-between;align-items:center"><div style="display:flex;gap:8px;align-items:center"><span class="bg ${stBg(a.status)}">${a.status}</span><span class="bg bg-d">${(a.type||'').replace(/_/g,' ')}</span><span style="font-size:14px;color:var(--tm)">${E(a.invoiceNumber)} \u00B7 ${E(a.vendor)}</span></div><span class="mn" style="color:var(--td)">${fmtx(Math.abs(a.amount_at_risk||0),a.currency||'USD')}</span></div></div>`).join('')}</div>`:''}`}</div>`}

function matching(){
  const mt=S.matches.filter(m=>m.status==='auto_matched').length,rv=S.matches.filter(m=>m.status==='review_needed');
  const tw=S.matches.filter(m=>m.matchType==='three_way').length,nw=S.matches.length-tw;
  return`<div class="fu"><div style="margin-bottom:24px"><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">${I.lnk} PO Matching</h1><p style="font-size:15px;color:var(--tm)">${mt} auto-matched \u00B7 ${rv.length} need review \u00B7 <span style="color:${tw>0?'var(--ok)':'var(--td)'}"><b>${tw}</b> three-way</span> \u00B7 <span style="color:var(--td)">${nw} two-way</span></p></div>
${S.matches.length===0?`<div class="cd" style="text-align:center;padding:60px"><p style="color:var(--td)">No matches yet. Upload invoices with PO references.</p></div>`:
`<div class="tw"><table><thead><tr><th>Invoice</th><th>Vendor</th><th>Invoice Amt</th><th>${I.ar} PO</th><th>PO Amt</th><th>Match</th><th>Fulfilled</th><th>Score</th><th>Status</th><th>Actions</th></tr></thead><tbody>
${S.matches.map(m=>{const oi=m.overInvoiced;const fulPct=m.poAmount>0?Math.round(((m.poAlreadyInvoiced||0)+m.invoiceAmount)/m.poAmount*100):0;const is3w=m.matchType==='three_way';
return`<tr><td class="mn fb">${E(m.invoiceNumber)}</td><td style="color:var(--tm)">${E(m.vendor)}</td><td class="mn fb">${fmtx(m.invoiceAmount)}</td><td class="mn" style="color:var(--al)">${E(m.poNumber)}</td><td class="mn">${fmtx(m.poAmount)}</td><td><span class="bg ${is3w?'bg-s':'bg-d'}" title="${is3w?'PO + GRN + Invoice matched':'PO + Invoice only — no goods receipt'}">${is3w?'\u2705 3-Way':'\u{1F4C4} 2-Way'}</span>${is3w&&m.grnNumbers?`<div style="font-size:11px;color:var(--td);margin-top:2px">${m.grnNumbers.join(', ')}</div>`:''}</td><td><div style="display:flex;align-items:center;gap:6px"><div style="width:60px;height:5px;background:var(--sa);border-radius:3px;overflow:hidden"><div style="height:100%;width:${Math.min(fulPct,100)}%;background:${oi?'var(--dg)':fulPct>90?'var(--wn)':'var(--ok)'};border-radius:3px"></div></div><span class="mn" style="font-size:12px;color:${oi?'var(--dg)':'var(--tm)'}">${fulPct}%</span></div></td><td>${SR(m.matchScore,36)}</td><td><span class="bg ${m.status==='auto_matched'?'bg-s':'bg-w'}">${m.status==='auto_matched'?'matched':'review'}</span>${oi?'<span class="bg bg-e" style="margin-left:4px">OVER</span>':''}</td><td>${m.status==='review_needed'?`<button class="bt bt-sm bt-p" data-appr="${m.id}" style="margin-right:4px">${I.ck}</button><button class="bt bt-sm bt-g" data-rej="${m.id}">${I.x}</button>`:'\u2014'}</td></tr>`}).join('')}
</tbody></table></div>`}</div>`}

function triageTab(){
  const t=S.dash.triage||{};const inv=S.docs.filter(d=>d.type==='invoice'||d.type==='credit_note'||d.type==='debit_note');
  const auto=inv.filter(i=>i.triageLane==='AUTO_APPROVE');
  const review=inv.filter(i=>i.triageLane==='REVIEW');
  const blocked=inv.filter(i=>i.triageLane==='BLOCK');
  const pct=inv.length>0?Math.round(auto.length/inv.length*100):0;
  const roleNames={analyst:'AP Analyst',manager:'AP Manager',vp:'VP Finance',cfo:'CFO'};
  const roleLimits={analyst:'$10K',manager:'$100K',vp:'$500K',cfo:'Unlimited'};
  const roleColors={analyst:'var(--wn)',manager:'var(--al)',vp:'var(--ok)',cfo:'#7c3aed'};
  const rl=S.currentRole||'analyst';
  return`<div class="fu"><div style="margin-bottom:24px"><div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px"><div><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">\u26A1 Agentic Triage</h1><p style="font-size:15px;color:var(--tm)">AI classifies invoices into Auto-Approve, Review, or Block lanes</p></div>
<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:${roleColors[rl]}12;border:1px solid ${roleColors[rl]}30;border-radius:10px"><div style="width:34px;height:34px;border-radius:50%;background:${roleColors[rl]}20;display:flex;align-items:center;justify-content:center;font-size:16px">\u{1F464}</div><div><div style="font-size:14px;font-weight:700;color:${roleColors[rl]}">${roleNames[rl]||rl}</div><div style="font-size:12px;color:var(--td)">Authority: ${roleLimits[rl]}</div></div></div></div></div>
<div style="display:flex;gap:14px;margin-bottom:24px;flex-wrap:wrap">
${statCard('\u2713','Auto-Approved',auto.length,`${pct}% rate \u00B7 ${fmt(t.auto_approved_amount||0)} processed`,'var(--ok)')}
${statCard('\uD83D\uDD0D','Review Queue',review.length,review.length?'Awaiting human review':'Queue empty','var(--wn)')}
${statCard('\u26D4','Blocked',blocked.length,blocked.length?fmt(t.blocked_amount||0)+' held':'No blocked invoices','var(--dg)')}</div>
${blocked.length>0?`<div style="margin-bottom:24px"><div style="font-size:14.5px;font-weight:700;color:var(--dg);margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">\u26D4 Blocked Invoices (${blocked.length})</div>
${blocked.map(i=>`<div class="anomaly-card sev-high" data-view="${i.id}" style="cursor:pointer">
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px"><div style="display:flex;gap:8px;align-items:center"><span class="bg bg-e">\u26D4 BLOCKED</span><span class="mn fb" style="font-size:14.5px">${E(i.invoiceNumber||i.id)}</span><span style="font-size:14px;color:var(--tm)">${E(i.vendor)}</span></div><span class="mn fb" style="color:var(--dg)">${fmtx(i.amount,i.currency)}</span></div>
${(i.triageReasons||[]).map(r=>`<div style="font-size:14px;color:var(--tm);line-height:1.5;padding:2px 0">${E(r)}</div>`).join('')}
<div style="display:flex;gap:6px;margin-top:8px;align-items:center"><span style="font-size:13px;color:var(--td)">Vendor Risk: </span><span class="bg ${riskBg(i.vendorRiskLevel||'medium')}">${riskIcon(i.vendorRiskLevel)} ${Math.round(i.vendorRiskScore||0)}</span>
<button class="bt bt-sm" style="margin-left:auto;background:var(--okb);color:var(--ok);border:1px solid rgba(16,185,129,.2)" data-override="${i.id}:AUTO_APPROVE">\u2713 Approve</button><button class="bt bt-sm bt-s" data-override="${i.id}:REVIEW">\uD83D\uDD0D Move to Review</button></div></div>`).join('')}</div>`:''}
${review.length>0?`<div style="margin-bottom:24px"><div style="font-size:14.5px;font-weight:700;color:var(--wn);margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">\uD83D\uDD0D Review Queue (${review.length})</div>
${review.map(i=>`<div class="anomaly-card sev-medium" data-view="${i.id}" style="cursor:pointer">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="display:flex;gap:8px;align-items:center"><span class="bg bg-w">\uD83D\uDD0D REVIEW</span><span class="mn fb" style="font-size:14.5px">${E(i.invoiceNumber||i.id)}</span><span style="font-size:14px;color:var(--tm)">${E(i.vendor)}</span></div><span class="mn fb">${fmtx(i.amount,i.currency)}</span></div>
${(i.triageReasons||[]).slice(0,2).map(r=>`<div style="font-size:13px;color:var(--tm);line-height:1.4">${E(r)}</div>`).join('')}
<div style="display:flex;gap:6px;margin-top:6px"><button class="bt bt-sm" style="background:var(--okb);color:var(--ok);border:1px solid rgba(16,185,129,.2)" data-override="${i.id}:AUTO_APPROVE">\u2713 Approve</button><button class="bt bt-sm" style="background:var(--dgb);color:var(--dg);border:1px solid rgba(239,68,68,.2)" data-override="${i.id}:BLOCK">\u26D4 Block</button></div></div>`).join('')}</div>`:''}
${auto.length>0?`<div><div style="font-size:14.5px;font-weight:700;color:var(--ok);margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">\u2713 Auto-Approved (${auto.length})</div>
<div class="tw"><table><thead><tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Confidence</th><th>Vendor Risk</th><th>Time</th></tr></thead><tbody>
${auto.slice(0,15).map(i=>`<tr data-view="${i.id}"><td class="mn fb">${E(i.invoiceNumber||i.id)}</td><td style="color:var(--tm)">${E(i.vendor)}</td><td class="mn fb">${fmtx(i.amount,i.currency)}</td><td>${SR(Math.round(i.triageConfidence||i.confidence),32)}</td><td><span class="bg ${riskBg(i.vendorRiskLevel||'low')}">${riskIcon(i.vendorRiskLevel)} ${Math.round(i.vendorRiskScore||0)}</span></td><td style="font-size:13px;color:var(--td)">${D(i.autoApprovedAt||i.triageAt)}</td></tr>`).join('')}
</tbody></table></div></div>`:''}
${inv.length===0?`<div class="cd" style="text-align:center;padding:60px"><div style="font-size:44px;margin-bottom:16px">\u26A1</div><p style="color:var(--td);margin-bottom:8px">No invoices triaged yet</p><p style="font-size:14px;color:var(--td)">Upload invoices to see AI triage in action</p></div>`:''}</div>`}

function vendorsTab(){
  const v=S.vendors||[];const hr=v.filter(x=>x.riskLevel==='high');const mr=v.filter(x=>x.riskLevel==='medium');const lr=v.filter(x=>x.riskLevel==='low');
  return`<div class="fu"><div style="margin-bottom:24px"><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">${I.sh} Vendor Risk</h1><p style="font-size:15px;color:var(--tm)">${v.length} vendors tracked \u00B7 ${hr.length} high risk \u00B7 ${mr.length} medium \u00B7 ${lr.length} low</p></div>
${v.length===0?`<div class="cd" style="text-align:center;padding:60px"><div style="font-size:44px;margin-bottom:16px">${I.sh}</div><p style="color:var(--td)">No vendor data yet. Upload invoices to start tracking.</p></div>`:
`<div class="tw"><table><thead><tr><th>Vendor</th><th>Risk Score</th><th>Level</th><th>Trend</th><th>Invoices</th><th>Open Anomalies</th><th>Total Spend</th><th>Top Factor</th></tr></thead><tbody>
${v.map(vd=>{const topFactor=vd.factors?Object.entries(vd.factors).sort((a,b)=>(b[1].score||0)-(a[1].score||0))[0]:null;
return`<tr><td style="font-weight:600">${E(vd.vendorDisplay||vd.vendorNormalized)}</td><td><div style="display:flex;align-items:center;gap:8px"><div style="width:50px;height:6px;background:var(--sa);border-radius:3px;overflow:hidden"><div style="height:100%;width:${Math.min(vd.riskScore||0,100)}%;background:${vd.riskLevel==='high'?'var(--dg)':vd.riskLevel==='medium'?'var(--wn)':'var(--ok)'};border-radius:3px"></div></div><span class="mn fb" style="font-size:14px;color:${vd.riskLevel==='high'?'var(--dg)':vd.riskLevel==='medium'?'var(--wn)':'var(--ok)'}">${Math.round(vd.riskScore||0)}</span></div></td><td><span class="bg ${riskBg(vd.riskLevel)}">${riskIcon(vd.riskLevel)} ${vd.riskLevel}</span></td><td style="font-size:14px">${trendIcon(vd.trend)} ${vd.trend||'stable'}</td><td class="mn" style="text-align:center">${vd.invoiceCount||0}</td><td style="text-align:center">${vd.openAnomalies?`<span class="bg bg-e">${vd.openAnomalies}</span>`:'<span style="color:var(--ok)">\u2713</span>'}</td><td class="mn fb">${fmt(vd.totalSpend||0)}</td><td style="font-size:13px;color:var(--td)">${topFactor?`${topFactor[0].replace(/_/g,' ')} (${Math.round(topFactor[1].score)})`:'\u2014'}</td></tr>`}).join('')}
</tbody></table></div>`}</div>`}

function contractsTab(){
  const contracts=S.docs.filter(d=>d.type==='contract');
  return`<div class="fu"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><div><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">${I.ct} Contracts</h1><p style="font-size:15px;color:var(--tm)">${contracts.length} vendor contracts</p></div><button class="bt bt-p" data-tab="upload">${I.up} Upload Contract</button></div>
${contracts.length===0?`<div class="cd" style="text-align:center;padding:60px"><div style="font-size:44px;margin-bottom:16px">${I.ct}</div><p style="color:var(--td);margin-bottom:8px">No contracts uploaded yet</p><p style="font-size:14px;color:var(--td)">Upload vendor contracts to enable contract pricing compliance checks</p></div>`:
contracts.map(c=>`<div class="cd" style="margin-bottom:12px;cursor:pointer" data-view="${c.id}">
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px"><div><div style="font-size:17px;font-weight:700">${E(c.contractNumber||c.id)}</div><div style="font-size:14.5px;color:var(--tm)">${E(c.vendor)}</div></div><span class="bg bg-s">Active</span></div>
${c.pricingTerms&&c.pricingTerms.length?`<div style="margin-bottom:12px"><div style="font-size:13px;color:var(--td);font-weight:600;text-transform:uppercase;margin-bottom:6px">Pricing Terms</div>${c.pricingTerms.map(pt=>`<div style="display:flex;justify-content:space-between;padding:6px 10px;background:var(--sa);border-radius:6px;margin-bottom:4px;font-size:14px"><span style="color:var(--tm)">${E(pt.item)}</span><span class="mn fb">${fmtx(pt.rate,c.currency)} / ${pt.unit||'unit'}</span></div>`).join('')}</div>`:''}
${c.contractTerms?`<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:14px;color:var(--td)">${c.contractTerms.effective_date?`<span>Effective: ${D(c.contractTerms.effective_date)}</span>`:''}${c.contractTerms.expiry_date?`<span>Expires: ${D(c.contractTerms.expiry_date)}</span>`:''}${c.contractTerms.auto_renewal?'<span class="bg bg-w">Auto-Renew</span>':''}${c.contractTerms.liability_cap?`<span>Liability Cap: ${fmtx(c.contractTerms.liability_cap,c.currency)}</span>`:''}</div>`:''}
<div style="margin-top:8px;font-size:13px;color:var(--td)">Payment: ${c.paymentTerms||'\u2014'} \u00B7 ${c.currency||'USD'}</div></div>`).join('')}</div>`}

function settingsTab(){
  const p=S.policy||{};const mm=p.matching_mode||'flexible';
  const presetInfo={manufacturing:{n:'Manufacturing',d:'Strict 3-way, tight tolerances',i:'\uD83C\uDFED'},services:{n:'Services / SaaS',d:'2-way matching, wider tolerances',i:'\uD83D\uDCBB'},enterprise_default:{n:'Enterprise Default',d:'Flexible — 3-way when GRN available',i:'\uD83C\uDFE2'},strict_audit:{n:'Strict Audit',d:'Maximum controls, regulated industries',i:'\uD83D\uDD12'}};
  function row(label,key,type,opts){
    const v=p[key];
    if(type==='select') return`<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--sa);border-radius:8px;margin-bottom:6px"><div><div style="font-size:14px;font-weight:600">${label}</div></div><select data-policy="${key}" style="padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);font-size:13px;font-weight:600">${opts.map(o=>`<option value="${o.v}" ${v===o.v?'selected':''}>${o.l}</option>`).join('')}</select></div>`;
    if(type==='toggle') return`<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--sa);border-radius:8px;margin-bottom:6px"><div style="font-size:14px;font-weight:600">${label}</div><button data-policy-toggle="${key}" class="bt bt-sm ${v?'bt-p':'bt-g'}" style="min-width:50px">${v?'ON':'OFF'}</button></div>`;
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--sa);border-radius:8px;margin-bottom:6px"><div style="font-size:14px;font-weight:600">${label}</div><input data-policy="${key}" type="number" value="${v||0}" step="${type==='pct'?'0.5':'1'}" style="width:80px;padding:6px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);font-size:13px;text-align:right;font-weight:600"></div>`;
  }
  return`<div class="fu"><div style="margin-bottom:24px"><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">\u2699\uFE0F AP Policy Configuration</h1><p style="font-size:15px;color:var(--tm)">Configure matching rules, tolerances, and approval thresholds for your organization</p></div>
<div style="display:flex;gap:10px;margin-bottom:24px;flex-wrap:wrap">${Object.entries(presetInfo).map(([k,v])=>`<button class="bt bt-sm ${mm===POLICY_PRESETS_MAP[k]?'bt-p':'bt-g'}" data-preset="${k}" style="padding:10px 16px"><div style="font-size:15px">${v.i}</div><div style="font-size:13px;font-weight:700">${v.n}</div><div style="font-size:11px;color:var(--td);margin-top:2px">${v.d}</div></button>`).join('')}</div>
<div class="cd" style="padding:20px;margin-bottom:16px"><div style="font-size:14px;font-weight:700;color:var(--tm);margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em">\uD83D\uDD17 Matching Mode</div>
${row('Matching Mode','matching_mode','select',[{v:'two_way',l:'\uD83D\uDCDD Two-Way (PO + Invoice)'},{v:'three_way',l:'\u2705 Three-Way (PO + GRN + Invoice)'},{v:'flexible',l:'\uD83D\uDD04 Flexible (3-way if GRN exists)'}])}
${row('Require GRN for Auto-Approve','require_grn_for_auto_approve','toggle')}
${row('Require PO for Auto-Approve','require_po_for_auto_approve','toggle')}</div>
<div class="cd" style="padding:20px;margin-bottom:16px"><div style="font-size:14px;font-weight:700;color:var(--tm);margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em">\uD83D\uDCCF Tolerance Thresholds (%)</div>
${row('Amount Tolerance','amount_tolerance_pct','pct')}
${row('Price Tolerance','price_tolerance_pct','pct')}
${row('Over-Invoice Threshold','over_invoice_pct','pct')}
${row('Tax Tolerance','tax_tolerance_pct','pct')}
${row('GRN Qty Tolerance','grn_qty_tolerance_pct','pct')}
${row('GRN Amount Tolerance','grn_amount_tolerance_pct','pct')}
${row('Short Shipment Flag Below','short_shipment_threshold_pct','pct')}</div>
<div class="cd" style="padding:20px;margin-bottom:16px"><div style="font-size:14px;font-weight:700;color:var(--tm);margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em">\u26A1 Triage Rules</div>
${row('Min Confidence for Auto-Approve','auto_approve_min_confidence','pct')}
${row('Max Vendor Risk for Auto-Approve','auto_approve_max_vendor_risk','pct')}
${row('Block Above Vendor Risk Score','block_min_vendor_risk','pct')}
${row('Duplicate Window (days)','duplicate_window_days','int')}</div>
<div class="cd" style="padding:20px;margin-bottom:16px"><div style="font-size:14px;font-weight:700;color:var(--tm);margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em">\uD83D\uDEE1\uFE0F Invoice Controls</div>
${row('Flag Round Number Invoices','flag_round_number_invoices','toggle')}
${row('Flag Weekend Invoices','flag_weekend_invoices','toggle')}
${row('Max Invoice Age (days)','max_invoice_age_days','int')}</div>
<div style="display:flex;gap:10px"><button class="bt bt-p" data-act="save-policy">\u2714 Save Policy</button><button class="bt bt-g" data-act="reset-policy">\u21BA Reset to Default</button></div></div>`}
const POLICY_PRESETS_MAP={manufacturing:'three_way',services:'two_way',enterprise_default:'flexible',strict_audit:'three_way'};

function upload(){return`<div class="fu"><div style="margin-bottom:24px"><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">${I.up} Upload Document</h1><p style="font-size:15px;color:var(--tm)">Upload invoices, POs, GRNs, contracts, or credit/debit notes</p></div>
<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">${['auto','invoice','purchase_order','contract','goods_receipt','credit_note','debit_note'].map(t=>`<button class="bt bt-sm ${S.ut===t?'bt-p':'bt-g'}" data-ut="${t}">${{auto:'Auto-Detect',invoice:'Invoice',purchase_order:'Purchase Order',contract:'Contract',goods_receipt:'Goods Receipt',credit_note:'Credit Note',debit_note:'Debit Note'}[t]}</button>`).join('')}</div>
<div class="uz" id="uz"><div style="font-size:44px;margin-bottom:16px">${I.up}</div><div style="font-size:17px;font-weight:700;margin-bottom:8px">Drop files here or click to upload</div><div style="font-size:14.5px;color:var(--td);margin-bottom:16px">PDF, JPEG, PNG \u2014 single or multiple files supported</div>
<span class="bg bg-i">${I.sp} ${S.api==='claude_api'?'AI Extraction Active':'Sandbox Mode'}</span>
<input type="file" id="fi" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff" multiple style="display:none"></div>
<div class="cd" style="margin-top:24px;padding:22px"><div style="font-size:14px;font-weight:700;color:var(--tm);margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em">How AuditLens Works</div>
${[{n:'1',t:'Upload',d:'Invoices, POs, contracts, credit/debit notes'},{n:'2',t:'AI Extract',d:'Claude extracts all fields including tax, subtotal, pricing terms'},{n:'3',t:'Match & Audit',d:'Auto-match to POs, cross-reference contracts, detect anomalies'},{n:'4',t:'Review & Resolve',d:'See anomalies with risk amounts, resolve or dispute'}].map(s=>`<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px"><div style="width:28px;height:28px;border-radius:8px;flex-shrink:0;background:var(--ag);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--al);font-family:var(--mn)">${s.n}</div><div><div style="font-size:14.5px;font-weight:600">${s.t}</div><div style="font-size:14px;color:var(--td);margin-top:2px">${s.d}</div></div></div>`).join('')}</div></div>`}

function processing(){const st=['Reading document','Extracting fields & line items','Matching to purchase orders','Cross-referencing contracts','Running anomaly detection','Computing confidence score'];const cs=S.proc?S.proc.st:0;const isBulk=S.proc&&S.proc.total>1;
return`<div class="po"><div class="cd" style="padding:44px 52px;text-align:center;max-width:440px;border:1px solid rgba(26,86,219,.15);box-shadow:0 16px 48px rgba(0,0,0,.12)"><div style="width:52px;height:52px;border-radius:14px;margin:0 auto 20px;background:linear-gradient(135deg,var(--ac),#3b82f6);display:flex;align-items:center;justify-content:center;animation:pulse 1.5s ease-in-out infinite;color:#fff;font-size:20px">${I.sp}</div><div style="font-size:17px;font-weight:700;margin-bottom:6px">${isBulk?`Processing ${S.proc.cur} of ${S.proc.total}`:'Analyzing Document'}</div><div style="font-size:13px;color:var(--td);margin-bottom:20px">${E(S.proc.fn)}</div>
${isBulk?`<div style="height:6px;background:var(--sa);border-radius:3px;overflow:hidden;margin-bottom:16px"><div style="height:100%;width:${Math.round(S.proc.cur/S.proc.total*100)}%;background:var(--ok);border-radius:3px;transition:width .3s"></div></div>`:''}
<div style="text-align:left">${st.map((s,i)=>`<div style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:5px;color:${i<=cs?'var(--ok)':'var(--td)'}"><span style="font-size:12px">${i<=cs?I.ck:'\u25CB'}</span> ${s}</div>`).join('')}</div>
<div style="height:3px;background:var(--sa);border-radius:2px;overflow:hidden;margin-top:20px"><div style="height:100%;background:linear-gradient(90deg,var(--ac),#3b82f6);border-radius:2px;animation:loading 1.8s ease-in-out infinite"></div></div></div></div>`}

function modal(){const it=S.sel;if(!it)return'';const iv=it.type==='invoice';const isCtr=it.type==='contract';const cur=it.currency||'USD';
const docAnoms=S.anomalies.filter(a=>a.invoiceId===it.id&&a.status==='open');
const hasFile=!!it.uploadedFile;
const fileUrl=hasFile?`/api/uploads/${encodeURIComponent(it.uploadedFile)}`:'';
const isPdf=hasFile&&it.uploadedFile.toLowerCase().endsWith('.pdf');
const isImg=hasFile&&/\.(jpg|jpeg|png|webp|gif|tiff)$/i.test(it.uploadedFile);
const vm=hasFile?S.modalView||'split':'data';
const ed=S.editing;
const ef=S.editFields;
// Editable field helper
function ef_val(key,orig){return ed&&ef[key]!==undefined?ef[key]:orig}
function eField(label,key,val,type='text'){
  const v=ef_val(key,val);
  if(!ed)return`<div><div style="font-size:12px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${label}</div><div style="font-size:14.5px;font-weight:600">${E(String(v||'\u2014'))}</div></div>`;
  return`<div><div style="font-size:12px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${label}</div><input type="${type}" value="${E(String(v||''))}" data-ef="${key}" style="width:100%;padding:5px 8px;background:var(--sa);border:1px solid var(--ac);border-radius:6px;color:var(--tx);font-size:14px;font-family:var(--ft);outline:none" /></div>`}
function roField(label,val){return`<div><div style="font-size:12px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${label}</div><div style="font-size:14.5px;font-weight:600">${E(String(val||'\u2014'))}</div></div>`}

return`<div class="mo" data-cls><div class="cd" style="padding:0;max-width:${vm==='split'?'1100':'620'}px;width:96%;max-height:90vh;overflow:hidden;border:1px solid var(--bh);display:flex;flex-direction:column" onclick="event.stopPropagation()">
<div style="padding:16px 24px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="bg ${typBg(it.type)}">${typLabel(it.type)}</span><span style="font-size:18px;font-weight:700">${E(it.invoiceNumber||it.poNumber||it.contractNumber||it.grnNumber||it.documentNumber||it.id)}</span><span class="bg bg-d">${cur}</span>
${it.manuallyVerified?'<span class="bg bg-s">\u2713 Verified</span>':''}
${it.triageLane?`<span class="bg ${laneBg(it.triageLane)}">${laneLabel(it.triageLane)}</span>`:''}
${it.vendorRiskLevel?`<span class="bg ${riskBg(it.vendorRiskLevel)}">${riskIcon(it.vendorRiskLevel)} Risk: ${Math.round(it.vendorRiskScore||0)}</span>`:''}
${hasFile?`<div style="display:flex;gap:4px"><button class="bt bt-sm ${vm==='split'?'bt-p':'bt-g'}" data-mview="split" style="padding:4px 10px;font-size:13px">\uD83D\uDD0D Verify</button><button class="bt bt-sm ${vm==='data'?'bt-p':'bt-g'}" data-mview="data" style="padding:4px 10px;font-size:13px">\uD83D\uDCCB Data</button></div>`:''}</div>
<div style="display:flex;align-items:center;gap:8px">
${ed?`<button class="bt bt-sm bt-p" data-act="save-edit">${I.ck} Save</button><button class="bt bt-sm bt-g" data-act="cancel-edit">${I.x} Cancel</button>`
:`<button class="bt bt-sm bt-s" data-act="start-edit">${I.fx} Edit</button>`}
<button style="background:none;border:none;color:var(--tm);cursor:pointer;font-size:20px" data-cls>${I.x}</button></div></div>
${ed?'<div style="padding:6px 24px;background:#eff6ff;border-bottom:1px solid #bfdbfe;font-size:14px;color:var(--al);font-weight:500;flex-shrink:0">\u270F\uFE0F Edit mode \u2014 click any highlighted field to correct. Save will re-run anomaly detection.</div>':''}
<div style="display:flex;flex:1;overflow:hidden;min-height:0">
${vm==='split'&&hasFile?`<div style="flex:1;border-right:1px solid var(--bd);display:flex;flex-direction:column;min-width:0">
<div style="padding:8px 16px;background:var(--sa);border-bottom:1px solid var(--bd);flex-shrink:0;display:flex;align-items:center;justify-content:space-between"><span style="font-size:13px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:.06em">\uD83D\uDCC4 Original Document</span><a href="${fileUrl}" target="_blank" style="font-size:13px;color:var(--al);text-decoration:none">Open in new tab \u2197</a></div>
<div style="flex:1;overflow:auto;background:#f8f9fa">
${isPdf?`<iframe src="${fileUrl}" style="width:100%;height:100%;border:none;min-height:500px"></iframe>`:
isImg?`<img src="${fileUrl}" style="width:100%;height:auto;display:block">`:
`<div style="padding:40px;text-align:center;color:var(--td)">Preview not available.<br><a href="${fileUrl}" target="_blank" style="color:var(--al)">Download</a></div>`}
</div></div>`:''}
<div style="flex:1;overflow-y:auto;min-width:0">
${vm==='split'?`<div style="padding:8px 16px;background:var(--sa);border-bottom:1px solid var(--bd);flex-shrink:0"><span style="font-size:13px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:.06em">${I.sp} Extracted Data \u2014 ${Math.round(it.confidence)}% confidence</span></div>`:``}
<div style="padding:20px 24px">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
${eField('Vendor','vendor',it.vendor)}
${eField('Subtotal','subtotal',it.subtotal,'number')}
${roField('Tax',it.totalTax?fmtx(it.totalTax,cur)+' ('+(it.taxDetails||[]).map(t=>t.type+' '+t.rate+'%').join(', ')+')':'\u2014')}
${roField('Total',fmtx(it.amount,cur))}
${eField('Issued','issueDate',it.issueDate,'date')}
${eField(iv?'Due':'Delivery',iv?'dueDate':'deliveryDate',iv?it.dueDate:it.deliveryDate,'date')}
${roField('Status',(it.status||'').replace(/_/g,' ').toUpperCase())}
${roField('Confidence',Math.round(it.confidence)+'%')}
${it.confidenceFactors?`<div style="margin:0 0 8px 0;padding:8px 12px;background:var(--sa);border:1px solid var(--bd);border-radius:8px"><div style="font-size:12px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Confidence Breakdown</div>${Object.entries(it.confidenceFactors).map(([k,v])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px;border-bottom:1px solid var(--bd)"><span style="color:var(--tm)">${k.replace(/_/g,' ')}<span style="color:var(--td);font-size:12px;margin-left:4px">(${Math.round(v.weight*100)}%)</span></span><div style="display:flex;align-items:center;gap:6px"><div style="width:60px;height:4px;background:var(--bd);border-radius:2px;overflow:hidden"><div style="width:${v.score}%;height:100%;background:${v.score>=80?'var(--ok)':v.score>=50?'var(--wn)':'var(--dg)'};border-radius:2px"></div></div><span class="mn fb" style="color:${v.score>=80?'var(--ok)':v.score>=50?'var(--wn)':'var(--dg)'};min-width:24px;text-align:right">${v.score}</span></div></div>`).join('')}</div>`:''}
${roField('Source',it.extractionSource==='claude_api'?'Claude API':'Mock')}
${eField('Terms','paymentTerms',it.paymentTerms)}
${eField('Currency','currency',it.currency)}
${iv?eField('PO Reference','poReference',it.poReference):''}
</div>
${it.triageLane&&it.triageReasons?`<div style="margin-bottom:12px;padding:10px 14px;background:${it.triageLane==='AUTO_APPROVE'?'#ecfdf5':it.triageLane==='BLOCK'?'#fef2f2':'#fffbeb'};border:1px solid ${it.triageLane==='AUTO_APPROVE'?'#a7f3d0':it.triageLane==='BLOCK'?'#fecaca':'#fde68a'};border-radius:10px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span class="bg ${laneBg(it.triageLane)}">${laneLabel(it.triageLane)}</span><span style="font-size:13px;color:var(--td)">AI Triage \u00B7 ${Math.round(it.triageConfidence||0)}% confidence</span></div>${(it.triageReasons||[]).map(r=>`<div style="font-size:14px;color:var(--tm);line-height:1.6;padding:1px 0">\u2022 ${E(r)}</div>`).join('')}</div>`:''}
${it.earlyPaymentDiscount?`<div style="margin-bottom:12px;padding:8px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;font-size:14px;color:var(--ok);font-weight:500">${I.zp} Early payment: ${it.earlyPaymentDiscount.discount_percent}% off within ${it.earlyPaymentDiscount.days} days (save ${fmtx((it.subtotal||it.amount)*(it.earlyPaymentDiscount.discount_percent/100),cur)})</div>`:''}
${docAnoms.length>0?`<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--dg);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">${I.wn} ${docAnoms.length} Anomal${docAnoms.length===1?'y':'ies'}</div>
${docAnoms.map(a=>`<div style="padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:4px;font-size:14px"><div style="display:flex;justify-content:space-between;margin-bottom:3px"><span class="bg ${sevBg(a.severity)}" style="font-size:12px">${a.severity} \u00B7 ${(a.type||'').replace(/_/g,' ')}</span><span class="mn fb" style="color:var(--dg);font-size:14px">${fmtx(Math.abs(a.amount_at_risk||0),cur)}</span></div><div style="color:var(--tm);line-height:1.5;font-size:14px">${E(a.description)}</div></div>`).join('')}</div>`:''}
${isCtr&&it.pricingTerms&&it.pricingTerms.length?`<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--tm);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">Contract Pricing</div>${it.pricingTerms.map(pt=>`<div style="display:flex;justify-content:space-between;padding:6px 10px;background:var(--sa);border-radius:6px;margin-bottom:3px;font-size:14px"><span>${E(pt.item)}</span><span class="mn fb">${fmtx(pt.rate,cur)} / ${pt.unit||'unit'}</span></div>`).join('')}</div>`:''}
<div style="font-size:12px;font-weight:700;color:var(--tm);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Line Items ${ed?'<span style="color:var(--al);font-weight:400">(click values to edit)</span>':''}</div>
<div class="tw" style="border-radius:10px"><table><thead><tr><th style="font-size:12px">Item</th><th style="text-align:right;font-size:12px">Qty</th><th style="text-align:right;font-size:12px">Price</th><th style="text-align:right;font-size:12px">Total</th></tr></thead><tbody>
${(it.lineItems||[]).map((li,idx)=>{
  const q=ef_val('li_'+idx+'_qty',li.quantity);
  const pr=ef_val('li_'+idx+'_price',li.unitPrice);
  const tot=(parseFloat(q)||0)*(parseFloat(pr)||0);
  if(!ed) return`<tr style="cursor:default"><td style="font-size:14px">${E(li.description)}</td><td class="mn" style="text-align:right;font-size:13px">${li.quantity}</td><td class="mn" style="text-align:right;font-size:13px">${fmtx(li.unitPrice,cur)}</td><td class="mn fb" style="text-align:right;font-size:13px">${fmtx(li.total||li.quantity*li.unitPrice,cur)}</td></tr>`;
  return`<tr style="cursor:default"><td><input data-ef="li_${idx}_desc" value="${E(li.description)}" style="width:100%;padding:3px 6px;background:var(--sa);border:1px solid var(--ac);border-radius:4px;color:var(--tx);font-size:13px;font-family:var(--ft)"/></td><td><input data-ef="li_${idx}_qty" type="number" step="any" value="${q}" style="width:60px;padding:3px 6px;background:var(--sa);border:1px solid var(--ac);border-radius:4px;color:var(--tx);font-size:13px;font-family:var(--mn);text-align:right"/></td><td><input data-ef="li_${idx}_price" type="number" step="any" value="${pr}" style="width:80px;padding:3px 6px;background:var(--sa);border:1px solid var(--ac);border-radius:4px;color:var(--tx);font-size:13px;font-family:var(--mn);text-align:right"/></td><td class="mn fb" style="text-align:right;font-size:13px">${fmtx(tot,cur)}</td></tr>`}).join('')}
</tbody></table></div>
${it.taxDetails&&it.taxDetails.length?`<div style="margin-top:8px;padding:8px 12px;background:var(--sa);border-radius:8px">${it.taxDetails.map(t=>`<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--tm)"><span>${E(t.type)} @ ${t.rate}%</span><span class="mn">${fmtx(t.amount,cur)}</span></div>`).join('')}<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin-top:4px;padding-top:4px;border-top:1px solid var(--bd)"><span>Total</span><span class="mn">${fmtx(it.amount,cur)}</span></div></div>`:''}
${!ed&&iv?`<div style="margin-top:16px;display:flex;gap:6px;flex-wrap:wrap">
${it.status!=='paid'?`<button class="bt bt-sm" style="background:var(--okb);color:var(--ok);border:1px solid rgba(16,185,129,.2)" data-paid="${it.id}">${I.ck} Mark Paid</button>`:''}
${it.status==='unpaid'?`<button class="bt bt-sm bt-s" data-status="${it.id}:under_review">${I.cl} Under Review</button>`:''}
${it.status==='on_hold'?`<button class="bt bt-sm bt-s" data-status="${it.id}:under_review">${I.cl} Move to Review</button><button class="bt bt-sm" style="background:var(--okb);color:var(--ok)" data-status="${it.id}:approved">${I.ck} Approve</button>`:''}
${it.status==='under_review'?`<button class="bt bt-sm" style="background:var(--okb);color:var(--ok)" data-status="${it.id}:approved">${I.ck} Approve</button>`:''}
${it.status!=='disputed'&&it.status!=='paid'?`<button class="bt bt-sm" style="background:var(--dgb);color:var(--dg);border:1px solid rgba(239,68,68,.2)" data-status="${it.id}:disputed">${I.wn} Dispute</button>`:''}
${it.status==='disputed'?`<button class="bt bt-sm bt-s" data-status="${it.id}:unpaid">${I.ar} Re-open</button>`:''}
</div>`:''}</div></div></div></div></div>`}

function bindEvents(){
  document.querySelectorAll('[data-tab]').forEach(e=>e.onclick=()=>{S.tab=e.dataset.tab;R()});
  document.querySelectorAll('[data-go]').forEach(e=>e.onclick=async()=>{if(S.authToken){S.scr='app';R();await loadAll()}else{S.scr='login';R()}});
  document.querySelectorAll('[data-cls]').forEach(e=>e.onclick=ev=>{if(ev.target===e||e.tagName==='BUTTON'){S.sel=null;S.editing=false;S.editFields={};R()}});
  document.querySelectorAll('[data-view]').forEach(e=>e.onclick=()=>{const d=S.docs.find(x=>x.id===e.dataset.view);if(d){S.sel=d;S.modalView='split';R()}});
  document.querySelectorAll('[data-ut]').forEach(e=>e.onclick=()=>{S.ut=e.dataset.ut;R()});
  document.querySelectorAll('[data-appr]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();approveMt(e.dataset.appr)});
  document.querySelectorAll('[data-rej]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();rejectMt(e.dataset.rej)});
  document.querySelectorAll('[data-paid]').forEach(e=>e.onclick=()=>markPaid(e.dataset.paid));
  document.querySelectorAll('[data-status]').forEach(e=>e.onclick=()=>{const[id,st]=e.dataset.status.split(':');setStatus(id,st)});
  document.querySelectorAll('[data-mview]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();S.modalView=e.dataset.mview;R()});
  document.querySelectorAll('[data-act="start-edit"]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();startEdit()});
  document.querySelectorAll('[data-act="save-edit"]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();
    // Capture all input values before save
    document.querySelectorAll('[data-ef]').forEach(inp=>{const k=inp.dataset.ef;const v=inp.value;if(v!==undefined)S.editFields[k]=v});
    saveEdits()});
  document.querySelectorAll('[data-act="cancel-edit"]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();cancelEdit()});
  // Live capture edits on input change
  document.querySelectorAll('[data-ef]').forEach(inp=>{inp.oninput=()=>{S.editFields[inp.dataset.ef]=inp.value}});
  document.querySelectorAll('[data-resolve]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();resolveAnomaly(e.dataset.resolve)});
  document.querySelectorAll('[data-dismiss]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();dismissAnomaly(e.dataset.dismiss)});
  document.querySelectorAll('[data-override]').forEach(e=>e.onclick=async ev=>{ev.stopPropagation();const[id,lane]=e.dataset.override.split(':');const fd=new FormData();fd.append('lane',lane);fd.append('reason','Manual override');await api(`/api/invoices/${id}/override-triage`,{method:'POST',body:fd});await loadAll();toast(`Triage overridden to ${lane.replace('_',' ')}`)});
  document.querySelectorAll('[data-act="reset"]').forEach(e=>e.onclick=resetAll);
  document.querySelectorAll('[data-act="seed"]').forEach(e=>e.onclick=seedDemo);
  document.querySelectorAll('[data-act="export"]').forEach(e=>e.onclick=exportDb);
  document.querySelectorAll('[data-act="import"]').forEach(e=>e.onclick=importDb);
  const rs=document.getElementById('role-select');
  if(rs){rs.onchange=async()=>{S.currentRole=rs.value;await loadAll();toast(`Switched to ${rs.options[rs.selectedIndex].text}`)}};
  // Auth bindings
  const authBtn=document.getElementById('auth-submit');
  if(authBtn){authBtn.onclick=()=>doAuth(S.authMode||'login')}
  const authPwd=document.getElementById('auth-password');
  if(authPwd){authPwd.onkeydown=e=>{if(e.key==='Enter')doAuth(S.authMode||'login')}}
  const authEmail=document.getElementById('auth-email');
  if(authEmail){authEmail.onkeydown=e=>{if(e.key==='Enter'){const p=document.getElementById('auth-password');if(p)p.focus();else doAuth(S.authMode||'login')}}}
  document.querySelectorAll('[data-act="logout"]').forEach(e=>e.onclick=logout);
  document.querySelectorAll('[data-act="go-login"]').forEach(e=>e.onclick=()=>{S.scr='login';R()});
  // Policy settings bindings
  document.querySelectorAll('[data-preset]').forEach(e=>e.onclick=async()=>{await api(`/api/policy/preset/${e.dataset.preset}`,{method:'POST'});await loadAll();toast(`Applied ${e.dataset.preset} preset`)});
  document.querySelectorAll('[data-act="save-policy"]').forEach(e=>e.onclick=async()=>{
    const updates={};
    document.querySelectorAll('[data-policy]').forEach(inp=>{const k=inp.dataset.policy;const v=inp.tagName==='SELECT'?inp.value:parseFloat(inp.value);if(!isNaN(v)||typeof v==='string')updates[k]=typeof v==='string'?v:v});
    await api('/api/policy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(updates)});await loadAll();toast('Policy saved')});
  document.querySelectorAll('[data-act="reset-policy"]').forEach(e=>e.onclick=async()=>{await api('/api/policy/preset/enterprise_default',{method:'POST'});await loadAll();toast('Policy reset to default')});
  document.querySelectorAll('[data-policy-toggle]').forEach(e=>e.onclick=async()=>{const k=e.dataset.policyToggle;const nv=!(S.policy||{})[k];await api('/api/policy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({[k]:nv})});await loadAll();toast(`${k}: ${nv?'ON':'OFF'}`)});
  const z=document.getElementById('uz'),fi=document.getElementById('fi');
  if(z&&fi){z.onclick=()=>fi.click();z.ondragover=e=>{e.preventDefault();z.style.borderColor='var(--ac)'};z.ondragleave=()=>{z.style.borderColor='var(--bd)'};
  z.ondrop=e=>{e.preventDefault();z.style.borderColor='var(--bd)';const f=e.dataTransfer.files;if(f.length>1)uploadBulk(f);else if(f.length===1)uploadFile(f[0])};
  fi.onchange=()=>{if(fi.files.length>1)uploadBulk(fi.files);else if(fi.files.length===1)uploadFile(fi.files[0])}}
}
// Initial render — auto-login if token saved
if(S.authToken){S.scr='app';R();loadAll()}else{R()}

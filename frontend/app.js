// AuditLens — Frontend v2.5
// Anomaly detection, contracts, tax handling, multi-currency, invoice workflow
// F1: Agentic triage (auto-approve/review/block) + F3: Vendor risk scoring

let S={scr:'landing',tab:'dashboard',docs:[],matches:[],anomalies:[],dash:{},vendors:[],triageData:{},proc:null,sel:null,toast:null,ut:'auto',api:'unknown',editing:false,editFields:{},modalView:'split',currentRole:'analyst',policy:{},
  // Platform stats — fetched from /api/health, never hardcoded
  ps:{v:'',rc:0,rules:[],opp:[],lc:0,sla:{},auth:[],mp:'',ms:'',ml:''},
  // Fine-tune state
  ft:{status:null,loading:false,polling:false},
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
  const[d,dc,m,an,vnd,tri,pol,cas]=await Promise.all([api('/api/dashboard'),api('/api/documents'),api('/api/matches'),api('/api/anomalies'),api('/api/vendors'),api('/api/triage'),api('/api/policy'),api('/api/cases')]);
  if(d){S.dash=d;S.api=d.api_mode}
  if(dc)S.docs=dc.documents||[];
  if(m)S.matches=m.matches||[];
  if(an)S.anomalies=an.anomalies||[];
  if(vnd)S.vendors=vnd.vendors||[];
  if(tri)S.triageData=tri||{};
  if(pol)S.policy=pol.policy||{};
  if(cas)S.casesData=cas.cases||[];
  await loadPlatformStats();
  R();
}
async function loadPlatformStats(){
  const h=await api('/api/health');
  if(h&&h.stats){const s=h.stats;
    S.ps={v:h.version||'',rc:s.anomaly_rule_count||0,rules:s.anomaly_rules||[],opp:s.opportunity_flags||[],
      lc:s.language_count||0,sla:s.sla_targets||{},auth:s.authority_tiers||[],
      mp:s.models?.primary||'',ms:s.models?.secondary||'',
      ml:s.models?.primary?(s.models.primary+' + '+s.models.secondary+(s.models.custom_enabled?' + '+s.models.custom_label:'')):''};

  }
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
    S.uploadResults=[{name:f.name,ok:true,type:dt,confidence:r.document.confidence,anomalies:nm}];
    toast(msg);await loadAll()
  }else{
    S.uploadResults=[{name:f.name,ok:false,error:r?.error||'Extraction failed'}];
    toast(r?.error||'Extraction failed');R()
  }
}
async function uploadBulk(files){
  const total=files.length;let ok=0,fail=0;S.uploadResults=[];
  for(let i=0;i<total;i++){
    const f=files[i];
    S.proc={fn:f.name,st:0,cur:i+1,total};R();
    const fd=new FormData();fd.append('file',f);fd.append('document_type',S.ut);
    const si=setInterval(()=>{if(S.proc&&S.proc.st<5){S.proc.st++;R()}},500);
    const r=await api('/api/upload',{method:'POST',body:fd});
    clearInterval(si);
    if(r&&r.success){ok++;S.uploadResults.push({name:f.name,ok:true,type:r.document.type,confidence:r.document.confidence,anomalies:r.new_anomalies?.length||0})}
    else{fail++;S.uploadResults.push({name:f.name,ok:false,error:r?.error||'Extraction failed'})}
  }
  S.proc=null;await loadAll();
  toast(`Bulk upload: ${ok} succeeded${fail?', '+fail+' failed':''} out of ${total} files`);
}
async function manualEntry(){
  const form=document.getElementById('manualForm');if(!form)return;
  const body={type:form.querySelector('[name=type]').value,documentNumber:form.querySelector('[name=documentNumber]').value,
    vendor:form.querySelector('[name=vendor]').value,amount:parseFloat(form.querySelector('[name=amount]').value)||0,
    currency:form.querySelector('[name=currency]').value||'USD',issueDate:form.querySelector('[name=issueDate]').value,
    poReference:form.querySelector('[name=poReference]').value,notes:form.querySelector('[name=notes]').value,
    documentName:'Manual Entry'};
  const r=await api('/api/documents/manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(r&&r.success){toast(`${typLabel(body.type)} manually indexed`);S.showManual=false;await loadAll()}
  else{toast(r?.error||'Failed to save')}
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
<div style="font-size:14px;color:var(--tm);line-height:1.7;margin-bottom:28px">Ensemble AI extraction, agentic dispute resolution, RAG-augmented anomaly detection, and policy-driven triage \u2014 end-to-end AP audit automation.</div>
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
.lbl{font-size:13px;font-weight:600;color:var(--td);display:block;margin-bottom:6px}
@media(max-width:900px){.sidebar{width:220px}.mc{margin-left:220px;padding:20px 18px}}
@media(max-width:680px){.sidebar{position:fixed;width:260px;transform:translateX(-100%);transition:transform .25s}.sidebar.open{transform:translateX(0)}.mc{margin-left:0;padding:16px 12px}.g2{grid-template-columns:1fr}}`;

function landing(){const p=S.ps;const rc=p.rc||17;const lc=p.lc||10;const ml=p.ml||'';const sla=p.sla||{};const auth=p.auth||[];const ver=p.v||'';
const authColors=['#166534','#15803d','#ca8a04','#dc2626'];
const ruleNames=(p.rules||[]).map(r=>r.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).replace('Po','PO').replace('Grn','GRN').replace('Qty','QTY'));
const oppNames=(p.opp||[]).map(r=>r.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()));
const I2={
  scan:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>`,
  shield:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`,
  link:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.07.01l.01-.01 2.83-2.83a5 5 0 00-7.08-7.07l-1.42 1.42"/><path d="M14 11a5 5 0 00-7.07-.01l-.01.01-2.83 2.83a5 5 0 007.08 7.07l1.42-1.42"/></svg>`,
  route:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 012 2v7"/><path d="M6 9v12"/></svg>`,
  zap:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  brain:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/><line x1="9" y1="22" x2="15" y2="22"/></svg>`,
  file:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  mail:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  dollar:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`,
  trend:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  target:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  msg:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
  tune:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/></svg>`,
  check:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  globe:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`,
  lock:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
};
return`
<div style="min-height:100vh;background:var(--bg);position:relative;overflow:hidden">
<div style="position:absolute;top:-300px;right:-200px;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(26,86,219,.04) 0%,transparent 55%);pointer-events:none"></div>
<div style="position:absolute;bottom:-200px;left:-100px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(220,38,38,.02) 0%,transparent 55%);pointer-events:none"></div>

<nav style="padding:16px 48px;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:10">
<div style="display:flex;align-items:center;gap:10px"><div style="width:36px;height:36px;border-radius:9px;background:linear-gradient(135deg,#dc2626,#ef4444);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(220,38,38,.18)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/><path d="M12 22V12"/><path d="M2 7l10 5 10-5"/></svg></div><span style="font-size:19px;font-weight:800;letter-spacing:-.02em;color:var(--tx)">AuditLens</span></div>
<div style="display:flex;gap:10px"><button class="bt bt-g" data-go>Sign In</button><button class="bt bt-p" data-go>Get Started \u2192</button></div></nav>

<!-- ═══ HERO: Outcome-first messaging ═══ -->
<section style="padding:48px 48px 0;max-width:1120px;margin:0 auto;position:relative;z-index:10;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center">
<div>
<div style="display:inline-flex;align-items:center;gap:7px;padding:5px 14px;border-radius:20px;background:var(--ag);border:1px solid rgba(26,86,219,.12);margin-bottom:22px;font-size:12px;font-weight:600;color:var(--ac)"><span style="width:6px;height:6px;border-radius:50%;background:var(--ac);animation:pulse 2s infinite"></span> AI-Powered AP Automation</div>
<h1 style="font-size:44px;font-weight:800;letter-spacing:-.04em;line-height:1.08;margin-bottom:18px;color:var(--tx)">Catch overcharges<br><span style="background:linear-gradient(135deg,var(--ac),#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent">before you pay.</span></h1>
<p style="font-size:16px;color:var(--tm);line-height:1.7;max-width:480px;margin-bottom:28px">AuditLens audits every invoice against your POs, contracts, and vendor history \u2014 automatically. AI extracts, matches, and flags anomalies in under 8 seconds. Your team investigates only what matters.</p>
<div style="display:flex;gap:12px;margin-bottom:28px"><button class="bt bt-p" style="padding:12px 28px;font-size:15px;font-weight:700" data-go>Start Auditing \u2192</button><button class="bt bt-s" style="padding:12px 28px;font-size:15px" onclick="window.open('mailto:sales@auditlens.ai')">Talk to Sales</button></div>
<div style="display:flex;gap:24px;font-size:13px;color:var(--td)">
${[['95%+','extraction accuracy'],[rc+'','anomaly checks'],[lc+'','languages'],['<8s','per invoice']].map(([v,l])=>`<div><span style="font-size:20px;font-weight:800;color:var(--ac);letter-spacing:-.02em;display:block;font-family:var(--mn)">${v}</span>${l}</div>`).join('')}
</div>
</div>
<div style="position:relative">
<div style="background:var(--sf);border:1px solid var(--bd);border-radius:16px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.06)">
<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--td);margin-bottom:18px">\u26A1 How AuditLens Processes Every Invoice</div>
${[
{icon:I2.scan,label:'AI Extraction',sub:'Ensemble models extract every field in parallel with self-correcting dispute resolution',color:'#4f46e5',bg:'rgba(79,70,229,.06)'},
{icon:I2.link,label:'3-Way Matching',sub:'Automatically match to POs and goods receipts \u2014 AI resolves fuzzy references',color:'#059669',bg:'rgba(5,150,105,.06)'},
{icon:I2.shield,label:'Anomaly Detection',sub:rc+' rules + AI auditor cross-references contracts, vendor history, and past corrections',color:'#d97706',bg:'rgba(217,119,6,.06)'},
{icon:I2.route,label:'Smart Triage',sub:'Auto-approve clean invoices, route exceptions to the right person with SLA tracking',color:'#dc2626',bg:'rgba(220,38,38,.06)'},
{icon:I2.file,label:'Investigation Brief',sub:'AI-generated case narrative citing exact amounts, clauses, and recommended actions',color:'#0369a1',bg:'rgba(3,105,161,.06)'},
].map((s,i)=>`<div style="display:flex;gap:14px;align-items:flex-start;padding:12px 14px;border-radius:10px;background:${s.bg};margin-bottom:6px;animation:fadeUp .4s ease ${.15+i*.1}s both"><div style="width:32px;height:32px;border-radius:8px;background:${s.color}12;display:flex;align-items:center;justify-content:center;color:${s.color};flex-shrink:0">${s.icon}</div><div><div style="font-size:13px;font-weight:700;color:var(--tx)">${s.label}</div><div style="font-size:11.5px;color:var(--tm);margin-top:2px;line-height:1.45">${s.sub}</div></div></div>`).join('')}
</div>
<div style="position:absolute;top:-8px;right:-8px;padding:5px 12px;border-radius:8px;background:#059669;color:white;font-size:10px;font-weight:700;letter-spacing:.04em;box-shadow:0 2px 8px rgba(5,150,105,.3)">LIVE DEMO</div>
</div>
</section>

<!-- ═══ PROBLEM + PROOF: Why AP teams need this ═══ -->
<section style="padding:56px 48px 0;max-width:1120px;margin:0 auto;position:relative;z-index:10">
<div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px;padding:40px;display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center">
<div>
<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#60a5fa;margin-bottom:12px">The AP Problem</div>
<div style="font-size:24px;font-weight:800;color:white;margin-bottom:14px;letter-spacing:-.02em;line-height:1.2">AP teams lose 1\u20143% of spend to undetected overcharges, duplicates, and contract violations.</div>
<div style="font-size:14px;color:#94a3b8;line-height:1.7">Manual review catches a fraction. Sampling audits miss systematic issues. By the time errors surface, the money is gone. AuditLens checks every invoice, every line item, every time \u2014 before payment.</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
${[
{label:'Manual Review',val:'2\u20133',unit:'invoices/hr',sub:'Per analyst',color:'#ef4444',bg:'rgba(239,68,68,.1)'},
{label:'AuditLens',val:'450+',unit:'invoices/hr',sub:'Fully automated',color:'#22c55e',bg:'rgba(34,197,94,.1)'},
{label:'Exception Rate',val:'5\u201315%',unit:'flagged',sub:'Only true anomalies',color:'#60a5fa',bg:'rgba(96,165,250,.1)'},
{label:'Coverage',val:'100%',unit:'of invoices',sub:'Zero sampling gaps',color:'#a78bfa',bg:'rgba(167,139,250,.1)'},
].map(s=>`<div style="background:${s.bg};border:1px solid ${s.color}20;border-radius:12px;padding:16px;text-align:center"><div style="font-size:24px;font-weight:800;color:${s.color};font-family:var(--mn)">${s.val}</div><div style="font-size:11px;color:#94a3b8;font-weight:600;margin-top:2px">${s.unit}</div><div style="font-size:10px;color:#64748b;margin-top:4px">${s.sub}</div></div>`).join('')}
</div>
</div>
</section>

<!-- ═══ AI INTELLIGENCE: Comprehensive feature grid (single presentation) ═══ -->
<section style="padding:56px 48px 0;max-width:1120px;margin:0 auto;position:relative;z-index:10">
<div style="text-align:center;margin-bottom:32px">
<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ac);margin-bottom:8px">AI Intelligence Layer</div>
<div style="font-size:28px;font-weight:800;color:var(--tx);letter-spacing:-.03em">AI where it matters. Rules where you need control.</div>
<div style="font-size:14px;color:var(--tm);margin-top:8px;max-width:600px;margin-left:auto;margin-right:auto">Every AI output is grounded in your actual invoices, POs, and contracts. Every number is verified. Every decision has a deterministic fallback.</div>
</div>

<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px">
${[
{icon:I2.scan,title:'Ensemble Extraction',desc:'Two frontier models extract in parallel. Consensus engine merges with field-level confidence scoring. A third custom model joins after fine-tuning.',tag:'AI',tagC:'#4f46e5'},
{icon:I2.brain,title:'Agentic Dispute Resolution',desc:'When models disagree on critical fields, a third AI call re-examines the document with vendor context and PO data to break the tie.',tag:'AI',tagC:'#4f46e5'},
{icon:I2.shield,title:'RAG Anomaly Detection',desc:rc+' rule-based checks plus an AI auditor that cross-references past anomalies, corrections, and contract clauses from a vector store.',tag:'AI + RULES',tagC:'#d97706'},
{icon:I2.link,title:'3-Way + Smart Matching',desc:'Deterministic PO-GRN-Invoice matching. For unmatched invoices, AI reasons across all POs by vendor, amount, line items, and dates.',tag:'ALGORITHMIC + AI',tagC:'#059669'},
{icon:I2.file,title:'Investigation Briefs',desc:'Auto-generated case narratives citing exact dollar amounts, contract clauses, and vendor history. Every fact traced to source data.',tag:'AI',tagC:'#4f46e5'},
{icon:I2.check,title:'Plain English Anomalies',desc:'Translates technical flags into one-sentence explanations a finance manager can act on, with post-validated amounts.',tag:'AI',tagC:'#4f46e5'},
{icon:I2.mail,title:'Vendor Communication Drafts',desc:'AI drafts dispute letters referencing your specific contract terms, PO prices, and dollar amounts. You review before sending.',tag:'AI \u00B7 HUMAN CONFIRMS',tagC:'#0369a1'},
{icon:I2.dollar,title:'Payment Prioritization',desc:'Optimizes weekly payment runs: capture early payment discounts, hold disputed invoices, respect cash flow constraints.',tag:'AI',tagC:'#4f46e5'},
{icon:I2.trend,title:'Anomaly Pattern Insights',desc:'Identifies recurring vendor issues from statistical analysis. Only surfaces patterns meeting significance thresholds.',tag:'AI + STATS',tagC:'#d97706'},
{icon:I2.target,title:'Smart Case Routing',desc:'Algorithm scores team members by expertise, workload, and authority. AI explains the recommendation. You approve the assignment.',tag:'ALGORITHMIC + AI',tagC:'#059669'},
{icon:I2.msg,title:'Natural Language Policy',desc:'Configure AP rules in plain English. AI translates to parameters. You preview every change before applying.',tag:'AI \u00B7 HUMAN CONFIRMS',tagC:'#0369a1'},
{icon:I2.tune,title:'Custom Model Fine-Tuning',desc:'Your corrections train LoRA adapters on vendor-specific layouts. Gets faster, cheaper, and more accurate over time.',tag:'AI + LoRA',tagC:'#6d28d9'},
].map((f,i)=>`<div style="background:var(--sf);border:1px solid var(--bd);border-radius:12px;padding:20px;transition:all .2s;animation:fadeUp .4s ease ${.05+i*.04}s both" onmouseover="this.style.borderColor='var(--bh)';this.style.boxShadow='0 4px 16px rgba(0,0,0,.05)'" onmouseout="this.style.borderColor='var(--bd)';this.style.boxShadow='none'"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div style="width:32px;height:32px;border-radius:8px;background:${f.tagC}08;display:flex;align-items:center;justify-content:center;color:${f.tagC}">${f.icon}</div><span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:4px;background:${f.tagC}08;color:${f.tagC};letter-spacing:.05em">${f.tag}</span></div><div style="font-size:14px;font-weight:700;color:var(--tx);margin-bottom:6px">${f.title}</div><div style="font-size:12.5px;color:var(--tm);line-height:1.55">${f.desc}</div></div>`).join('')}
</div>
</section>

<!-- ═══ TRUST & SAFETY: Anti-hallucination + Authority ═══ -->
<section style="padding:48px 48px 0;max-width:1120px;margin:0 auto;position:relative;z-index:10">
<div style="text-align:center;margin-bottom:28px">
<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ac);margin-bottom:8px">Enterprise-Grade Trust</div>
<div style="font-size:28px;font-weight:800;color:var(--tx);letter-spacing:-.03em">Every number verified. Every decision auditable.</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">

<div class="cd" style="padding:28px;border:1px solid rgba(79,70,229,.15);background:linear-gradient(135deg,#fafafe,#f5f3ff)">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px"><div style="width:34px;height:34px;border-radius:9px;background:#4f46e512;display:flex;align-items:center;justify-content:center;color:#4f46e5">${I2.shield}</div><div style="font-size:16px;font-weight:700;color:var(--tx)">Grounded AI Architecture</div></div>
<div style="font-size:13px;color:var(--tm);line-height:1.7;margin-bottom:16px">Every AI output passes through a 4-stage verification pipeline. Claude reasons over your data \u2014 the system verifies every claim before it reaches your team.</div>
<div style="display:flex;flex-direction:column;gap:6px">
${[
{s:'1',t:'Fact Injection',d:'All data from your invoices, POs, and contracts as structured JSON'},
{s:'2',t:'Constrained Generation',d:'Scoped prompts with explicit anti-fabrication instructions'},
{s:'3',t:'Post-Validation',d:'Every dollar amount and reference checked against source records'},
{s:'4',t:'Deterministic Fallback',d:'Template-based output if AI fails \u2014 users never see errors'},
].map(x=>`<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 12px;background:white;border-radius:8px;border:1px solid #e9e5f5"><div style="width:22px;height:22px;border-radius:6px;background:#4f46e5;color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${x.s}</div><div><div style="font-size:12px;font-weight:700;color:var(--tx)">${x.t}</div><div style="font-size:11px;color:var(--tm)">${x.d}</div></div></div>`).join('')}
</div>
</div>

<div style="display:flex;flex-direction:column;gap:16px">
<div class="cd" style="padding:24px;background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #bbf7d0">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><div style="width:34px;height:34px;border-radius:9px;background:#16a34a12;display:flex;align-items:center;justify-content:center;color:#16a34a">${I2.lock}</div><div style="font-size:16px;font-weight:700;color:var(--tx)">Delegation of Authority</div></div>
<div style="font-size:12px">${auth.length?auth.map((a,i)=>`<div style="display:flex;justify-content:space-between;padding:6px 12px;background:white;border-radius:6px;border:1px solid #bbf7d0;margin-bottom:4px"><span style="font-weight:600;color:${authColors[i]||'var(--tm)'}">${a.title}</span><span style="font-family:var(--mn);font-weight:700;color:var(--tm)">${a.unlimited?'Unlimited':'\u2264 $'+a.limit_usd.toLocaleString()}</span></div>`).join(''):[
{r:'AP Analyst',l:'Configurable'},{r:'AP Manager',l:'Configurable'},{r:'VP Finance',l:'Configurable'},{r:'CFO',l:'Unlimited'}
].map((a,i)=>`<div style="display:flex;justify-content:space-between;padding:6px 12px;background:white;border-radius:6px;border:1px solid #bbf7d0;margin-bottom:4px"><span style="font-weight:600;color:${authColors[i]}">${a.r}</span><span style="font-family:var(--mn);font-weight:700;color:var(--tm)">${a.l}</span></div>`).join('')}</div>
</div>

<div class="cd" style="padding:24px;background:linear-gradient(135deg,#eff6ff,#f0f9ff);border:1px solid #bfdbfe">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="font-size:14px;font-weight:700;color:#1d4ed8">What We Catch</div></div>
<div style="font-size:12.5px;color:var(--tm);line-height:1.7">${rc} detection rules covering overcharges, duplicate invoices, quantity mismatches, unauthorized line items, contract rate violations, stale invoices, tax anomalies, short shipments, and more \u2014 all running deterministically alongside the AI auditor.</div>
<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:3px">${['RBAC','JWT Auth','SOX-Ready','Audit Trail','SLA Tracking',rc+' Rules'].map(t=>`<span style="font-size:9.5px;padding:2px 8px;border-radius:4px;background:white;border:1px solid #dbeafe;color:#1e40af;font-weight:600">${t}</span>`).join('')}</div>
</div>
</div>

</div>
</section>

<!-- ═══ GLOBAL: Languages ═══ -->
<section style="padding:48px 48px 0;max-width:1120px;margin:0 auto;position:relative;z-index:10">
<div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px;padding:32px 40px;display:grid;grid-template-columns:1fr 1fr;gap:36px;align-items:center">
<div>
<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="color:#60a5fa">${I2.globe}</div><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#60a5fa">Global Ready</div></div>
<div style="font-size:22px;font-weight:800;color:white;margin-bottom:10px;letter-spacing:-.02em">Process invoices in ${lc} languages</div>
<div style="font-size:14px;color:#94a3b8;line-height:1.6;margin-bottom:16px">Auto-detect document language, normalize regional number and date formats, and validate against local tax systems.</div>
<div style="display:flex;gap:6px;flex-wrap:wrap">${['VAT','GST','MwSt','TVA','IVA','\u589E\u503C\u7A0E','\u6D88\u8CBB\u7A0E','ICMS'].map(t=>`<span style="padding:3px 10px;border-radius:6px;background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.2);color:#93c5fd;font-size:11px;font-weight:600">${t}</span>`).join('')}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">${[['EN','#64748b'],['CN','#ef4444'],['JP','#f97316'],['KR','#3b82f6'],['HI','#eab308'],['DE','#22c55e'],['FR','#6366f1'],['ES','#a855f7'],['PT','#14b8a6'],['AR','#8b5cf6']].map(([c,clr])=>`<div style="padding:10px 0;border-radius:8px;background:${clr}15;border:1px solid ${clr}25;text-align:center"><div style="font-size:12px;font-weight:800;color:${clr};letter-spacing:.04em">${c}</div></div>`).join('')}</div>
</div>
</section>

<!-- ═══ DEPLOY ANYWHERE: Privacy & Flexibility ═══ -->
<section style="padding:48px 48px 0;max-width:1120px;margin:0 auto;position:relative;z-index:10">
<div style="text-align:center;margin-bottom:32px">
<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#059669;margin-bottom:8px">Deploy Anywhere</div>
<div style="font-size:28px;font-weight:800;color:var(--tx);letter-spacing:-.03em">Your data. Your infrastructure. Your rules.</div>
<div style="font-size:14px;color:var(--tm);margin-top:8px;max-width:620px;margin-left:auto;margin-right:auto">AuditLens is model-agnostic by design. Choose the deployment that matches your security posture &mdash; from managed cloud to fully air-gapped on-premise. Same audit engine, same accuracy, zero code changes.</div>
</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
${[
{icon:I2.scan,title:'Managed Cloud',desc:'Anthropic API with Zero Data Retention. Fastest setup &mdash; add API key and go. Your data is never used for training.',tag:'DEFAULT',tagC:'#1a56db',border:'#bfdbfe',bg:'linear-gradient(135deg,#fafafe,#eff6ff)',checks:['Zero Data Retention','Frontier model accuracy','5-minute setup','SOC 2 Type II compliant'],prov:'Anthropic Claude API'},
{icon:I2.lock,title:'Private Cloud (VPC)',desc:'Claude runs inside your AWS or Google Cloud account. Financial data never leaves your VPC boundary.',tag:'ENTERPRISE',tagC:'#059669',border:'#bbf7d0',bg:'linear-gradient(135deg,#fafffe,#f0fdf4)',checks:['Data stays in your VPC','Choose your AWS/GCP region','Frontier model accuracy','HIPAA / GDPR compatible'],prov:'AWS Bedrock &middot; Google Vertex AI'},
{icon:I2.tune,title:'On-Premise / Air-Gapped',desc:'Run open-weight models on your own hardware. Fully air-gapped &mdash; zero network calls to external services.',tag:'AIR-GAPPED',tagC:'#6d28d9',border:'#e9d5ff',bg:'linear-gradient(135deg,#fdfaff,#faf5ff)',checks:['Zero data leaves your network','Your hardware, your models','Fine-tune on your invoices','Defense / regulated sectors'],prov:'vLLM &middot; Ollama &middot; TGI &middot; Together'},
].map((f,i)=>`<div class="cd" style="padding:28px;border:1px solid ${f.border};background:${f.bg};position:relative;transition:all .2s;animation:fadeUp .4s ease ${.05+i*.1}s both" onmouseover="this.style.boxShadow='0 4px 20px ${f.tagC}12'" onmouseout="this.style.boxShadow='none'"><div style="position:absolute;top:14px;right:14px;padding:2px 10px;border-radius:6px;background:${f.tagC};color:white;font-size:9.5px;font-weight:700;letter-spacing:.04em">${f.tag}</div><div style="width:40px;height:40px;border-radius:10px;background:${f.tagC}12;display:flex;align-items:center;justify-content:center;color:${f.tagC};margin-bottom:16px">${f.icon}</div><div style="font-size:16px;font-weight:800;color:var(--tx);margin-bottom:6px">${f.title}</div><div style="font-size:12.5px;color:var(--tm);line-height:1.6;margin-bottom:16px">${f.desc}</div><div style="display:flex;flex-direction:column;gap:5px;font-size:12px">${f.checks.map(c=>`<div style="display:flex;align-items:center;gap:7px;color:var(--tm)"><span style="color:${f.tagC};font-weight:700">&check;</span> ${c}</div>`).join('')}</div><div style="margin-top:16px;padding-top:14px;border-top:1px solid ${f.border}"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--td);margin-bottom:4px">Provider</div><div style="font-size:12px;font-weight:600;color:var(--tx);font-family:var(--mn)">${f.prov}</div></div></div>`).join('')}
</div>
<div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:12px;padding:24px 32px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
<div style="flex:1;min-width:280px"><div style="font-size:13px;font-weight:700;color:#60a5fa;margin-bottom:6px">One Config Change. Zero Code Changes.</div><div style="font-size:12px;color:#94a3b8;line-height:1.6">Set <code style="background:rgba(96,165,250,.15);padding:1px 6px;border-radius:4px;font-family:var(--mn);font-size:11px;color:#93c5fd">LLM_PROVIDER=bedrock</code> and your region. AuditLens handles the rest &mdash; same extraction pipeline, same anomaly detection, same audit trail.</div></div>
<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
${[{l:'Cloud',c:'#60a5fa',v:'anthropic'},{l:'VPC',c:'#22c55e',v:'bedrock'},{l:'On-Prem',c:'#a78bfa',v:'openai'}].map((t,i,a)=>`<div style="padding:6px 14px;border-radius:8px;background:${t.c}15;border:1px solid ${t.c}30;text-align:center"><div style="font-size:10px;color:${t.c};font-weight:600">${t.l}</div><div style="font-size:9px;color:#64748b;font-family:var(--mn)">${t.v}</div></div>${i<a.length-1?'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>':''}`).join('')}
</div></div>
</section>

<!-- ═══ CTA ═══ -->
<section style="padding:48px 48px 56px;max-width:800px;margin:0 auto;text-align:center;position:relative;z-index:10">
<div style="background:linear-gradient(135deg,var(--ag),#eff6ff);border:1px solid rgba(26,86,219,.12);border-radius:20px;padding:40px 36px">
<div style="font-size:26px;font-weight:800;color:var(--tx);margin-bottom:10px;letter-spacing:-.02em">See what your AP team is missing.</div>
<div style="font-size:15px;color:var(--tm);margin-bottom:24px">Upload your first invoice and AuditLens will extract, match, and audit it in under 8 seconds.</div>
<button class="bt bt-p" style="padding:13px 28px;font-size:15px;font-weight:700" data-go>Start Free \u2192</button>
</div></section>

<footer style="padding:28px 48px;border-top:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center;position:relative;z-index:10"><div style="font-size:12px;color:var(--td);font-weight:500">\u00A9 2026 AuditLens${ver?' \u00B7 v'+ver:''}</div><div style="font-size:12px;color:var(--td)">Enterprise AP Automation \u00B7 SOX-Ready</div></footer></div>`}


function caseDetailPanel(){const c=S.caseDetail;if(!c)return'';
const sla=c._slaStatus||{};const priCol={critical:'#dc2626',high:'#d97706',medium:'#2563eb',low:'#64748b'};
return`<div class="po" data-act="closeCaseDetail"><div style="background:var(--sf);border-radius:16px;width:720px;max-height:85vh;overflow-y:auto;padding:32px;position:relative" onclick="event.stopPropagation()">
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
<div><div style="font-size:12px;font-weight:700;color:var(--td);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">${E(c.id)} \u00B7 ${E(c.type.replace(/_/g,' '))}</div>
<h2 style="font-size:22px;font-weight:800;margin-bottom:4px">${E(c.title)}</h2>
<div style="display:flex;gap:8px;margin-top:8px"><span style="color:${priCol[c.priority]||'#64748b'};font-weight:700;font-size:12px;text-transform:uppercase;padding:3px 10px;border-radius:6px;background:${priCol[c.priority]||'#64748b'}15">\u25CF ${c.priority}</span>
<span class="bg ${({'open':'bg-w','investigating':'bg-i','pending_vendor':'bg-d','pending_approval':'bg-w','escalated':'bg-h','resolved':'bg-s','closed':'bg-d'})[c.status]||'bg-d'}">${c.status.replace(/_/g,' ')}</span>
<span class="bg ${({'breached':'bg-h','at_risk':'bg-w','on_track':'bg-s','met':'bg-s'})[sla.status]||'bg-d'}">SLA: ${sla.status==='breached'?'BREACHED':sla.status==='at_risk'?Math.round(sla.hoursRemaining||0)+'h left':'On track'}</span></div></div>
<button class="bt bt-sm bt-g" data-act="closeCaseDetail">\u2715</button></div>
<div style="padding:16px;background:var(--sa);border-radius:10px;margin-bottom:20px;font-size:14px;color:var(--tm);line-height:1.6">${E(c.description)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:13px">
<div><span style="color:var(--td);font-weight:600">Vendor:</span> ${E(c.vendor||'\u2014')}</div>
<div><span style="color:var(--td);font-weight:600">Amount at Risk:</span> <b>${c.amountAtRisk?fmtx(c.amountAtRisk,c.currency):'\u2014'}</b></div>
<div><span style="color:var(--td);font-weight:600">Assigned To:</span> ${c.assignedTo||'<span style="color:var(--dg)">Unassigned</span>'}</div>
<div><span style="color:var(--td);font-weight:600">Created:</span> ${D(c.createdAt)} by ${E(c.createdBy)}</div>
<div><span style="color:var(--td);font-weight:600">SLA Deadline:</span> ${D(c.sla?.deadline)}</div>
${c.resolvedAt?`<div><span style="color:var(--td);font-weight:600">Resolved:</span> ${D(c.resolvedAt)} by ${E(c.resolvedBy||'')}</div>`:'<div></div>'}
</div>
<div style="display:flex;gap:8px;margin-bottom:20px">
<button class="bt bt-sm bt-p" data-act="assignCase" data-caseid="${c.id}">\uD83D\uDC64 Assign</button>
<button class="bt bt-sm bt-g" data-act="addCaseNote" data-caseid="${c.id}">\uD83D\uDCDD Add Note</button>
${c.status!=='resolved'&&c.status!=='closed'?`<button class="bt bt-sm" style="background:var(--okb);color:var(--ok);border:1px solid rgba(16,185,129,.2)" data-caseaction="resolve" data-caseid="${c.id}">\u2713 Resolve</button>`:''}
${c.status!=='escalated'&&c.status!=='resolved'&&c.status!=='closed'?`<button class="bt bt-sm" style="background:var(--wnb);color:var(--wn);border:1px solid rgba(217,119,6,.2)" data-caseaction="escalate" data-caseid="${c.id}">\u26A0 Escalate</button>`:''}
</div>
${(c._anomalies||[]).length?`<div style="margin-bottom:20px"><div style="font-size:13px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Linked Anomalies (${c._anomalies.length})</div>
${c._anomalies.map(a=>`<div style="padding:10px 14px;background:var(--sa);border-radius:8px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;font-size:13px">
<div style="display:flex;gap:8px;align-items:center"><span class="bg ${({'high':'bg-h','medium':'bg-w','low':'bg-d'})[a.severity]||'bg-d'}">${a.severity}</span><span style="color:var(--tm)">${(a.type||'').replace(/_/g,' ')}</span></div>
<div style="display:flex;gap:8px;align-items:center"><span class="mn fb">${fmtx(Math.abs(a.amount_at_risk||0),a.currency||c.currency)}</span><span class="bg ${({'open':'bg-w','resolved':'bg-s','dismissed':'bg-d'})[a.status]||'bg-d'}">${a.status}</span></div>
</div>`).join('')}</div>`:''}
${(c.notes||[]).length?`<div style="margin-bottom:20px"><div style="font-size:13px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Notes (${c.notes.length})</div>
${c.notes.map(n=>`<div style="padding:10px 14px;background:var(--sa);border-radius:8px;margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--td);margin-bottom:4px"><span>${E(n.by)}</span><span>${D(n.at)}</span></div><div style="font-size:14px;color:var(--tm)">${E(n.text)}</div></div>`).join('')}</div>`:''}
<div><div style="font-size:13px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Status History</div>
${(c.statusHistory||[]).map(h=>`<div style="display:flex;gap:12px;align-items:flex-start;padding:6px 0;font-size:13px;border-bottom:1px solid var(--bd)"><span style="min-width:120px;color:var(--td)">${D(h.at)}</span><span class="bg bg-d" style="min-width:80px;text-align:center">${h.status.replace(/_/g,' ')}</span><span style="color:var(--tm)">${E(h.reason||'')} <span style="color:var(--td)">by ${E(h.by)}</span></span></div>`).join('')}
</div></div></div>`}

function statCard(icon,label,val,sub,color){return`<div class="cd" style="flex:1;min-width:175px;padding:22px 24px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="width:34px;height:34px;border-radius:9px;background:${color}12;display:flex;align-items:center;justify-content:center;color:${color};font-size:16px">${icon}</div><span style="font-size:12px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.06em">${label}</span></div><div style="font-size:26px;font-weight:700;letter-spacing:-.02em">${val}</div>${sub?`<div style="font-size:13px;color:var(--td);margin-top:5px">${sub}</div>`:''}</div>`}

function app(){
  const d=S.dash||{};const ag=(d.aging||{buckets:{},counts:{}});const rv=d.review_needed||0;const ac=d.anomaly_count||0;
  return`${S.proc?processing():''}${S.sel?modal():''}${S.caseDetail?caseDetailPanel():''}${S.toast?`<div class="tt">${I.ck} ${E(S.toast)}</div>`:''}
<div class="ly"><aside class="sidebar" role="navigation" aria-label="Main navigation">
<div style="display:flex;align-items:center;gap:12px;padding:0 20px;margin-bottom:28px"><div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#dc2626,#ef4444);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(220,38,38,.25);flex-shrink:0"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/><path d="M12 22V12"/><path d="M2 7l10 5 10-5"/></svg></div><div><div style="font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--tx)">AuditLens</div><div style="font-size:10px;color:var(--td);font-weight:600;text-transform:uppercase;letter-spacing:.1em">AP Intelligence</div></div></div>
<div style="padding:0 12px;flex:1;overflow-y:auto;min-height:0">
${(()=>{const ur=S.authUser?.role||S.currentRole||'analyst';const isAdmin=ur==='cfo'||ur==='vp';const isMgr=isAdmin||ur==='manager';
const sec=(label)=>`<div style="font-size:11px;color:var(--ac);font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:4px 16px;margin:20px 0 8px;border-top:1px solid var(--bd);padding-top:14px">${label}</div>`;
const btn=(t)=>`<button class="sbi ${S.tab===t.id?'on':''}" data-tab="${t.id}">${t.i} ${t.l}${t.b?`<span style="margin-left:auto;background:var(--${t.bc||'wn'}b);color:var(--${t.bc||'wn'});font-size:12px;font-weight:700;padding:2px 7px;border-radius:10px">${t.b}</span>`:''}</button>`;
let h='';
h+=`<button class="sbi" data-tab="upload" style="background:var(--ac);color:white;font-weight:700;border-radius:10px;margin:0 4px 14px;justify-content:center;gap:6px;box-shadow:0 2px 8px rgba(26,86,219,.18)">${I.up} Upload Document</button>`;
h+=sec('Inbox');
h+=btn({id:'dashboard',l:'Dashboard',i:I.chr});
h+=btn({id:'documents',l:'Documents',i:I.doc});
h+=btn({id:'triage',l:'Triage',i:'\u26A1',b:S.dash.triage?.blocked||0,bc:'dg'});
h+=btn({id:'cases',l:'Cases',i:'\uD83D\uDCCB',b:S.dash.cases?.active||0,bc:'wn'});
h+=sec('Audit');
h+=btn({id:'anomalies',l:'Anomalies',i:I.wn,b:ac,bc:'dg'});
h+=btn({id:'matching',l:'PO Matching',i:I.lnk,b:rv,bc:'wn'});
h+=sec('Master Data');
h+=btn({id:'vendors',l:'Vendors',i:I.sh,b:S.dash.vendor_risk?.high_risk||0,bc:'dg'});
h+=btn({id:'contracts',l:'Contracts',i:I.ct});
if(isMgr){h+=sec('Configure');h+=btn({id:'settings',l:'AP Policy',i:'\u2699\uFE0F'});h+=btn({id:'training',l:'Model Training',i:'\uD83E\uDDEC'});}
if(isAdmin){h+=sec('Admin');
h+=`<button class="sbi" data-act="seed" style="color:var(--ok);font-size:13px">${I.sp} Load Sample Data</button>`;
h+=`<button class="sbi" style="font-size:13px" data-act="export">${I.doc} Export</button>`;
h+=`<button class="sbi" style="font-size:13px" data-act="import">${I.up} Import</button>`;
h+=`<button class="sbi" data-act="reset" style="color:var(--dg);font-size:13px">${I.tr} Clear All Data</button>`;}
return h})()}</div>
${S.authUser?`<div style="padding:10px 16px;border-top:1px solid var(--bd);flex-shrink:0"><div style="display:flex;align-items:center;gap:8px"><div style="width:30px;height:30px;border-radius:50%;background:var(--ac);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0">${(S.authUser.name||'?')[0].toUpperCase()}</div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${E(S.authUser.name)} <span class="bg bg-s" style="font-size:10px;padding:2px 6px;vertical-align:middle">${{analyst:'Analyst',manager:'Manager',vp:'VP',cfo:'CFO'}[S.authUser.role]||S.authUser.role}</span></div><div style="font-size:10px;color:var(--td);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${E(S.authUser.email)}">${E(S.authUser.email)}</div></div><button class="bt bt-sm bt-g" data-act="logout" style="font-size:10px;padding:3px 8px;flex-shrink:0">Logout</button></div></div>`
:`<div style="padding:10px 16px;border-top:1px solid var(--bd);flex-shrink:0"><div style="display:flex;align-items:center;gap:6px"><select id="role-select" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--tx);font-size:11px;font-weight:600;cursor:pointer;font-family:var(--ft)">
<option value="analyst" ${S.currentRole==='analyst'?'selected':''}>AP Analyst</option>
<option value="manager" ${S.currentRole==='manager'?'selected':''}>AP Manager</option>
<option value="vp" ${S.currentRole==='vp'?'selected':''}>VP Finance</option>
<option value="cfo" ${S.currentRole==='cfo'?'selected':''}>CFO</option>
</select><button class="bt bt-sm bt-p" style="font-size:10px;padding:5px 8px" data-act="go-login">\u{1F512} Login</button></div></div>`}</aside>
<main class="mc" role="main">${S.tab==='dashboard'?dashboard(d,ag):S.tab==='triage'?triageTab():S.tab==='cases'?casesTab():S.tab==='documents'?documents():S.tab==='anomalies'?anomaliesTab():S.tab==='matching'?matching():S.tab==='vendors'?vendorsTab():S.tab==='contracts'?contractsTab():S.tab==='settings'?((['cfo','vp','manager'].includes(S.authUser?.role||S.currentRole))?settingsTab():'<div class="fu" style="text-align:center;padding:60px"><h2>Access Restricted</h2><p style="color:var(--td)">Policy configuration requires Manager, VP, or CFO role.</p></div>'):S.tab==='training'?modelTrainingTab():upload()}</main></div>`}

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
<div style="display:flex;gap:14px;margin-bottom:20px;flex-wrap:wrap">${statCard(I.dl,'Total Outstanding',fmt(d.total_ap),`${d.unpaid_count||0} unpaid invoices`,'var(--al)')}${statCard(I.wn,'Open Anomalies',d.anomaly_count||0,d.high_severity?`${d.high_severity} high severity`:'\u2014','var(--dg)')}${statCard(I.sh,'Money at Risk',fmt(d.total_risk),d.anomaly_count?'From open anomalies':'\u2014','var(--wn)')}${statCard(I.ck,'Auto-Matched',d.auto_matched||0,`${d.review_needed||0} need review`,'var(--ok)')}</div>
<div style="display:flex;gap:14px;margin-bottom:20px;flex-wrap:wrap">${statCard('\u26A1','Auto-Approved',d.triage?.auto_approved||0,d.triage?.auto_approve_rate?d.triage.auto_approve_rate+'% rate':'Triage disabled','var(--ok)')}${statCard('\u26D4','Blocked',d.triage?.blocked||0,d.triage?.blocked_amount?fmt(d.triage.blocked_amount)+' held':'No blocked invoices','var(--dg)')}${statCard(I.sh,'High Risk Vendors',d.vendor_risk?.high_risk||0,d.vendor_risk?.worsening?d.vendor_risk.worsening+' worsening':'All stable','var(--wn)')}${statCard('\uD83E\uDDE0','AI Pipeline',d.correction_patterns||0,d.correction_patterns?'patterns \u00B7 ensemble + dispute resolver + RAG':'Ensemble extraction \u00B7 RAG anomalies','#7c3aed')}</div>
<div class="g2"><div class="cd"><div style="display:flex;align-items:center;gap:8px;margin-bottom:24px"><span style="font-size:17px">${I.chr}</span><span style="font-size:15px;font-weight:700">AP Aging</span></div>
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
  return`<div class="fu"><div style="margin-bottom:24px"><div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px"><div><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">\u26A1 Agentic Triage</h1><p style="font-size:15px;color:var(--tm)">Policy-driven classification: Auto-Approve, Review, or Block \u00B7 based on anomaly severity, vendor risk, match quality, and authority limits</p></div>
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

function casesTab(){
const cm=S.dash.cases||{};const cases=S.casesData||[];
const priCol={critical:'dg',high:'wn',medium:'ac',low:'td'};
const stCol={open:'bg-w',investigating:'bg-i',pending_vendor:'bg-d',pending_approval:'bg-w',escalated:'bg-h',resolved:'bg-s',closed:'bg-d'};
const slaCol={breached:'bg-h',at_risk:'bg-w',on_track:'bg-s',met:'bg-s'};
const active=cases.filter(c=>!['resolved','closed'].includes(c.status));
const resolved=cases.filter(c=>['resolved','closed'].includes(c.status));
return`<div class="fu"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px"><div><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">\uD83D\uDCCB Case Management</h1><p style="font-size:15px;color:var(--tm)">Track investigations, assignments, SLAs, and resolution workflow</p></div>
<button class="bt bt-p bt-sm" data-act="createCase" style="white-space:nowrap">\u2795 New Case</button></div>
<div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
${statCard('\uD83D\uDCCB','Active Cases',cm.active||0,`${cm.unassigned||0} unassigned`,'#2563eb')}
${statCard('\u26A0\uFE0F','SLA Breached',cm.sla?.breached||0,`${cm.sla?.atRisk||0} at risk`,'#dc2626')}
${statCard('\u23F1\uFE0F','Avg Resolution',(cm.avgResolutionHours||0)+'h',cm.resolved+' resolved','#059669')}
${statCard('\uD83D\uDCB0','Amount at Risk',fmt(cm.totalAmountAtRisk||0),'across active cases','#d97706')}
</div>
<div class="cd" style="padding:12px 20px;margin-bottom:20px;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
<span style="font-size:12px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:.06em">SLA Targets:</span>
${[['Critical',S.policy?.sla_critical_hours||4,'#dc2626'],['High',S.policy?.sla_high_hours||24,'#d97706'],['Medium',S.policy?.sla_medium_hours||72,'#2563eb'],['Low',S.policy?.sla_low_hours||168,'#64748b']].map(([l,h,c])=>`<span style="font-size:12px;color:${c};font-weight:600"><span style="display:inline-block;width:8px;height:8px;background:${c};border-radius:50%;margin-right:4px"></span>${l}: ${h}h</span>`).join('')}
<span style="font-size:11px;color:var(--td);margin-left:auto">Configure in AP Policy \u2192</span>
</div>
${active.length?`<div class="cd" style="padding:20px;margin-bottom:20px"><div style="font-size:14px;font-weight:700;color:var(--tm);text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px">Active Cases (${active.length})</div>
<div style="overflow-x:auto"><table class="tb" style="width:100%;min-width:1000px"><thead><tr><th>Case ID</th><th>Priority</th><th>Title</th><th>Vendor</th><th style="text-align:right">Amount</th><th>Status</th><th>SLA</th><th>Assigned</th><th>Created</th><th style="min-width:200px">Actions</th></tr></thead><tbody>
${active.map(c=>{const sla=c._slaStatus||{};return`<tr>
<td class="mn fb" style="font-size:13px">${E(c.id)}</td>
<td><span style="color:var(--${priCol[c.priority]||'td'});font-weight:700;font-size:12px;text-transform:uppercase">\u25CF ${c.priority}</span></td>
<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px" title="${E(c.title)}">${E(c.title)}</td>
<td style="font-size:13px;color:var(--tm)">${E(c.vendor||'\u2014')}</td>
<td class="mn fb" style="text-align:right;font-size:13px">${c.amountAtRisk?fmtx(c.amountAtRisk,c.currency):'\u2014'}</td>
<td><span class="bg ${stCol[c.status]||'bg-d'}">${c.status.replace(/_/g,' ')}</span></td>
<td><span class="bg ${slaCol[sla.status]||'bg-d'}">${sla.status==='breached'?'\u{1F534} Breached':sla.status==='at_risk'?'\u{1F7E1} '+Math.round(sla.hoursRemaining||0)+'h left':'\u{1F7E2} On track'}</span></td>
<td style="font-size:13px">${c.assignedTo?E(c.assignedTo):'<span style="color:var(--dg);font-weight:600">Unassigned</span>'}</td>
<td style="font-size:12px;color:var(--td)">${D(c.createdAt)}</td>
<td><div style="display:flex;gap:4px;flex-wrap:nowrap">
${c.status!=='resolved'&&c.status!=='closed'?`<button class="bt bt-sm" data-caseaction="resolve" data-caseid="${c.id}" style="font-size:11px;padding:3px 8px;background:var(--okb);color:var(--ok);border:1px solid rgba(16,185,129,.2);white-space:nowrap" title="Resolve this case">\u2713 Resolve</button>`:''}
${c.status!=='escalated'&&c.status!=='resolved'&&c.status!=='closed'?`<button class="bt bt-sm" data-caseaction="escalate" data-caseid="${c.id}" style="font-size:11px;padding:3px 8px;background:var(--wnb);color:var(--wn);border:1px solid rgba(217,119,6,.2);white-space:nowrap" title="Escalate to manager">\u26A0 Escalate</button>`:''}
<button class="bt bt-sm bt-p" data-caseaction="detail" data-caseid="${c.id}" style="font-size:11px;padding:3px 8px;white-space:nowrap" title="View full case details">\uD83D\uDD0D Detail</button>
</div></td></tr>`}).join('')}
</tbody></table></div></div>`:'<div class="cd" style="padding:40px;text-align:center;color:var(--td)">No active cases \u2014 all clear!</div>'}
${resolved.length?`<div class="cd" style="padding:20px;margin-top:12px"><div style="font-size:14px;font-weight:700;color:var(--tm);text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px">Resolved & Closed (${resolved.length})</div>
<table class="tb" style="width:100%;opacity:.7"><thead><tr><th>Case ID</th><th>Title</th><th>Vendor</th><th>Resolution</th><th>Resolved By</th><th>Date</th></tr></thead><tbody>
${resolved.slice(0,10).map(c=>`<tr>
<td class="mn" style="font-size:12px">${E(c.id)}</td>
<td style="font-size:13px">${E(c.title)}</td>
<td style="font-size:13px;color:var(--tm)">${E(c.vendor||'\u2014')}</td>
<td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${E(c.resolution||'\u2014')}</td>
<td style="font-size:12px">${E(c.resolvedBy||c.closedBy||'\u2014')}</td>
<td style="font-size:12px;color:var(--td)">${D(c.resolvedAt||c.closedAt)}</td></tr>`).join('')}
</tbody></table></div>`:''}</div>`}

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
<div class="cd" style="padding:20px;margin-bottom:16px"><div style="font-size:14px;font-weight:700;color:var(--tm);margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em">\uD83D\uDCCB Case SLA Targets (hours)</div>
<div style="font-size:12px;color:var(--td);margin-bottom:10px">Maximum time to resolve a case before it is auto-escalated. Cases at 75% of their SLA deadline are flagged as at-risk.</div>
${row('Critical SLA (hours)','sla_critical_hours','int')}
${row('High SLA (hours)','sla_high_hours','int')}
${row('Medium SLA (hours)','sla_medium_hours','int')}
${row('Low SLA (hours)','sla_low_hours','int')}</div>
<div style="display:flex;gap:10px"><button class="bt bt-p" data-act="save-policy">\u2714 Save Policy</button><button class="bt bt-g" data-act="reset-policy">\u21BA Reset to Default</button></div></div>`}
const POLICY_PRESETS_MAP={manufacturing:'three_way',services:'two_way',enterprise_default:'flexible',strict_audit:'three_way'};

function modelTrainingTab(){
const ft=S.ft.status||{};
const configured=ft.configured||false;
const corrections=ft.corrections_available||0;
const required=ft.corrections_required||50;
const ready=ft.ready_to_train||false;
const activeJob=ft.active_job;
const activeModel=ft.active_custom_model;
const history=ft.history||[];
const pct=Math.min(100,Math.round((corrections/required)*100));
const loading=S.ft.loading;

return`<div class="fu"><div style="margin-bottom:24px"><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">\uD83E\uDDEC Model Training</h1>
<p style="font-size:15px;color:var(--tm)">Fine-tune a custom extraction model on your correction data via Together.ai</p></div>

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px">
<div class="cd" style="padding:20px;text-align:center">
<div style="font-size:32px;font-weight:800;color:${configured?'var(--ok)':'var(--dg)'}">${configured?'\u2713':'\u2717'}</div>
<div style="font-size:14px;font-weight:700;margin:4px 0">Together.ai</div>
<div style="font-size:12px;color:var(--td)">${configured?'API key configured':'API key not set'}</div>
</div>
<div class="cd" style="padding:20px;text-align:center">
<div style="font-size:32px;font-weight:800;color:${ready?'var(--ok)':'var(--wn)'}">${corrections}</div>
<div style="font-size:14px;font-weight:700;margin:4px 0">Corrections</div>
<div style="font-size:12px;color:var(--td)">${ready?'Ready to train':corrections+' / '+required+' needed'}</div>
</div>
<div class="cd" style="padding:20px;text-align:center">
<div style="font-size:32px;font-weight:800;color:${activeModel?'var(--ok)':'var(--td)'}">${activeModel?'\uD83E\uDD16':'\u2014'}</div>
<div style="font-size:14px;font-weight:700;margin:4px 0">Custom Model</div>
<div style="font-size:12px;color:var(--td)">${activeModel?'Active in ensemble':'Not trained yet'}</div>
</div></div>

${!configured?`
<div class="cd" style="padding:24px;border-left:4px solid var(--wn);margin-bottom:20px">
<div style="font-size:15px;font-weight:700;margin-bottom:8px">\u26A0\uFE0F Setup Required</div>
<div style="font-size:13px;color:var(--tm);line-height:1.7">
<p style="margin-bottom:8px">To enable model training, add your Together.ai API key as an environment variable on Railway:</p>
<div style="background:var(--sf);padding:12px 16px;border-radius:8px;font-family:monospace;font-size:13px;margin-bottom:8px;border:1px solid var(--bd)">TOGETHER_API_KEY=your-key-here</div>
<p>Get your free key at <strong>api.together.xyz</strong> \u2192 Settings \u2192 API Keys</p>
</div></div>`:''}

<div class="cd" style="padding:24px;margin-bottom:20px">
<div style="font-size:15px;font-weight:700;margin-bottom:12px">\uD83D\uDCCA Training Data Progress</div>
<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
<div style="flex:1;height:12px;background:var(--sf);border-radius:6px;overflow:hidden;border:1px solid var(--bd)">
<div style="height:100%;width:${pct}%;background:${ready?'var(--ok)':'var(--ac)'};border-radius:6px;transition:width .5s ease"></div>
</div>
<div style="font-size:13px;font-weight:700;color:${ready?'var(--ok)':'var(--td)'}">
${pct}%</div></div>
<div style="font-size:12px;color:var(--td)">${corrections} corrections collected out of ${required} minimum. ${ready?'You can start training!':'Keep processing invoices and correcting extractions to build training data.'}</div>
</div>

${activeJob&&(activeJob.status==='pending'||activeJob.status==='running')?`
<div class="cd" style="padding:24px;margin-bottom:20px;border-left:4px solid var(--ac)">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
<div class="sp" style="width:18px;height:18px;border-width:2px"></div>
<div style="font-size:15px;font-weight:700">Training in Progress</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
<div><div style="font-size:11px;color:var(--td);text-transform:uppercase;letter-spacing:.06em">Status</div><div style="font-size:14px;font-weight:600;color:var(--ac)">${activeJob.status==='pending'?'Queued':'Training...'}</div></div>
<div><div style="font-size:11px;color:var(--td);text-transform:uppercase;letter-spacing:.06em">Base Model</div><div style="font-size:14px;font-weight:600">Qwen 7B</div></div>
<div><div style="font-size:11px;color:var(--td);text-transform:uppercase;letter-spacing:.06em">Method</div><div style="font-size:14px;font-weight:600">LoRA</div></div>
</div>
<div style="font-size:12px;color:var(--td)">Job ID: ${activeJob.job_id||'...'} \u00B7 Started: ${activeJob.started_at?new Date(activeJob.started_at).toLocaleString():'...'}</div>
<button class="bt bt-sm bt-g" data-act="ft-poll" style="margin-top:12px" ${loading?'disabled':''}>
${loading?'Checking...':'\u{1F504} Check Progress'}</button>
</div>`:''}

${activeModel?`
<div class="cd" style="padding:24px;margin-bottom:20px;border-left:4px solid var(--ok)">
<div style="font-size:15px;font-weight:700;margin-bottom:10px">\u2705 Custom Model Active</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
<div><div style="font-size:11px;color:var(--td);text-transform:uppercase;letter-spacing:.06em">Model</div><div style="font-size:13px;font-weight:600;word-break:break-all">${activeModel}</div></div>
<div><div style="font-size:11px;color:var(--td);text-transform:uppercase;letter-spacing:.06em">Ensemble</div><div style="font-size:13px;font-weight:600">Sonnet + Haiku + Custom LoRA</div></div>
</div>
<div style="font-size:12px;color:var(--tm);margin-bottom:12px">This model was trained on your correction data and is participating in the extraction ensemble with 1.2x weight.</div>
<button class="bt bt-sm bt-g" data-act="ft-deactivate" style="color:var(--dg)" ${loading?'disabled':''}>
${loading?'...':'Deactivate Custom Model'}</button>
</div>`:''}

<div style="display:flex;gap:12px;margin-bottom:20px">
<button class="bt bt-p" data-act="ft-refresh" ${loading?'disabled':''} style="flex:1">
${loading?'<span class="sp" style="width:14px;height:14px;border-width:2px;margin-right:6px"></span>Loading...':'\u{1F504} Refresh Status'}</button>

${ready&&configured&&!activeJob?.status?.match(/pending|running/)?`
<button class="bt" data-act="ft-start" ${loading?'disabled':''} style="flex:1;background:#0891b2;color:white;font-weight:700">
${loading?'Starting...':'\uD83D\uDE80 Start Fine-Tuning'}</button>`:`
<button class="bt bt-g" disabled style="flex:1;opacity:.5;cursor:not-allowed">
\uD83D\uDE80 ${!configured?'API Key Required':!ready?corrections+'/'+required+' Corrections Needed':'Training in Progress...'}</button>`}

<button class="bt bt-g" data-act="ft-preview" ${loading?'disabled':''} style="flex:1">
${loading?'...':'\uD83D\uDC41 Preview Training Data'}</button>
</div>

${history.length?`
<div class="cd" style="padding:24px">
<div style="font-size:15px;font-weight:700;margin-bottom:12px">\uD83D\uDCDC Training History</div>
<table style="width:100%;font-size:13px;border-collapse:collapse">
<tr style="text-align:left;border-bottom:2px solid var(--bd)">
<th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--td)">Job ID</th>
<th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--td)">Status</th>
<th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--td)">Started</th>
<th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--td)">Model</th>
</tr>
${history.map(j=>`<tr style="border-bottom:1px solid var(--bd)">
<td style="padding:8px 10px;font-family:monospace;font-size:11px">${(j.job_id||'').slice(0,16)}...</td>
<td style="padding:8px 10px"><span class="bg ${j.status==='completed'?'bg-s':j.status==='running'?'bg-w':'bg-d'}" style="font-size:11px;padding:2px 8px">${j.status||'unknown'}</span></td>
<td style="padding:8px 10px;font-size:12px;color:var(--td)">${j.started_at?new Date(j.started_at).toLocaleDateString():'-'}</td>
<td style="padding:8px 10px;font-size:11px;color:var(--td)">${j.output_model||'-'}</td>
</tr>`).join('')}
</table></div>`:''}

${S.ft.preview?`
<div class="cd" style="padding:24px;margin-top:20px">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
<div style="font-size:15px;font-weight:700">\uD83D\uDC41 Training Data Preview</div>
<button class="bt bt-sm bt-g" data-act="ft-close-preview">\u2715 Close</button>
</div>
<div style="font-size:13px;color:var(--td);margin-bottom:8px">${S.ft.preview.example_count||0} training examples from ${S.ft.preview.vendors_covered||0} vendors \u00B7 ${((S.ft.preview.file_size_bytes||0)/1024).toFixed(1)}KB</div>
<div style="background:var(--sf);padding:12px;border-radius:8px;font-family:monospace;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap;border:1px solid var(--bd);color:var(--tm)">${S.ft.preview.error||'Training data prepared successfully. '+S.ft.preview.example_count+' examples ready for fine-tuning.'}</div>
</div>`:''}</div>`}

function upload(){const res=S.uploadResults||[];const hasResults=res.length>0;const fails=res.filter(r=>!r.ok);
return`<div class="fu"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px"><div><h1 style="font-size:26px;font-weight:800;margin-bottom:4px">${I.up} Upload Document</h1><p style="font-size:15px;color:var(--tm)">Upload invoices, POs, GRNs, contracts, or credit/debit notes</p></div>
<button class="bt bt-sm ${S.showManual?'bt-p':'bt-g'}" data-act="toggleManual" style="white-space:nowrap">\u270F\uFE0F Manual Entry</button></div>
${S.showManual?manualForm():`
<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">${['auto','invoice','purchase_order','contract','goods_receipt','credit_note','debit_note'].map(t=>`<button class="bt bt-sm ${S.ut===t?'bt-p':'bt-g'}" data-ut="${t}">${{auto:'Auto-Detect',invoice:'Invoice',purchase_order:'Purchase Order',contract:'Contract',goods_receipt:'Goods Receipt',credit_note:'Credit Note',debit_note:'Debit Note'}[t]}</button>`).join('')}</div>
<div class="uz" id="uz"><div style="font-size:44px;margin-bottom:16px">${I.up}</div><div style="font-size:17px;font-weight:700;margin-bottom:8px">Drop files here or click to upload</div><div style="font-size:14.5px;color:var(--td);margin-bottom:16px">PDF, JPEG, PNG \u2014 single or multiple files supported</div>
<span class="bg bg-i">${I.sp} AI Extraction Active</span>
<div style="margin-top:14px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center"><span style="font-size:11px;color:var(--td);font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:3px 0">Multilingual:</span>${[['EN','English'],['中文','Chinese'],['日本語','Japanese'],['한국어','Korean'],['हिन्दी','Hindi'],['DE','German'],['FR','French'],['ES','Spanish'],['PT','Portuguese'],['العربية','Arabic']].map(([code,name])=>'<span style="font-size:11px;padding:3px 8px;border-radius:6px;background:var(--sa);color:var(--tm);border:1px solid var(--bd);cursor:default" title="'+name+'">'+code+'</span>').join('')}</div>
<input type="file" id="fi" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff" multiple style="display:none"></div>`}
${hasResults?`<div class="cd" style="margin-top:20px;padding:20px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div style="font-size:14px;font-weight:700;color:var(--tm);text-transform:uppercase;letter-spacing:.06em">Upload Results</div><button class="bt bt-sm bt-g" data-act="clearResults" style="font-size:11px;padding:3px 10px">\u2715 Clear</button></div>
<table class="tb" style="width:100%"><thead><tr><th>File</th><th>Status</th><th>Type</th><th>Confidence</th><th>Anomalies</th></tr></thead><tbody>
${res.map(r=>`<tr><td style="font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${E(r.name)}">${E(r.name)}</td>
<td>${r.ok?'<span class="bg bg-i">\u2713 Extracted</span>':'<span class="bg bg-h">\u2717 Failed</span>'}</td>
<td>${r.ok?`<span class="bg ${typBg(r.type)}">${typLabel(r.type)}</span>`:`<span style="color:var(--dg);font-size:12px">${E(r.error||'Unknown error')}</span>`}</td>
<td>${r.ok?Math.round(r.confidence)+'%':'\u2014'}</td>
<td>${r.ok?(r.anomalies>0?`<span class="bg bg-h">${r.anomalies}</span>`:'0'):'\u2014'}</td></tr>`).join('')}
</tbody></table>
${fails.length?`<div style="margin-top:12px;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px"><div style="font-size:13px;font-weight:600;color:#991b1b;margin-bottom:6px">${fails.length} file${fails.length>1?'s':''} could not be extracted</div><div style="font-size:12px;color:#7f1d1d">Use <strong>Manual Entry</strong> to index ${fails.length>1?'these documents':'this document'} by hand, or re-upload with a clearer scan.</div></div>`:''}</div>`:''}
${!S.showManual?`<div class="cd" style="margin-top:24px;padding:22px"><div style="font-size:14px;font-weight:700;color:var(--tm);margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em">How AuditLens Works</div>
${[{n:'1',t:'Upload',d:'Invoices, POs, contracts, credit/debit notes \u2014 in any of '+(S.ps.lc||10)+' languages'},{n:'2',t:'AI Ensemble Extract',d:(S.ps.ml||'Dual-model')+' parallel extraction with agentic dispute resolution on conflicts'},{n:'3',t:'AI + Rule Anomaly Scan',d:'RAG-augmented AI analysis + '+(S.ps.rc||17)+' deterministic rules + 3-way PO-GRN matching'},{n:'4',t:'Triage & Case Management',d:'Policy-driven routing: auto-approve / review / block \u00B7 cases auto-create with SLA tracking'}].map(s=>`<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px"><div style="width:28px;height:28px;border-radius:8px;flex-shrink:0;background:var(--ag);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--al);font-family:var(--mn)">${s.n}</div><div><div style="font-size:14.5px;font-weight:600">${s.t}</div><div style="font-size:14px;color:var(--td);margin-top:2px">${s.d}</div></div></div>`).join('')}
<div style="margin-top:16px;padding:14px 18px;background:linear-gradient(135deg,#eff6ff,#f0fdf4);border:1px solid #bfdbfe;border-radius:10px"><div style="font-size:13px;font-weight:700;color:#1e40af;margin-bottom:6px">\uD83C\uDF10 Multilingual Document Processing</div><div style="font-size:13px;color:#334155;line-height:1.5">Process invoices from global vendors in <b>10 languages</b>: English, Chinese (\u4E2D\u6587), Japanese (\u65E5\u672C\u8A9E), Korean (\uD55C\uAD6D\uC5B4), Hindi (\u0939\u093F\u0928\u094D\u0926\u0940), German, French, Spanish, Portuguese, and Arabic. The AI automatically detects the language, extracts fields with locale-aware number and date formats, validates tax rates against regional tax systems (VAT, GST, MwSt, TVA, \u589E\u503C\u7A0E, \u6D88\u8CBB\u7A0E), and provides English translations for vendor names and line items.</div></div></div>`:''}</div>`}
function manualForm(){const fs='style="width:100%;padding:10px 12px;border:1px solid var(--bd);border-radius:8px;font-size:14px;font-family:var(--ft);background:var(--bg);color:var(--tx)"';
return`<div class="cd" style="padding:24px"><form id="manualForm"><div style="font-size:16px;font-weight:700;margin-bottom:16px">\u270F\uFE0F Manual Document Entry</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
<div><label style="font-size:12px;font-weight:600;color:var(--td);display:block;margin-bottom:4px">Document Type *</label><select name="type" ${fs}><option value="invoice">Invoice</option><option value="purchase_order">Purchase Order</option><option value="goods_receipt">Goods Receipt</option><option value="contract">Contract</option><option value="credit_note">Credit Note</option><option value="debit_note">Debit Note</option></select></div>
<div><label style="font-size:12px;font-weight:600;color:var(--td);display:block;margin-bottom:4px">Document Number *</label><input name="documentNumber" placeholder="e.g. INV-2024-001" ${fs}></div>
<div><label style="font-size:12px;font-weight:600;color:var(--td);display:block;margin-bottom:4px">Vendor *</label><input name="vendor" placeholder="Vendor name" ${fs}></div>
<div><label style="font-size:12px;font-weight:600;color:var(--td);display:block;margin-bottom:4px">Amount *</label><input name="amount" type="number" step="0.01" placeholder="0.00" ${fs}></div>
<div><label style="font-size:12px;font-weight:600;color:var(--td);display:block;margin-bottom:4px">Currency</label><select name="currency" ${fs}><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="INR">INR</option><option value="AED">AED</option><option value="JPY">JPY</option></select></div>
<div><label style="font-size:12px;font-weight:600;color:var(--td);display:block;margin-bottom:4px">Issue Date</label><input name="issueDate" type="date" ${fs}></div>
<div><label style="font-size:12px;font-weight:600;color:var(--td);display:block;margin-bottom:4px">PO Reference</label><input name="poReference" placeholder="PO number (if any)" ${fs}></div>
<div style="grid-column:span 2"><label style="font-size:12px;font-weight:600;color:var(--td);display:block;margin-bottom:4px">Notes</label><textarea name="notes" rows="2" placeholder="Additional context or reason for manual entry" ${fs}></textarea></div>
</div>
<div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end"><button type="button" class="bt bt-sm bt-g" data-act="toggleManual">Cancel</button><button type="button" class="bt bt-sm bt-p" data-act="manualSave">\u2713 Save Document</button></div></form></div>`}

function processing(){const st=['Reading document','Extracting fields & line items','Matching to purchase orders','Cross-referencing contracts','Running anomaly detection','Computing confidence score'];const cs=S.proc?S.proc.st:0;const isBulk=S.proc&&S.proc.total>1;
return`<div class="po"><div class="cd" style="padding:44px 52px;text-align:center;max-width:440px;border:1px solid rgba(26,86,219,.15);box-shadow:0 16px 48px rgba(0,0,0,.12)"><div style="width:52px;height:52px;border-radius:14px;margin:0 auto 20px;background:linear-gradient(135deg,var(--ac),#3b82f6);display:flex;align-items:center;justify-content:center;animation:pulse 1.5s ease-in-out infinite;color:#fff;font-size:20px">${I.sp}</div><div style="font-size:17px;font-weight:700;margin-bottom:6px">${isBulk?`Processing ${S.proc.cur} of ${S.proc.total}`:'Analyzing Document'}</div><div style="font-size:13px;color:var(--td);margin-bottom:20px">${E(S.proc.fn)}</div>
${isBulk?`<div style="height:6px;background:var(--sa);border-radius:3px;overflow:hidden;margin-bottom:16px"><div style="height:100%;width:${Math.round(S.proc.cur/S.proc.total*100)}%;background:var(--ok);border-radius:3px;transition:width .3s"></div></div>`:''}
<div style="text-align:left">${st.map((s,i)=>`<div style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:5px;color:${i<=cs?'var(--ok)':'var(--td)'}"><span style="font-size:12px">${i<=cs?I.ck:'\u25CB'}</span> ${s}</div>`).join('')}</div>
<div style="height:3px;background:var(--sa);border-radius:2px;overflow:hidden;margin-top:20px"><div style="height:100%;background:linear-gradient(90deg,var(--ac),#3b82f6);border-radius:2px;animation:loading 1.8s ease-in-out infinite"></div></div></div></div>`}

function modal(){const it=S.sel;if(!it)return'';const iv=it.type==='invoice';const isCtr=it.type==='contract';const cur=it.currency||'USD';
const docAnoms=S.anomalies.filter(a=>a.invoiceId===it.id&&a.status==='open');
const docCases=(S.casesData||[]).filter(c=>c.invoiceId===it.id&&!['closed'].includes(c.status));
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

return`<div class="mo" data-cls role="dialog" aria-modal="true" aria-label="Document details"><div class="cd" style="padding:0;max-width:${vm==='split'?'1100':'620'}px;width:96%;max-height:90vh;overflow:hidden;border:1px solid var(--bh);display:flex;flex-direction:column" onclick="event.stopPropagation()">
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
${it.vendorEnglish&&it.vendorEnglish!==it.vendor?roField('Vendor (English)',it.vendorEnglish):''}
${eField('Subtotal','subtotal',it.subtotal,'number')}
${roField('Tax',it.totalTax?fmtx(it.totalTax,cur)+' ('+(it.taxDetails||[]).map(t=>t.type+' '+t.rate+'%').join(', ')+')':'\u2014')}
${roField('Total',fmtx(it.amount,cur))}
${eField('Issued','issueDate',it.issueDate,'date')}
${eField(iv?'Due':'Delivery',iv?'dueDate':'deliveryDate',iv?it.dueDate:it.deliveryDate,'date')}
${roField('Status',(it.status||'').replace(/_/g,' ').toUpperCase())}
${roField('Confidence',Math.round(it.confidence)+'%')}
${roField('Uploaded By',it.uploadedBy||'\u2014')}
${roField('Uploaded At',D(it.extractedAt)||'\u2014')}
${it.confidenceFactors?`<div style="margin:0 0 8px 0;padding:8px 12px;background:var(--sa);border:1px solid var(--bd);border-radius:8px"><div style="font-size:12px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Confidence Breakdown</div>${Object.entries(it.confidenceFactors).map(([k,v])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px;border-bottom:1px solid var(--bd)"><span style="color:var(--tm)">${k.replace(/_/g,' ')}<span style="color:var(--td);font-size:12px;margin-left:4px">(${Math.round(v.weight*100)}%)</span></span><div style="display:flex;align-items:center;gap:6px"><div style="width:60px;height:4px;background:var(--bd);border-radius:2px;overflow:hidden"><div style="width:${v.score}%;height:100%;background:${v.score>=80?'var(--ok)':v.score>=50?'var(--wn)':'var(--dg)'};border-radius:2px"></div></div><span class="mn fb" style="color:${v.score>=80?'var(--ok)':v.score>=50?'var(--wn)':'var(--dg)'};min-width:24px;text-align:right">${v.score}</span></div></div>`).join('')}</div>`:''}
${it.ensembleData&&it.ensembleData.fields_agreed!=null?`<div style="margin:0 0 8px 0;padding:8px 12px;background:${it.ensembleData.ensemble_confidence==='high'?'#ecfdf5':it.ensembleData.ensemble_confidence==='medium'?'#fffbeb':'#fef2f2'};border:1px solid ${it.ensembleData.ensemble_confidence==='high'?'#a7f3d0':it.ensembleData.ensemble_confidence==='medium'?'#fde68a':'#fecaca'};border-radius:8px"><div style="font-size:12px;font-weight:700;color:var(--td);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">\uD83E\uDD1D Ensemble Verification</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:6px">${[['Fields Agreed',it.ensembleData.fields_agreed||0,'var(--ok)'],['Fields Disputed',it.ensembleData.fields_disputed||0,(it.ensembleData.fields_disputed||0)>0?'var(--dg)':'var(--ok)'],['Agreement',(it.ensembleData.agreement_rate||0)+'%',(it.ensembleData.agreement_rate||0)>=90?'var(--ok)':(it.ensembleData.agreement_rate||0)>=70?'var(--wn)':'var(--dg)']].map(([l,v,c])=>`<div style="text-align:center"><div style="font-size:18px;font-weight:700;color:${c}">${v}</div><div style="font-size:11px;color:var(--td)">${l}</div></div>`).join('')}</div>${it.ensembleData.resolution_applied?`<div style="font-size:13px;color:var(--al);padding:3px 0">\u2714 Disputes auto-resolved by re-examination (${it.ensembleData.fields_resolved?.join(', ')||''})</div>`:''}${it.ensembleData.math_validation?`<div style="font-size:13px;color:${it.ensembleData.math_validation.passed?'var(--ok)':'var(--dg)'};padding:3px 0">${it.ensembleData.math_validation.passed?'\u2713 Math validation passed':'\u26A0 Math issues: '+it.ensembleData.math_validation.issues.map(i=>i.detail).join('; ')}</div>`:''}<div style="font-size:12px;color:var(--td);padding:3px 0">Models: ${it.ensembleData.models_used?.map(m=>m.split('-').slice(0,2).join(' ')).join(' + ')||'N/A'} \u00B7 ${it.ensembleData.total_latency_ms||0}ms</div>${it.ensembleData.vendor_deviations?.length?`<div style="font-size:13px;color:var(--wn);padding:3px 0">\u26A0 Vendor: ${it.ensembleData.vendor_deviations.map(d=>d.detail).join('; ')}</div>`:''}</div>`:''}
${(()=>{const fc=it.fieldConfidence;if(!fc)return'';const disputed=Object.entries(fc).filter(([k,v])=>v.status==='disputed'&&v.a!==undefined);if(!disputed.length)return'';return`<div style="margin:0 0 8px 0;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px"><div style="font-size:12px;font-weight:700;color:var(--dg);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">\u26A0 Disputed Fields — Verify Manually</div>${disputed.map(([k,v])=>`<div style="font-size:13px;color:var(--tm);padding:2px 0"><b>${k.replace(/_/g,' ')}</b>: Primary=${JSON.stringify(v.a)}, Secondary=${JSON.stringify(v.b)}</div>`).join('')}</div>`})()}
${roField('Source',{'ensemble':'Ensemble AI','ensemble_primary_only':'Ensemble (Primary Only)','ensemble_secondary_only':'Ensemble (Secondary Only)','claude_api':'Claude AI','manual':'Manual Entry','claude_api_parse_error':'Claude AI (parse error)','claude_api_error':'Claude AI (error)','no_api_key':'No API Key'}[it.extractionSource]||'Claude AI')}
${it.documentLanguage&&it.documentLanguage!=='en'?roField('Language',{'zh':'Chinese \u4E2D\u6587','ja':'Japanese \u65E5\u672C\u8A9E','ko':'Korean \uD55C\uAD6D\uC5B4','hi':'Hindi \u0939\u093F\u0928\u094D\u0926\u0940','de':'German Deutsch','fr':'French Fran\u00E7ais','es':'Spanish Espa\u00F1ol','pt':'Portuguese Portugu\u00EAs','ar':'Arabic \u0627\u0644\u0639\u0631\u0628\u064A\u0629'}[it.documentLanguage]||it.documentLanguage):''}
${it.locale&&it.locale!=='en_US'?roField('Locale',it.locale):''}
${eField('Terms','paymentTerms',it.paymentTerms)}
${eField('Currency','currency',it.currency)}
${iv?eField('PO Reference','poReference',it.poReference):''}
</div>
${it.triageLane&&it.triageReasons?`<div style="margin-bottom:12px;padding:10px 14px;background:${it.triageLane==='AUTO_APPROVE'?'#ecfdf5':it.triageLane==='BLOCK'?'#fef2f2':'#fffbeb'};border:1px solid ${it.triageLane==='AUTO_APPROVE'?'#a7f3d0':it.triageLane==='BLOCK'?'#fecaca':'#fde68a'};border-radius:10px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span class="bg ${laneBg(it.triageLane)}">${laneLabel(it.triageLane)}</span><span style="font-size:13px;color:var(--td)">AI Triage \u00B7 ${Math.round(it.triageConfidence||0)}% confidence</span></div>${(it.triageReasons||[]).map(r=>`<div style="font-size:14px;color:var(--tm);line-height:1.6;padding:1px 0">\u2022 ${E(r)}</div>`).join('')}</div>`:''}
${it.earlyPaymentDiscount?`<div style="margin-bottom:12px;padding:8px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;font-size:14px;color:var(--ok);font-weight:500">${I.zp} Early payment: ${it.earlyPaymentDiscount.discount_percent}% off within ${it.earlyPaymentDiscount.days} days (save ${fmtx((it.subtotal||it.amount)*(it.earlyPaymentDiscount.discount_percent/100),cur)})</div>`:''}
${docAnoms.length>0?`<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--dg);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">${I.wn} ${docAnoms.length} Anomal${docAnoms.length===1?'y':'ies'}</div>
${docAnoms.map(a=>`<div style="padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:4px;font-size:14px"><div style="display:flex;justify-content:space-between;margin-bottom:3px"><span class="bg ${sevBg(a.severity)}" style="font-size:12px">${a.severity} \u00B7 ${(a.type||'').replace(/_/g,' ')}</span><span class="mn fb" style="color:var(--dg);font-size:14px">${fmtx(Math.abs(a.amount_at_risk||0),cur)}</span></div><div style="color:var(--tm);line-height:1.5;font-size:14px">${E(a.description)}</div></div>`).join('')}</div>`:''}
${docCases.length>0?`<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--ac);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">\uD83D\uDCCB ${docCases.length} Linked Case${docCases.length===1?'':'s'}</div>
${docCases.map(c=>`<div style="padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:4px;font-size:13px;cursor:pointer" data-caseaction="detail" data-caseid="${c.id}"><div style="display:flex;justify-content:space-between;align-items:center"><div style="display:flex;gap:6px;align-items:center"><span class="mn fb" style="font-size:12px">${E(c.id)}</span><span style="color:${{critical:'#dc2626',high:'#d97706',medium:'#2563eb',low:'#64748b'}[c.priority]||'#64748b'};font-weight:700;font-size:11px;text-transform:uppercase">\u25CF ${c.priority}</span></div><span class="bg ${{'open':'bg-w','investigating':'bg-i','pending_vendor':'bg-d','escalated':'bg-h','resolved':'bg-s'}[c.status]||'bg-d'}">${c.status.replace(/_/g,' ')}</span></div><div style="color:var(--tm);margin-top:3px">${E(c.title)}</div></div>`).join('')}</div>`:''}
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
  // Keyboard: Escape to close modals
  document.onkeydown=e=>{if(e.key==='Escape'){if(S.caseDetail){S.caseDetail=null;R()}else if(S.sel){S.sel=null;S.editing=false;S.editFields={};R()}}};
  document.querySelectorAll('[data-tab]').forEach(e=>e.onclick=async()=>{S.tab=e.dataset.tab;R();
    if(e.dataset.tab==='training'&&!S.ft.status){S.ft.loading=true;R();try{S.ft.status=await api('/api/together/status')}catch(e){}S.ft.loading=false;R()}});
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
  document.querySelectorAll('[data-act="toggleManual"]').forEach(e=>e.onclick=()=>{S.showManual=!S.showManual;R()});
  document.querySelectorAll('[data-act="manualSave"]').forEach(e=>e.onclick=manualEntry);
  document.querySelectorAll('[data-act="clearResults"]').forEach(e=>e.onclick=()=>{S.uploadResults=[];R()});
  // Case management handlers
  document.querySelectorAll('[data-caseaction]').forEach(e=>e.onclick=async ev=>{ev.stopPropagation();const cid=e.dataset.caseid;const act=e.dataset.caseaction;
    if(act==='resolve'){const reason=prompt('Resolution notes (required for audit trail):');if(reason!==null&&reason.trim()){await api(`/api/cases/${cid}/transition`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'resolved',reason:reason.trim()})});await loadAll();toast('Case resolved')}else if(reason!==null){toast('Resolution reason is required')}}
    if(act==='escalate'){const reason=prompt('Escalation reason:');if(reason){await api(`/api/cases/${cid}/escalate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason,escalatedTo:''})});await loadAll();toast('Case escalated')}}
    if(act==='detail'){const cd=await api(`/api/cases/${cid}`);if(cd){S.caseDetail=cd;R()}}
  });
  document.querySelectorAll('[data-act="createCase"]').forEach(e=>e.onclick=async()=>{const title=prompt('Case title:');if(title){const desc=prompt('Description:')||'';const r=await api('/api/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,description:desc,type:'general_investigation',priority:'medium'})});if(r?.success){await loadAll();toast('Case created: '+r.case.id)}}});
  document.querySelectorAll('[data-act="closeCaseDetail"]').forEach(e=>e.onclick=()=>{S.caseDetail=null;R()});
  document.querySelectorAll('[data-act="addCaseNote"]').forEach(e=>e.onclick=async()=>{const cid=e.dataset.caseid;const text=prompt('Add note:');if(text){await api(`/api/cases/${cid}/note`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});const cd=await api(`/api/cases/${cid}`);if(cd){S.caseDetail=cd;R()};toast('Note added')}});
  document.querySelectorAll('[data-act="assignCase"]').forEach(e=>e.onclick=async()=>{const cid=e.dataset.caseid;const name=prompt('Assign to (name):');if(name){await api(`/api/cases/${cid}/assign`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assignedTo:name})});await loadAll();const cd=await api(`/api/cases/${cid}`);if(cd){S.caseDetail=cd;R()};toast('Case assigned to '+name)}});
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

  // Fine-tuning event handlers
  document.querySelectorAll('[data-act="ft-refresh"]').forEach(e=>e.onclick=async()=>{
    S.ft.loading=true;R();
    try{const r=await api('/api/together/status');S.ft.status=r}catch(e){toast('Failed to load status','dg')}
    S.ft.loading=false;R()});
  document.querySelectorAll('[data-act="ft-start"]').forEach(e=>e.onclick=async()=>{
    if(!confirm('Start fine-tuning? This will train a custom Qwen 7B LoRA model on your correction data via Together.ai (~15-30 min, ~$2-5).'))return;
    S.ft.loading=true;R();
    try{const r=await api('/api/together/finetune',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
    if(r.success||r.job_id){toast('Fine-tuning started! Job: '+(r.job_id||'').slice(0,16)+'...','ok');
    const st=await api('/api/together/status');S.ft.status=st}
    else{toast(r.error||'Failed to start','dg')}}catch(e){toast('Error: '+e.message,'dg')}
    S.ft.loading=false;R()});
  document.querySelectorAll('[data-act="ft-poll"]').forEach(e=>e.onclick=async()=>{
    S.ft.loading=true;R();
    try{const job=S.ft.status?.active_job;if(job?.job_id){
    const r=await api('/api/together/job/'+job.job_id);
    if(r.status==='completed'){toast('Training complete! Model activated in ensemble.','ok')}
    else{toast('Status: '+r.status,'wn')}}
    const st=await api('/api/together/status');S.ft.status=st}catch(e){toast('Poll failed','dg')}
    S.ft.loading=false;R()});
  document.querySelectorAll('[data-act="ft-deactivate"]').forEach(e=>e.onclick=async()=>{
    if(!confirm('Deactivate the custom model? The ensemble will revert to Sonnet + Haiku only.'))return;
    S.ft.loading=true;R();
    try{await api('/api/together/deactivate',{method:'POST'});toast('Custom model deactivated','wn');
    const st=await api('/api/together/status');S.ft.status=st}catch(e){toast('Failed','dg')}
    S.ft.loading=false;R()});
  document.querySelectorAll('[data-act="ft-preview"]').forEach(e=>e.onclick=async()=>{
    S.ft.loading=true;R();
    try{const r=await api('/api/together/training-data/preview');S.ft.preview=r}catch(e){toast('Preview failed','dg')}
    S.ft.loading=false;R()});
  document.querySelectorAll('[data-act="ft-close-preview"]').forEach(e=>e.onclick=()=>{S.ft.preview=null;R()});
}
// Initial render — auto-login if token saved
// Initial render — auto-login if token saved, fetch platform stats for landing
if(S.authToken){S.scr='app';R();loadAll()}else{loadPlatformStats().then(()=>R());R()}

const monthNames = ["01","02","03","04","05","06","07","08","09","10","11","12"];

const els = {
  yearSelect: document.getElementById("yearSelect"),
  monthSelect: document.getElementById("monthSelect"),
  rateColumn: document.getElementById("rateColumn"),

  rawTbody: document.querySelector("#rawTable tbody"),
  avgTbody: document.querySelector("#avgTable tbody"),
  firstTbody: document.querySelector("#firstTable tbody"),

  btnCsv: document.getElementById("btnDownloadCsv"),
  btnJson: document.getElementById("btnDownloadJson"),
  btnXls: document.getElementById("btnDownloadXls"),

  btnRefresh: document.getElementById("btnRefresh"),
  btnRunNow: document.getElementById("btnRunNow"),

  bocLatestLink: document.getElementById("bocLatestLink"),

  emailTo: document.getElementById("emailTo"),
  btnEmail: document.getElementById("btnEmail"),

  cnyExposure: document.getElementById("cnyExposure"),
  btnRecalcImpact: document.getElementById("btnRecalcImpact"),
  impactBox: document.getElementById("impactBox"),
};

// ===== AUTH =====
const AUTH = {
  overlay: document.getElementById("authOverlay"),
  loginEmail: document.getElementById("loginEmail"),
  btnLogin: document.getElementById("btnLogin"),
  btnLogout: document.getElementById("btnLogout"),
  regName: document.getElementById("regName"),
  regEmail: document.getElementById("regEmail"),
  btnRegister: document.getElementById("btnRegister"),
  btnCopyRequest: document.getElementById("btnCopyRequest"),
  msg: document.getElementById("authMsg"),
  config: null
};

function normEmail(s){ return (s || "").trim().toLowerCase(); }
function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function showMsg(t){ AUTH.msg.textContent = t || ""; }

async function loadAuthConfig(){
  const resp = await fetch("data/users.json", {cache:"no-store"});
  if(!resp.ok) throw new Error("Missing data/users.json");
  AUTH.config = await resp.json();
  return AUTH.config;
}
function isAllowed(email){
  const e = normEmail(email);
  const allowed = (AUTH.config?.allowed || []).map(normEmail);
  return allowed.includes(e);
}
function setAuthState(isAuthed){
  AUTH.overlay.style.display = isAuthed ? "none" : "flex";
  AUTH.btnLogout.style.display = isAuthed ? "inline-block" : "none";
}
function saveSession(email){ localStorage.setItem("bocfx_authed_email", normEmail(email)); }
function clearSession(){ localStorage.removeItem("bocfx_authed_email"); }

async function tryAutoLogin(){
  const saved = normEmail(localStorage.getItem("bocfx_authed_email"));
  if(saved && isAllowed(saved)){
    setAuthState(true);
    return true;
  }
  setAuthState(false);
  return false;
}

AUTH.btnLogin.addEventListener("click", async ()=>{
  const email = normEmail(AUTH.loginEmail.value);
  if(!email){ showMsg("Enter your email."); return; }

  if(isAllowed(email)){
    saveSession(email);
    showMsg("Approved. Loading dashboard…");
    setAuthState(true);
    await loadMonth();
  } else {
    showMsg("Not approved yet. Use Register to request access.");
    setAuthState(false);
  }
});
AUTH.btnLogout.addEventListener("click", ()=>{
  clearSession();
  setAuthState(false);
  showMsg("Logged out.");
});

function buildAccessRequestText(name, email){
  const link = location.href;
  return `Hello Admin,

Please approve access for:
Name: ${name}
Email: ${email}

Dashboard: ${link}

Thanks.`;
}
AUTH.btnRegister.addEventListener("click", ()=>{
  const name = (AUTH.regName.value || "").trim();
  const email = normEmail(AUTH.regEmail.value);
  const admin = AUTH.config?.adminEmail || "";
  if(!name || !email){ showMsg("Enter name and email to request access."); return; }
  if(!admin){ showMsg("Admin email not configured in data/users.json"); return; }

  const subj = encodeURIComponent("BOC FX Dashboard – Access Request");
  const body = encodeURIComponent(buildAccessRequestText(name, email));
  window.location.href = `mailto:${encodeURIComponent(admin)}?subject=${subj}&body=${body}`;
  showMsg("Email draft opened. If mail is blocked, use Copy Request.");
});
AUTH.btnCopyRequest.addEventListener("click", async ()=>{
  const name = (AUTH.regName.value || "").trim();
  const email = normEmail(AUTH.regEmail.value);
  if(!name || !email){ showMsg("Enter name and email first."); return; }
  const txt = buildAccessRequestText(name, email);
  try{
    await navigator.clipboard.writeText(txt);
    showMsg("Copied. Paste into email/WhatsApp to admin.");
  }catch{
    showMsg("Clipboard blocked. Copy manually:\n" + txt);
  }
});

// ===== DATA =====
let currentData = [];     // month raw
let yearDaily = [];       // year aggregations
let avgChart = null;
let firstChart = null;

function todayISO(){
  const d = new Date();
  return { yyyy: d.getFullYear(), mm: String(d.getMonth()+1).padStart(2,"0") };
}
function setOptions(){
  const now = todayISO();
  const years = [];
  for (let y = now.yyyy - 2; y <= now.yyyy + 1; y++) years.push(y);

  els.yearSelect.innerHTML = "";
  years.forEach(y=>{
    const o = document.createElement("option");
    o.value = y; o.textContent = y;
    els.yearSelect.appendChild(o);
  });
  els.yearSelect.value = String(now.yyyy);

  els.monthSelect.innerHTML = "";
  monthNames.forEach(m=>{
    const o = document.createElement("option");
    o.value = m; o.textContent = m;
    els.monthSelect.appendChild(o);
  });
  els.monthSelect.value = now.mm;
}

function toNum(x){
  const n = Number(String(x).trim());
  return Number.isFinite(n) ? n : null;
}
function pctChange(curr, prev){
  if(!Number.isFinite(prev) || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}
function fmt(n, dp=2){
  if(!Number.isFinite(n)) return "-";
  return Number(n).toFixed(dp);
}

async function loadMonth(){
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const url = `data/${y}/${y}-${m}.json`;

  currentData = [];
  try{
    const resp = await fetch(url, {cache:"no-store"});
    if(resp.ok) currentData = await resp.json();
  }catch{}

  renderRaw();
  await loadYearAgg();
}

function renderRaw(){
  els.rawTbody.innerHTML = "";
  if(currentData.length === 0){
    els.rawTbody.innerHTML = `<tr><td colspan="7">No data captured yet for this month.</td></tr>`;
    return;
  }

  const rows = [...currentData].sort((a,b)=> String(a.publishTime).localeCompare(String(b.publishTime)));
  for(const r of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.date)}</td>
      <td>${esc(r.publishTime)}</td>
      <td>${esc(r.buying)}</td>
      <td>${esc(r.cashBuying)}</td>
      <td>${esc(r.selling)}</td>
      <td>${esc(r.cashSelling)}</td>
      <td>${esc(r.middle)}</td>
    `;
    els.rawTbody.appendChild(tr);
  }
}

async function loadYearAgg(){
  const y = els.yearSelect.value;
  yearDaily = [];

  const allRows = [];
  for(const m of monthNames){
    const url = `data/${y}/${y}-${m}.json`;
    try{
      const resp = await fetch(url, {cache:"no-store"});
      if(!resp.ok) continue;
      const arr = await resp.json();
      allRows.push(...arr);
    }catch{}
  }

  const byDate = new Map();
  for(const r of allRows){
    if(!r?.date) continue;
    if(!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }

  const col = els.rateColumn.value;
  const dates = [...byDate.keys()].sort();

  for(const d of dates){
    const rows = byDate.get(d).sort((a,b)=> String(a.publishTime).localeCompare(String(b.publishTime)));
    const vals = rows.map(x => toNum(x[col])).filter(v=>v !== null);
    if(vals.length === 0) continue;

    const avg = vals.reduce((s,v)=>s+v,0)/vals.length;
    const min = Math.min(...vals);
    const max = Math.max(...vals);

    const firstRow = rows[0];
    const first = toNum(firstRow[col]);
    const firstTime = String(firstRow.publishTime || "");

    yearDaily.push({ date:d, avg, min, max, publishes: vals.length, first, firstTime, _firstRow:firstRow });
  }

  renderAvg();
  renderFirst();
  renderImpact();
}

function chartsAvailable(){
  return typeof Chart !== "undefined";
}

function renderAvg(){
  els.avgTbody.innerHTML = "";
  if(yearDaily.length === 0){
    els.avgTbody.innerHTML = `<tr><td colspan="6">No year data yet.</td></tr>`;
    if(avgChart) avgChart.destroy();
    return;
  }

  for(let i=0;i<yearDaily.length;i++){
    const r = yearDaily[i];
    const prev = yearDaily[i-1];
    const pc = prev ? pctChange(r.avg, prev.avg) : null;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.date)}</td>
      <td>${fmt(r.avg,2)}</td>
      <td>${pc===null ? "-" : fmt(pc,2) + "%"}</td>
      <td>${fmt(r.min,2)}</td>
      <td>${fmt(r.max,2)}</td>
      <td>${r.publishes}</td>
    `;
    els.avgTbody.appendChild(tr);
  }

  if(chartsAvailable()){
    const ctx = document.getElementById("avgChart");
    const labels = yearDaily.map(x=>x.date);
    const series = yearDaily.map(x=>x.avg);
    if(avgChart) avgChart.destroy();
    avgChart = new Chart(ctx, {
      type:"line",
      data:{ labels, datasets:[{ label:"Daily Avg (Selected)", data:series }]},
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
}

function renderFirst(){
  els.firstTbody.innerHTML = "";
  if(yearDaily.length === 0){
    els.firstTbody.innerHTML = `<tr><td colspan="4">No year data yet.</td></tr>`;
    if(firstChart) firstChart.destroy();
    return;
  }

  for(let i=0;i<yearDaily.length;i++){
    const r = yearDaily[i];
    const prev = yearDaily[i-1];
    const pc = (prev && Number.isFinite(r.first) && Number.isFinite(prev.first)) ? pctChange(r.first, prev.first) : null;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.date)}</td>
      <td>${esc(r.firstTime)}</td>
      <td>${r.first===null ? "-" : fmt(r.first,2)}</td>
      <td>${pc===null ? "-" : fmt(pc,2) + "%"}</td>
    `;
    els.firstTbody.appendChild(tr);
  }

  if(chartsAvailable()){
    const ctx = document.getElementById("firstChart");
    const labels = yearDaily.map(x=>x.date);
    const series = yearDaily.map(x=> (x.first ?? null));
    if(firstChart) firstChart.destroy();
    firstChart = new Chart(ctx, {
      type:"line",
      data:{ labels, datasets:[{ label:"Daily First Publish (Selected)", data:series }]},
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
}

// ===== Downloads (Raw CSV/JSON) =====
function toCsv(rows){
  const header = ["date","publishTime","buying","cashBuying","selling","cashSelling","middle"];
  const lines = [header.join(",")];
  for(const r of rows){
    lines.push([
      r.date,
      `"${String(r.publishTime||"").replace(/"/g,'""')}"`,
      r.buying, r.cashBuying, r.selling, r.cashSelling, r.middle
    ].join(","));
  }
  return lines.join("\n");
}
function downloadText(filename, text, mime){
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

els.btnCsv.addEventListener("click", ()=> {
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  downloadText(`boc_usd_cny_raw_${y}-${m}.csv`, toCsv(currentData), "text/csv;charset=utf-8");
});
els.btnJson.addEventListener("click", ()=> {
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  downloadText(`boc_usd_cny_raw_${y}-${m}.json`, JSON.stringify(currentData, null, 2), "application/json");
});

// ===== Excel (2 sheets) WITHOUT any external library =====
function xmlEscape(s){
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}
function makeSheetXml(sheetName, rows){
  const rxml = rows.map(row=>{
    const cells = row.map(v=>`<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`).join("");
    return `<Row>${cells}</Row>`;
  }).join("");
  return `<Worksheet ss:Name="${xmlEscape(sheetName)}"><Table>${rxml}</Table></Worksheet>`;
}
function downloadExcelXml(filename, sheets){
  const workbook = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${sheets.join("\n")}
</Workbook>`;
  downloadText(filename, workbook, "application/vnd.ms-excel;charset=utf-8");
}

els.btnXls.addEventListener("click", ()=>{
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const col = els.rateColumn.value;

  const rawRows = [
    ["All Published Values (Captured)"],
    ["date","publishTime","buying","cashBuying","selling","cashSelling","middle"],
    ...currentData.map(r=>[
      r.date, r.publishTime, r.buying, r.cashBuying, r.selling, r.cashSelling, r.middle
    ])
  ];

  const left = [];
  left.push(["Day Averages"]);
  left.push(["date","avg(selected)","%chg vs prev","min","max","publishes"]);
  for(let i=0;i<yearDaily.length;i++){
    const r = yearDaily[i];
    const prev = yearDaily[i-1];
    const pc = prev ? pctChange(r.avg, prev.avg) : null;
    left.push([r.date, fmt(r.avg,2), pc===null?"":fmt(pc,2)+"%", fmt(r.min,2), fmt(r.max,2), String(r.publishes)]);
  }

  const right = [];
  right.push(["Day First Published Values"]);
  right.push(["date","publishTime","buying","cashBuying","selling","cashSelling","middle"]);
  for(const r of yearDaily){
    const fr = r._firstRow || {};
    right.push([r.date, r.firstTime, fr.buying||"", fr.cashBuying||"", fr.selling||"", fr.cashSelling||"", fr.middle||""]);
  }

  const gap = ["","",""];
  const maxLen = Math.max(left.length, right.length);
  const summaryRows = [];
  for(let i=0;i<maxLen;i++){
    summaryRows.push([...(left[i]||[]), ...gap, ...(right[i]||[])]);
  }

  downloadExcelXml(`boc_usd_cny_${y}-${m}_${col}.xls`, [
    makeSheetXml("All Published Values", rawRows),
    makeSheetXml("Averages & First", summaryRows),
  ]);
});

// ===== Email button =====
els.btnEmail.addEventListener("click", ()=> {
  const to = normEmail(els.emailTo.value);
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const link = location.href;
  const subj = encodeURIComponent(`BOC USD/CNY Dashboard – ${y}-${m}`);
  const body = encodeURIComponent(`Dashboard: ${link}\n\nMonth: ${y}-${m}\n\nUse "Download Excel (2 sheets)".`);
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subj}&body=${body}`;
});

// ===== USD Impact =====
function renderImpact(){
  if(yearDaily.length < 2){
    els.impactBox.innerHTML = `<div class="small">Need at least 2 days of data to compute day-to-day USD impact.</div>`;
    return;
  }
  const exposureCny = Number(els.cnyExposure.value || 0);
  const last = yearDaily[yearDaily.length-1];
  const prev = yearDaily[yearDaily.length-2];

  // Rates are RMB per 100 USD (as published). For USD math, convert to RMB per 1 USD:
  const rToday = (Number(last.avg) / 100);
  const rPrev  = (Number(prev.avg) / 100);

  const usdToday = exposureCny / rToday;
  const usdPrev  = exposureCny / rPrev;
  const usdImpact = usdToday - usdPrev;

  // Sensitivity: +1 RMB per 100 USD ≈ +0.01 CNY/USD
  const rSens = (Number(last.avg) + 1) / 100;
  const usdSens = (exposureCny / rSens) - usdToday;

  els.impactBox.innerHTML = `
    <div><b>Latest Day:</b> ${esc(last.date)} | <b>Prev Day:</b> ${esc(prev.date)}</div>
    <hr style="border:0;border-top:1px solid var(--border);margin:10px 0">
    <div><b>USD Required (Latest):</b> ${usdToday.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
    <div><b>USD Required (Prev):</b> ${usdPrev.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
    <div><b>Day-to-day USD Impact:</b> ${usdImpact.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
    <hr style="border:0;border-top:1px solid var(--border);margin:10px 0">
    <div><b>Sensitivity (USD impact):</b> +1 RMB per 100 USD changes USD by
      <b>${usdSens.toLocaleString(undefined,{maximumFractionDigits:2})}</b>
    </div>
  `;
}
els.btnRecalcImpact.addEventListener("click", renderImpact);

// ===== Wiring =====
els.yearSelect.addEventListener("change", loadMonth);
els.monthSelect.addEventListener("change", loadMonth);
els.rateColumn.addEventListener("change", loadYearAgg);
els.btnRefresh.addEventListener("click", loadMonth);

// ===== Latest link (official) =====
// This page shows latest snapshot + publish time. :contentReference[oaicite:2]{index=2}
els.bocLatestLink.href = "https://www.bankofchina.com/sourcedb/whpj/enindex_1619.html";
els.bocLatestLink.textContent = "Open BOC Latest";

// ===== Run Now =====
// “Run Now” triggers a GitHub Actions workflow_dispatch by opening the Actions page.
// You click “Run workflow” (one click) — no code installation.
els.btnRunNow.addEventListener("click", ()=>{
  alert("Run Now is done from GitHub Actions (one click):\nRepo → Actions → 'Fetch BOC USD Snapshot' → Run workflow.");
  // You can also link directly to Actions:
  // location.href = "https://github.com/<YOU>/<REPO>/actions";
});

// ===== Boot =====
(async function boot(){
  setOptions();
  await loadAuthConfig();
  const ok = await tryAutoLogin();
  if(ok) await loadMonth();
  else showMsg("Enter your email to login. If new, request access.");
})();

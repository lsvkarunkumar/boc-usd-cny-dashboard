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
  emailTo: document.getElementById("emailTo"),
  btnEmail: document.getElementById("btnEmail"),
  cnyExposure: document.getElementById("cnyExposure"),
  btnRecalcImpact: document.getElementById("btnRecalcImpact"),
  impactBox: document.getElementById("impactBox"),
};

// ===== AUTH (Manual approval via data/users.json) =====
const AUTH = {
  overlay: document.getElementById("authOverlay"),
  loginEmail: document.getElementById("loginEmail"),
  btnLogin: document.getElementById("btnLogin"),
  btnLogout: document.getElementById("btnLogout"),
  regName: document.getElementById("regName"),
  regEmail: document.getElementById("regEmail"),
  btnRegister: document.getElementById("btnRegister"),
  msg: document.getElementById("authMsg"),
  config: null
};

function normEmail(s){ return (s || "").trim().toLowerCase(); }

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

function saveSession(email){
  localStorage.setItem("bocfx_authed_email", normEmail(email));
}
function clearSession(){
  localStorage.removeItem("bocfx_authed_email");
}

async function tryAutoLogin(){
  const saved = normEmail(localStorage.getItem("bocfx_authed_email"));
  if(saved && isAllowed(saved)){
    setAuthState(true);
    return true;
  }
  setAuthState(false);
  return false;
}

function showMsg(t){ AUTH.msg.textContent = t || ""; }

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

AUTH.btnRegister.addEventListener("click", ()=>{
  const name = (AUTH.regName.value || "").trim();
  const email = normEmail(AUTH.regEmail.value);
  const admin = AUTH.config?.adminEmail || "";

  if(!name || !email){
    showMsg("Enter name and email to request access.");
    return;
  }
  if(!admin){
    showMsg("Admin email is not configured in data/users.json");
    return;
  }

  const subj = encodeURIComponent("BOC FX Dashboard – Access Request");
  const body = encodeURIComponent(
`Hello Admin,

Please approve access for:
Name: ${name}
Email: ${email}

Dashboard: ${location.href}

Thanks.`
  );
  window.location.href = `mailto:${encodeURIComponent(admin)}?subject=${subj}&body=${body}`;
  showMsg("Access request email opened. Please send it.");
});

// ===== DASHBOARD =====
let avgChart, firstChart;
let currentData = []; // month rows
let yearDaily = [];   // aggregated year rows

function todayISO(){
  const d = new Date();
  return {
    yyyy: d.getFullYear(),
    mm: String(d.getMonth()+1).padStart(2,"0")
  };
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

async function loadMonth(){
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const url = `data/${y}/${y}-${m}.json`;

  currentData = [];
  try{
    const resp = await fetch(url, {cache:"no-store"});
    if(!resp.ok) throw new Error("No data yet");
    currentData = await resp.json();
  }catch(e){
    currentData = [];
  }
  renderRaw();
  await loadYearAgg();
}

function renderRaw(){
  els.rawTbody.innerHTML = "";
  if(currentData.length === 0){
    els.rawTbody.innerHTML = `<tr><td colspan="7">No data yet for this month.</td></tr>`;
    return;
  }
  const rows = [...currentData].sort((a,b)=> (a.date + " " + a.publishTime).localeCompare(b.date + " " + b.publishTime));
  for(const r of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.date)}</td>
      <td>${esc(r.publishTime)}</td>
      <td>${fmt(r.buying)}</td>
      <td>${fmt(r.cashBuying)}</td>
      <td>${fmt(r.selling)}</td>
      <td>${fmt(r.cashSelling)}</td>
      <td>${fmt(r.middle)}</td>
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
    }catch(e){}
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
    const vals = rows.map(x => Number(x[col])).filter(v=>Number.isFinite(v));
    if(vals.length === 0) continue;

    const avg = vals.reduce((s,v)=>s+v,0)/vals.length;
    const min = Math.min(...vals);
    const max = Math.max(...vals);

    const firstRow = rows[0];
    const first = Number(firstRow[col]);
    const firstTime = String(firstRow.publishTime || "");

    yearDaily.push({ date:d, avg, min, max, publishes: vals.length, first, firstTime });
  }

  renderAvg();
  renderFirst();
  renderImpact();
}

function pctChange(curr, prev){
  if(!Number.isFinite(prev) || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function renderAvg(){
  els.avgTbody.innerHTML = "";
  if(yearDaily.length === 0){
    els.avgTbody.innerHTML = `<tr><td colspan="6">No year data yet.</td></tr>`;
    destroyCharts();
    return;
  }

  for(let i=0;i<yearDaily.length;i++){
    const r = yearDaily[i];
    const prev = yearDaily[i-1];
    const pc = prev ? pctChange(r.avg, prev.avg) : null;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.date)}</td>
      <td>${fmt(r.avg)}</td>
      <td>${pc===null ? "-" : fmt(pc,2) + "%"}</td>
      <td>${fmt(r.min)}</td>
      <td>${fmt(r.max)}</td>
      <td>${r.publishes}</td>
    `;
    els.avgTbody.appendChild(tr);
  }
  drawAvgChart();
}

function renderFirst(){
  els.firstTbody.innerHTML = "";
  if(yearDaily.length === 0){
    els.firstTbody.innerHTML = `<tr><td colspan="4">No year data yet.</td></tr>`;
    return;
  }

  for(let i=0;i<yearDaily.length;i++){
    const r = yearDaily[i];
    const prev = yearDaily[i-1];
    const pc = prev ? pctChange(r.first, prev.first) : null;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.date)}</td>
      <td>${esc(r.firstTime)}</td>
      <td>${fmt(r.first)}</td>
      <td>${pc===null ? "-" : fmt(pc,2) + "%"}</td>
    `;
    els.firstTbody.appendChild(tr);
  }
  drawFirstChart();
}

function drawAvgChart(){
  const ctx = document.getElementById("avgChart");
  const labels = yearDaily.map(x=>x.date);
  const series = yearDaily.map(x=>x.avg);

  if(avgChart) avgChart.destroy();
  avgChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label:"Daily Avg (Selected)", data: series }]},
    options: { responsive:true, maintainAspectRatio:false }
  });
}

function drawFirstChart(){
  const ctx = document.getElementById("firstChart");
  const labels = yearDaily.map(x=>x.date);
  const series = yearDaily.map(x=>x.first);

  if(firstChart) firstChart.destroy();
  firstChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label:"Daily First Publish (Selected)", data: series }]},
    options: { responsive:true, maintainAspectRatio:false }
  });
}

function destroyCharts(){
  if(avgChart) avgChart.destroy();
  if(firstChart) firstChart.destroy();
}

function fmt(n, dp=2){
  if(!Number.isFinite(n)) return "-";
  return Number(n).toFixed(dp);
}

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

// ===== Downloads =====
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
  downloadText(`boc_usd_cny_${y}-${m}.csv`, toCsv(currentData), "text/csv;charset=utf-8");
});
els.btnJson.addEventListener("click", ()=> {
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  downloadText(`boc_usd_cny_${y}-${m}.json`, JSON.stringify(currentData, null, 2), "application/json");
});

// ===== Email (free): opens mail app prefilled =====
els.btnEmail.addEventListener("click", ()=> {
  const to = normEmail(els.emailTo.value);
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const link = location.href;

  const subj = encodeURIComponent(`BOC USD/CNY Dashboard – ${y}-${m}`);
  const body = encodeURIComponent(
`Dashboard: ${link}

Month: ${y}-${m}

Downloads:
- Use "Download CSV" or "Download JSON" buttons in the dashboard

Note: Values are “as published” (RMB per 100 USD).`
  );
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subj}&body=${body}`;
});

// ===== USD Impact (USD impact from CNY exposure) =====
function renderImpact(){
  if(yearDaily.length < 2){
    els.impactBox.innerHTML = `<div class="small">Need at least 2 days of data to compute day-to-day USD impact.</div>`;
    return;
  }

  const exposureCny = Number(els.cnyExposure.value || 0);
  const last = yearDaily[yearDaily.length-1];
  const prev = yearDaily[yearDaily.length-2];

  // Use selected column average as the "rate as published" (RMB per 100 USD)
  const rTodayPer100 = Number(last.avg);
  const rPrevPer100  = Number(prev.avg);

  // Convert internally to RMB per 1 USD for USD math only
  const rToday = rTodayPer100 / 100;
  const rPrev  = rPrevPer100  / 100;

  // USD required to buy exposureCny:
  const usdToday = exposureCny / rToday;
  const usdPrev  = exposureCny / rPrev;

  // + means need more USD today vs yesterday
  const usdImpact = usdToday - usdPrev;

  // Sensitivity: +0.01 CNY/USD == +1 RMB per 100 USD
  const rSens = (rTodayPer100 + 1) / 100;
  const usdSens = (exposureCny / rSens) - usdToday;

  els.impactBox.innerHTML = `
    <div><b>Latest Day:</b> ${esc(last.date)} | <b>Prev Day:</b> ${esc(prev.date)}</div>
    <hr style="border:0;border-top:1px solid var(--border);margin:10px 0">
    <div><b>USD Required (Latest):</b> ${usdToday.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
    <div><b>USD Required (Prev):</b> ${usdPrev.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
    <div><b>Day-to-day USD Impact:</b> ${usdImpact.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
    <hr style="border:0;border-top:1px solid var(--border);margin:10px 0">
    <div><b>Sensitivity (USD impact):</b> +1 RMB per 100 USD (≈ +0.01 CNY/USD) changes USD by
      <b>${usdSens.toLocaleString(undefined,{maximumFractionDigits:2})}</b>
    </div>
    <div class="small">Display stays “as published”. Internal /100 conversion is only for USD math.</div>
  `;
}

els.btnRecalcImpact.addEventListener("click", renderImpact);

// ===== Wiring =====
els.yearSelect.addEventListener("change", loadMonth);
els.monthSelect.addEventListener("change", loadMonth);
els.rateColumn.addEventListener("change", loadYearAgg);

// ===== Boot =====
(async function boot(){
  setOptions();
  await loadAuthConfig();
  const ok = await tryAutoLogin();
  if(ok){
    await loadMonth();
  } else {
    showMsg("Enter your email to login. If new, request access.");
  }
})();

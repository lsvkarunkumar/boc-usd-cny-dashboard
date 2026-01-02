const monthNames = ["01","02","03","04","05","06","07","08","09","10","11","12"];

const els = {
  yearSelect: document.getElementById("yearSelect"),
  monthSelect: document.getElementById("monthSelect"),
  rateColumn: document.getElementById("rateColumn"),

  usdExposure: document.getElementById("usdExposure"),
  baselineRate: document.getElementById("baselineRate"),
  btnLockBaseline: document.getElementById("btnLockBaseline"),
  alertThresholdM: document.getElementById("alertThresholdM"),

  rawTbody: document.querySelector("#rawTable tbody"),
  avgTbody: document.querySelector("#avgTable tbody"),
  firstTbody: document.querySelector("#firstTable tbody"),

  btnCsv: document.getElementById("btnDownloadCsv"),
  btnJson: document.getElementById("btnDownloadJson"),
  btnXls: document.getElementById("btnDownloadXls"),
  btnCaptureLog: document.getElementById("btnDownloadCaptureLog"),

  btnRefresh: document.getElementById("btnRefresh"),
  btnRunNow: document.getElementById("btnRunNow"),

  bocLatestLink: document.getElementById("bocLatestLink"),

  emailTo: document.getElementById("emailTo"),
  btnEmail: document.getElementById("btnEmail"),

  btnLoadLive: document.getElementById("btnLoadLive"),
  liveBox: document.getElementById("liveBox"),

  impactBox: document.getElementById("impactBox"),

  daySelect: document.getElementById("daySelect"),
  btnDrawIntraday: document.getElementById("btnDrawIntraday"),
  intradayTbody: document.querySelector("#intradayTable tbody"),
};

let currentData = [];
let yearDaily = [];
let avgChart = null;
let firstChart = null;
let intradayChart = null;
let pnlChart = null;

const SHOW_LAST_INTRADAY_ROWS = 12;
const SHOW_LAST_RAW_ROWS = 12;

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
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
function fmtM0(v){
  if(!Number.isFinite(v)) return "-";
  return (v/1_000_000).toFixed(0); // millions, no decimals
}
function chartsAvailable(){
  return typeof Chart !== "undefined";
}

// --- GitHub Pages base path helper (project pages safe) ---
function basePath(){
  const p = location.pathname;
  const parts = p.split("/").filter(Boolean);
  if (location.hostname.endsWith("github.io") && parts.length >= 1) {
    return "/" + parts[0];
  }
  return "";
}
function withBase(url){
  return basePath() + "/" + url.replace(/^\/+/, "");
}

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

// Official BOC link
els.bocLatestLink.href = "https://www.bankofchina.com/sourcedb/whpj/enindex_1619.html";
els.bocLatestLink.textContent = "Open BOC Latest";

async function fetchJson(url){
  try{
    const resp = await fetch(url, {cache:"no-store"});
    if(!resp.ok) return null;
    return await resp.json();
  }catch{ return null; }
}
async function fetchText(url){
  try{
    const resp = await fetch(url, {cache:"no-store"});
    if(!resp.ok) return null;
    return await resp.text();
  }catch{ return null; }
}
function parseCsv(text){
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  for(let i=0;i<text.length;i++){
    const ch = text[i];
    const next = text[i+1];
    if(inQ){
      if(ch === '"' && next === '"'){ cur += '"'; i++; }
      else if(ch === '"'){ inQ = false; }
      else cur += ch;
    } else {
      if(ch === '"'){ inQ = true; }
      else if(ch === ","){ row.push(cur); cur=""; }
      else if(ch === "\n"){
        row.push(cur); cur="";
        if(row.length > 1 || (row.length===1 && row[0].trim() !== "")) rows.push(row);
        row = [];
      } else if(ch !== "\r"){
        cur += ch;
      }
    }
  }
  row.push(cur);
  if(row.length > 1 || (row.length===1 && row[0].trim() !== "")) rows.push(row);
  return rows;
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

// ===== FX MODEL =====
function calcBaseCny(usdExp, baseRate){
  return usdExp * (baseRate/100);
}
function usdRequired(baseCny, rate){
  return baseCny / (rate/100);
}

// ===== Baseline lock per month =====
function monthKey(){
  return `${els.yearSelect.value}-${els.monthSelect.value}`;
}
function loadBaselineForMonth(){
  const key = `baseline:${monthKey()}`;
  const saved = localStorage.getItem(key);
  if(saved){
    const v = Number(saved);
    if(Number.isFinite(v) && v>0) els.baselineRate.value = String(v);
  }
}
function lockBaselineForMonth(){
  const key = `baseline:${monthKey()}`;
  const v = Number(els.baselineRate.value || 0);
  if(Number.isFinite(v) && v>0){
    localStorage.setItem(key, String(v));
    alert(`Baseline locked for ${monthKey()}: ${v}`);
  } else {
    alert("Invalid baseline rate.");
  }
}

// ===== Load Month =====
async function loadMonth(){
  loadBaselineForMonth();

  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  currentData = (await fetchJson(withBase(`data/${y}/${y}-${m}.json`))) || [];

  await loadYearAgg();
  renderDayOptions();
  renderRaw();
  renderImpact();
  drawPnL();
}

function renderDayOptions(){
  const dates = [...new Set(currentData.map(r => r.date).filter(Boolean))].sort();
  els.daySelect.innerHTML = "";
  if(dates.length === 0){
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "No dates yet";
    els.daySelect.appendChild(o);
    return;
  }
  dates.forEach(d=>{
    const o = document.createElement("option");
    o.value = d;
    o.textContent = d;
    els.daySelect.appendChild(o);
  });
  els.daySelect.value = dates[dates.length-1];
}

// ===== Tab 1 — show last 12 rows but keep all data fetched =====
function renderRaw(){
  els.rawTbody.innerHTML = "";
  if(currentData.length === 0){
    els.rawTbody.innerHTML = `<tr><td colspan="8">No data captured yet for this month.</td></tr>`;
    return;
  }

  const usdExp = Number(els.usdExposure.value || 1500000000);
  const baseRate = Number(els.baselineRate.value || 714.6);
  if(!Number.isFinite(usdExp) || !Number.isFinite(baseRate) || baseRate<=0){
    els.rawTbody.innerHTML = `<tr><td colspan="8">Invalid USD exposure or baseline rate.</td></tr>`;
    return;
  }

  const baseCny = calcBaseCny(usdExp, baseRate);

  const rows = [...currentData].sort((a,b)=> String(a.publishTime).localeCompare(String(b.publishTime)));
  const start = Math.max(0, rows.length - SHOW_LAST_RAW_ROWS);

  for(let i=start;i<rows.length;i++){
    const r = rows[i];
    const mid = toNum(r.middle);
    let impact = null;
    if(Number.isFinite(mid)){
      const usdNow = usdRequired(baseCny, mid);
      impact = usdNow - usdExp;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.date)}</td>
      <td>${esc(r.publishTime)}</td>
      <td>${esc(r.buying)}</td>
      <td>${esc(r.cashBuying)}</td>
      <td>${esc(r.selling)}</td>
      <td>${esc(r.cashSelling)}</td>
      <td>${esc(r.middle)}</td>
      <td>${impact===null ? "-" : (impact>=0?"+":"") + fmtM0(impact)}</td>
    `;
    els.rawTbody.appendChild(tr);
  }
}

// ===== Year aggregations =====
async function loadYearAgg(){
  const y = els.yearSelect.value;
  yearDaily = [];
  const allRows = [];
  for(const m of monthNames){
    const arr = await fetchJson(withBase(`data/${y}/${y}-${m}.json`));
    if(Array.isArray(arr)) allRows.push(...arr);
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

    const selectedVals = rows.map(x => toNum(x[col])).filter(v=>v !== null);
    const middleVals   = rows.map(x => toNum(x["middle"])).filter(v=>v !== null);
    if(selectedVals.length === 0) continue;

    const avg = selectedVals.reduce((s,v)=>s+v,0)/selectedVals.length;
    const min = Math.min(...selectedVals);
    const max = Math.max(...selectedVals);
    const avgMiddle = (middleVals.length ? (middleVals.reduce((s,v)=>s+v,0)/middleVals.length) : null);

    const firstRow = rows[0];
    const first = toNum(firstRow[col]);
    const firstTime = String(firstRow.publishTime || "");

    yearDaily.push({ date:d, avg, min, max, publishes: selectedVals.length, first, firstTime, avgMiddle });
  }

  renderAvg();
  renderFirst();
}

// Tab2
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
    if(avgChart) avgChart.destroy();
    avgChart = new Chart(ctx, {
      type:"line",
      data:{ labels: yearDaily.map(x=>x.date), datasets:[{ label:"Daily Avg (Selected)", data: yearDaily.map(x=>x.avg) }]},
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
}

// Tab3
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
    if(firstChart) firstChart.destroy();
    firstChart = new Chart(ctx, {
      type:"line",
      data:{ labels: yearDaily.map(x=>x.date), datasets:[{ label:"Daily First Publish (Selected)", data: yearDaily.map(x=> (x.first ?? null)) }]},
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
}

// ===== Impact Summary =====
function renderImpact(){
  const usdExp = Number(els.usdExposure.value || 1500000000);
  const baseRate = Number(els.baselineRate.value || 714.6);

  const rows = [...currentData].sort((a,b)=> String(a.publishTime).localeCompare(String(b.publishTime)));
  const last = rows.length ? rows[rows.length-1] : null;
  const currentRate = last ? toNum(last.middle) : null;

  if(!Number.isFinite(usdExp) || !Number.isFinite(baseRate) || baseRate<=0 || !Number.isFinite(currentRate)){
    els.impactBox.innerHTML = `<div style="color:var(--muted)">Need valid USD exposure, baseline and latest Middle rate.</div>`;
    return;
  }

  const baseCny = calcBaseCny(usdExp, baseRate);
  const usdNow = usdRequired(baseCny, currentRate);
  const usdImpact = usdNow - usdExp;

  const usdPlus001 = usdRequired(baseCny, currentRate + 0.01);
  const sens = usdPlus001 - usdNow;

  const impactColor = usdImpact >= 0 ? "#ff4d4f" : "#00c48c";

  els.impactBox.innerHTML = `
    <div><b>Baseline Rate:</b> ${esc(baseRate)} | <b>Latest Rate (Middle):</b> ${esc(currentRate)} | <b>Latest Publish:</b> ${esc(last.publishTime)}</div>
    <hr style="border:0;border-top:1px solid var(--border);margin:10px 0">
    <div><b>Base USD Required:</b> ${fmtM0(usdExp)} M</div>
    <div><b>USD Required Now:</b> ${fmtM0(usdNow)} M</div>
    <div style="margin-top:8px"><b>USD Impact:</b>
      <span style="font-weight:800;color:${impactColor}">${usdImpact>=0?"+":""}${fmtM0(usdImpact)} M</span>
    </div>
    <hr style="border:0;border-top:1px solid var(--border);margin:10px 0">
    <div><b>Sensitivity:</b> Every 0.01 move ≈ ${Math.abs(Number(fmtM0(sens))).toLocaleString()} M USD</div>
  `;
}

// ===== P&L Chart =====
function drawPnL(){
  const usdExp = Number(els.usdExposure.value || 1500000000);
  const baseRate = Number(els.baselineRate.value || 714.6);
  if(!Number.isFinite(usdExp) || !Number.isFinite(baseRate) || baseRate<=0){
    if(pnlChart) pnlChart.destroy();
    return;
  }
  const baseCny = calcBaseCny(usdExp, baseRate);

  const pts = yearDaily
    .filter(d => Number.isFinite(d.avgMiddle))
    .map(d => ({
      date: d.date,
      impactM: (usdRequired(baseCny, d.avgMiddle) - usdExp) / 1_000_000
    }));

  if(!chartsAvailable()) return;

  const ctx = document.getElementById("pnlChart");
  if(pnlChart) pnlChart.destroy();
  pnlChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: pts.map(p=>p.date),
      datasets: [{ label: "USD Impact (M) vs Baseline", data: pts.map(p=>p.impactM) }]
    },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(2)} M`
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: (v) => Number(v).toFixed(2) + " M"
          }
        }
      }
    }
  });
}

// ===== Intraday chart (better y-axis) + last 12 rows =====
function timeOnly(publishTime){
  const s = String(publishTime || "");
  const parts = s.split(" ");
  return parts.length >= 2 ? parts[1] : s;
}

function calcNiceBounds(values){
  const v = values.filter(x => Number.isFinite(x));
  if(v.length === 0) return null;
  let min = Math.min(...v);
  let max = Math.max(...v);
  if(min === max){
    // if flat line, create small window around value
    const pad = Math.max(0.05, Math.abs(min) * 0.001);
    min = min - pad;
    max = max + pad;
  } else {
    const range = max - min;
    const pad = range * 0.15;
    min -= pad;
    max += pad;
  }
  return {min, max};
}

function drawIntraday(){
  const day = els.daySelect.value;
  els.intradayTbody.innerHTML = "";

  if(!day || currentData.length === 0){
    els.intradayTbody.innerHTML = `<tr><td colspan="4">No intraday data.</td></tr>`;
    if(intradayChart) intradayChart.destroy();
    return;
  }

  const col = els.rateColumn.value;
  const rows = currentData
    .filter(r => r.date === day)
    .slice()
    .sort((a,b)=> String(a.publishTime).localeCompare(String(b.publishTime)));

  const values = rows.map(r => toNum(r[col]));
  const labels = rows.map(r => timeOnly(r.publishTime));

  let sum = 0, cnt = 0;
  const runAvg = values.map(v => {
    if(Number.isFinite(v)){ sum += v; cnt++; return sum / cnt; }
    return null;
  });

  // table: last 12
  const start = Math.max(0, rows.length - SHOW_LAST_INTRADAY_ROWS);
  for(let i=start;i<rows.length;i++){
    const v = values[i];
    const ra = runAvg[i];
    const prevV = i>0 ? values[i-1] : null;
    const pc = (Number.isFinite(v) && Number.isFinite(prevV)) ? pctChange(v, prevV) : null;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(rows[i].publishTime)}</td>
      <td>${v===null ? "-" : fmt(v,2)}</td>
      <td>${ra===null ? "-" : fmt(ra,2)}</td>
      <td>${pc===null ? "-" : fmt(pc,2) + "%"}</td>
    `;
    els.intradayTbody.appendChild(tr);
  }

  if(chartsAvailable()){
    const bounds = calcNiceBounds(values);
    const ctx = document.getElementById("intradayChart");
    if(intradayChart) intradayChart.destroy();

    intradayChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: `Intraday ${col}`, data: values },
          { label: "Running Avg", data: runAvg }
        ]
      },
      options: {
        responsive:true,
        maintainAspectRatio:false,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(2)}`
            }
          }
        },
        scales: {
          y: {
            ...(bounds ? {min: bounds.min, max: bounds.max} : {}),
            ticks: {
              callback: (v) => Number(v).toFixed(2)
            }
          }
        }
      }
    });
  }
}

// ===== Live status =====
async function loadLiveStatus(){
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const url = withBase(`data/${y}/${y}-${m}-capturelog.csv`);

  els.liveBox.innerHTML = `<div style="color:var(--muted)">Loading capture log…</div>`;
  const text = await fetchText(url);

  if(!text){
    els.liveBox.innerHTML = `<div><b>Status:</b> capture log not found for ${y}-${m}</div>`;
    return;
  }

  const rows = parseCsv(text);
  if(rows.length < 2){
    els.liveBox.innerHTML = `<div><b>Status:</b> capture log is empty.</div>`;
    return;
  }

  const header = rows[0].map(h => String(h).trim());
  const last = rows[rows.length - 1];
  const idx = (name) => header.indexOf(name);

  const capturedAt = last[idx("capturedAtUtc")] ?? "";
  const publishTime = last[idx("publishTime")] ?? "";
  const middle = last[idx("middle")] ?? "";
  const prev = rows.length >= 3 ? rows[rows.length - 2] : null;
  const prevPublish = prev ? (prev[idx("publishTime")] ?? "") : "";
  const changed = (publishTime && prevPublish && publishTime !== prevPublish);

  els.liveBox.innerHTML = `
    <div><b>Last Capture (UTC):</b> ${esc(capturedAt)}</div>
    <div><b>Last Publish Time:</b> ${esc(publishTime)}</div>
    <div><b>Last Middle:</b> ${esc(middle)}</div>
    <div><b>Publish Changed vs Previous Capture:</b> ${changed ? "<b>YES</b>" : "No"}</div>
  `;
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
els.btnXls.addEventListener("click", ()=>{
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  window.open(withBase(`data/${y}/${y}-${m}.xlsx`), "_blank");
});
els.btnCaptureLog.addEventListener("click", ()=>{
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  window.open(withBase(`data/${y}/${y}-${m}-capturelog.csv`), "_blank");
});

// Email
els.btnEmail.addEventListener("click", ()=> {
  const to = String(els.emailTo.value || "").trim();
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const link = location.href;
  const subj = encodeURIComponent(`BOC USD/CNY Dashboard – ${y}-${m}`);
  const body = encodeURIComponent(
    `Dashboard: ${link}\n\n`+
    `USD Exposure: ${els.usdExposure.value}\n`+
    `Baseline Rate: ${els.baselineRate.value}\n`+
    `Alert Threshold (M): ${els.alertThresholdM.value}\n`
  );
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subj}&body=${body}`;
});

els.btnRunNow.addEventListener("click", ()=>{
  alert("Run Now:\nRepo → Actions → Fetch BOC USD Snapshot → Run workflow");
});

// Baseline lock button
els.btnLockBaseline.addEventListener("click", lockBaselineForMonth);

// Wiring
els.yearSelect.addEventListener("change", async ()=>{ await loadMonth(); await loadLiveStatus(); drawIntraday(); });
els.monthSelect.addEventListener("change", async ()=>{ await loadMonth(); await loadLiveStatus(); drawIntraday(); });
els.rateColumn.addEventListener("change", async ()=>{ await loadMonth(); drawIntraday(); });

els.usdExposure.addEventListener("input", ()=>{ renderRaw(); renderImpact(); drawPnL(); });
els.baselineRate.addEventListener("input", ()=>{ renderRaw(); renderImpact(); drawPnL(); });

els.btnRefresh.addEventListener("click", async ()=>{ await loadMonth(); await loadLiveStatus(); drawIntraday(); });
els.btnLoadLive.addEventListener("click", loadLiveStatus);
els.btnDrawIntraday.addEventListener("click", drawIntraday);

// Boot
(async function boot(){
  setOptions();
  await loadMonth();
  await loadLiveStatus();
  drawIntraday();
})();

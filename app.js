const monthNames = ["01","02","03","04","05","06","07","08","09","10","11","12"];

const els = {
  yearSelect: document.getElementById("yearSelect"),
  monthSelect: document.getElementById("monthSelect"),
  rateColumn: document.getElementById("rateColumn"),
  impactMode: document.getElementById("impactMode"),

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

  cnyExposure: document.getElementById("cnyExposure"),
  btnRecalcImpact: document.getElementById("btnRecalcImpact"),
  impactBox: document.getElementById("impactBox"),

  // Live + Intraday
  btnLoadLive: document.getElementById("btnLoadLive"),
  liveBox: document.getElementById("liveBox"),
  daySelect: document.getElementById("daySelect"),
  btnDrawIntraday: document.getElementById("btnDrawIntraday"),
  intradayTbody: document.querySelector("#intradayTable tbody"),
};

let currentData = [];
let yearDaily = [];
let avgChart = null;
let firstChart = null;
let intradayChart = null;

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
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
function fmtIntSigned(n){
  if(!Number.isFinite(n)) return "-";
  const v = Math.round(n);
  if (v > 0) return `+${v.toLocaleString()}`;
  if (v < 0) return `${v.toLocaleString()}`;
  return "0";
}
function chartsAvailable(){
  return typeof Chart !== "undefined";
}

// Official latest snapshot page
els.bocLatestLink.href = "https://www.bankofchina.com/sourcedb/whpj/enindex_1619.html";
els.bocLatestLink.textContent = "Open BOC Latest";

async function fetchJson(url){
  try{
    const resp = await fetch(url, {cache:"no-store"});
    if(!resp.ok) return null;
    return await resp.json();
  }catch{
    return null;
  }
}

async function fetchText(url){
  try{
    const resp = await fetch(url, {cache:"no-store"});
    if(!resp.ok) return null;
    return await resp.text();
  }catch{
    return null;
  }
}

function parseCsv(text){
  // simple robust CSV parser (handles quoted values)
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

async function loadMonth(){
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const url = `data/${y}/${y}-${m}.json`;

  currentData = (await fetchJson(url)) || [];

  // Build year aggregates first (used by impact mode prev_day_avg)
  await loadYearAgg();

  renderDayOptions();
  renderRaw();
  renderImpact();
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
  els.daySelect.value = dates[dates.length-1]; // default latest
}

function usdFromCnyExposure(exposureCny, rateRmbPer100Usd){
  const r = rateRmbPer100Usd / 100; // RMB per 1 USD
  return exposureCny / r;
}

function buildPrevDayAvgMap(){
  const map = new Map();
  for(let i=0;i<yearDaily.length;i++){
    const today = yearDaily[i];
    const prev = yearDaily[i-1];
    map.set(today.date, prev ? prev.avgMiddle : null);
  }
  return map;
}

function renderRaw(){
  els.rawTbody.innerHTML = "";
  if(currentData.length === 0){
    els.rawTbody.innerHTML = `<tr><td colspan="8">No data captured yet for this month.</td></tr>`;
    return;
  }

  const exposureCny = Number(els.cnyExposure.value || 1500000000);
  const mode = els.impactMode.value;

  const rows = [...currentData].sort((a,b)=> String(a.publishTime).localeCompare(String(b.publishTime)));
  const prevDayAvgMap = buildPrevDayAvgMap();

  for(let i=0;i<rows.length;i++){
    const r = rows[i];
    const mid = toNum(r.middle);
    let usdImpact = null;

    if (Number.isFinite(mid)) {
      if (mode === "prev_publish") {
        const prev = rows[i-1];
        const prevMid = prev ? toNum(prev.middle) : null;
        if (Number.isFinite(prevMid)) {
          const usdNow = usdFromCnyExposure(exposureCny, mid);
          const usdPrev = usdFromCnyExposure(exposureCny, prevMid);
          usdImpact = usdNow - usdPrev;
        }
      } else if (mode === "prev_day_avg") {
        const prevAvgMiddle = prevDayAvgMap.get(r.date);
        if (Number.isFinite(prevAvgMiddle)) {
          const usdNow = usdFromCnyExposure(exposureCny, mid);
          const usdPrevDay = usdFromCnyExposure(exposureCny, prevAvgMiddle);
          usdImpact = usdNow - usdPrevDay;
        }
      }
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
      <td>${usdImpact===null ? "-" : fmtIntSigned(usdImpact)}</td>
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
    const arr = await fetchJson(url);
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

// ===== NEW: Live Monitor (Last Updated) =====
async function loadLiveStatus(){
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const url = `data/${y}/${y}-${m}-capturelog.csv`;

  els.liveBox.innerHTML = `<div style="color:var(--muted)">Loading capture log…</div>`;
  const text = await fetchText(url);

  if(!text){
    els.liveBox.innerHTML = `
      <div><b>Status:</b> capture log not found for ${y}-${m}</div>
      <div style="margin-top:8px;color:var(--muted)">
        Check: scripts/fetch_boc_usd.py must write capturelog each run, and Actions schedule must be running.
      </div>
    `;
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
  const htmlHash = last[idx("htmlSha256")] ?? "";
  const source = last[idx("source")] ?? "";

  // Compare with previous line for "publish changed?"
  const prev = rows.length >= 3 ? rows[rows.length - 2] : null;
  const prevPublish = prev ? (prev[idx("publishTime")] ?? "") : "";
  const changed = (publishTime && prevPublish && publishTime !== prevPublish);

  els.liveBox.innerHTML = `
    <div><b>Last Capture (UTC):</b> ${esc(capturedAt)}</div>
    <div><b>Last Publish Time:</b> ${esc(publishTime)}</div>
    <div><b>Last Middle:</b> ${esc(middle)}</div>
    <div><b>Publish Changed vs Previous Capture:</b> ${changed ? "<b>YES</b>" : "No"}</div>
    <hr style="border:0;border-top:1px solid var(--border);margin:10px 0">
    <div style="color:var(--muted);font-size:12px"><b>HTML SHA256:</b> ${esc(htmlHash || "-")}</div>
    <div style="color:var(--muted);font-size:12px"><b>Source:</b> ${esc(source || "-")}</div>
  `;
}

// ===== NEW: Intraday chart + table =====
function timeOnly(publishTime){
  // publishTime is "YYYY-MM-DD HH:MM:SS"
  const s = String(publishTime || "");
  const parts = s.split(" ");
  return parts.length >= 2 ? parts[1] : s;
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

  // Running average
  let sum = 0;
  let cnt = 0;
  const runAvg = values.map(v => {
    if(Number.isFinite(v)){ sum += v; cnt += 1; return sum / cnt; }
    return null;
  });

  // Table
  for(let i=0;i<rows.length;i++){
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

  // Chart
  if(chartsAvailable()){
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
      options: { responsive:true, maintainAspectRatio:false }
    });
  }
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
  window.open(`data/${y}/${y}-${m}.xlsx`, "_blank");
});
els.btnCaptureLog.addEventListener("click", ()=>{
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  window.open(`data/${y}/${y}-${m}-capturelog.csv`, "_blank");
});

// Email
els.btnEmail.addEventListener("click", ()=> {
  const to = String(els.emailTo.value || "").trim();
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const link = location.href;
  const subj = encodeURIComponent(`BOC USD/CNY Dashboard – ${y}-${m}`);
  const body = encodeURIComponent(`Dashboard: ${link}\n\nMonth: ${y}-${m}\n\nUse Export Excel / Capture Log to download.`);
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subj}&body=${body}`;
});

// Run Now
els.btnRunNow.addEventListener("click", ()=>{
  alert("Run Now:\nRepo → Actions → Fetch BOC USD Snapshot → Run workflow");
});

// Bottom impact box (integer, signed)
function renderImpact(){
  if(yearDaily.length < 2){
    els.impactBox.innerHTML = `<div style="color:var(--muted)">Need at least 2 days of data to compute day-to-day impact.</div>`;
    return;
  }

  const exposureCny = Number(els.cnyExposure.value || 1500000000);
  const last = yearDaily[yearDaily.length-1];
  const prev = yearDaily[yearDaily.length-2];

  const rToday = Number(last.avgMiddle ?? last.avg) / 100;
  const rPrev  = Number(prev.avgMiddle ?? prev.avg) / 100;

  const usdToday = exposureCny / rToday;
  const usdPrev  = exposureCny / rPrev;
  const usdImpact = usdToday - usdPrev;

  els.impactBox.innerHTML = `
    <div><b>Latest Day:</b> ${esc(last.date)} &nbsp; | &nbsp; <b>Prev Day:</b> ${esc(prev.date)}</div>
    <hr style="border:0;border-top:1px solid var(--border);margin:10px 0">
    <div><b>USD Required (Latest):</b> ${Math.round(usdToday).toLocaleString()}</div>
    <div><b>USD Required (Prev):</b> ${Math.round(usdPrev).toLocaleString()}</div>
    <div><b>USD Impact (Day-to-day):</b> ${fmtIntSigned(usdImpact)}</div>
  `;
}

// Wiring
els.yearSelect.addEventListener("change", async ()=>{ await loadMonth(); await loadLiveStatus(); });
els.monthSelect.addEventListener("change", async ()=>{ await loadMonth(); await loadLiveStatus(); });
els.rateColumn.addEventListener("change", async ()=>{ await loadMonth(); drawIntraday(); });
els.impactMode.addEventListener("change", ()=>{ renderRaw(); });

els.btnRefresh.addEventListener("click", async ()=>{ await loadMonth(); await loadLiveStatus(); });
els.btnRecalcImpact.addEventListener("click", ()=>{ renderRaw(); renderImpact(); });

els.btnLoadLive.addEventListener("click", loadLiveStatus);
els.btnDrawIntraday.addEventListener("click", drawIntraday);

// Boot
(async function boot(){
  setOptions();
  await loadMonth();
  await loadLiveStatus();
  drawIntraday();
})();

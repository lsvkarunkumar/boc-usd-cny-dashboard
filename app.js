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

let currentData = [];
let yearDaily = [];
let avgChart = null;
let firstChart = null;

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

function usdFromCnyExposure(exposureCny, rateRmbPer100Usd){
  // Convert "RMB per 100 USD" => RMB per 1 USD
  const r = rateRmbPer100Usd / 100;
  return exposureCny / r;
}

function renderRaw(){
  els.rawTbody.innerHTML = "";
  if(currentData.length === 0){
    els.rawTbody.innerHTML = `<tr><td colspan="8">No data captured yet for this month.</td></tr>`;
    return;
  }

  const exposureCny = Number(els.cnyExposure.value || 1500000000);

  const rows = [...currentData].sort((a,b)=> String(a.publishTime).localeCompare(String(b.publishTime)));
  for(let i=0;i<rows.length;i++){
    const r = rows[i];
    const mid = toNum(r.middle);
    const prev = rows[i-1];
    const prevMid = prev ? toNum(prev.middle) : null;

    // USD Impact vs previous publish event (middle rate)
    let usdImpact = null;
    if (Number.isFinite(mid) && Number.isFinite(prevMid)) {
      const usdNow = usdFromCnyExposure(exposureCny, mid);
      const usdPrev = usdFromCnyExposure(exposureCny, prevMid);
      usdImpact = usdNow - usdPrev;
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

// ===== Raw downloads =====
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

// Excel download – use the XLSX generated by the workflow (best)
els.btnXls.addEventListener("click", ()=>{
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const url = `data/${y}/${y}-${m}.xlsx`;
  window.open(url, "_blank");
});

// Email
els.btnEmail.addEventListener("click", ()=> {
  const to = String(els.emailTo.value || "").trim();
  const y = els.yearSelect.value;
  const m = els.monthSelect.value;
  const link = location.href;
  const subj = encodeURIComponent(`BOC USD/CNY Dashboard – ${y}-${m}`);
  const body = encodeURIComponent(`Dashboard: ${link}\n\nMonth: ${y}-${m}\n\nUse Export Excel button to download the official capture.`);

  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subj}&body=${body}`;
});

// Run Now (manual)
els.btnRunNow.addEventListener("click", ()=>{
  alert("Run Now:\nRepo → Actions → Fetch BOC USD Snapshot → Run workflow");
});

// Bottom impact box (no decimals)
function renderImpact(){
  if(yearDaily.length < 2){
    els.impactBox.innerHTML = `<div style="color:var(--muted)">Need at least 2 days of data to compute day-to-day impact.</div>`;
    return;
  }
  const exposureCny = Number(els.cnyExposure.value || 1500000000);
  const last = yearDaily[yearDaily.length-1];
  const prev = yearDaily[yearDaily.length-2];

  const rToday = Number(last.avg) / 100;
  const rPrev  = Number(prev.avg) / 100;

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

els.btnRecalcImpact.addEventListener("click", ()=>{
  renderRaw();      // refresh impact column too
  renderImpact();
});

// Wiring
els.yearSelect.addEventListener("change", loadMonth);
els.monthSelect.addEventListener("change", loadMonth);
els.rateColumn.addEventListener("change", loadYearAgg);
els.btnRefresh.addEventListener("click", loadMonth);

// Boot
(function boot(){
  setOptions();
  loadMonth();
})();

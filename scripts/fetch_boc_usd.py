import csv
import json
import os
import re
from datetime import datetime
from typing import Dict, List, Tuple, Optional

import requests
from bs4 import BeautifulSoup
from openpyxl import Workbook
from openpyxl.utils import get_column_letter

BOC_URL = "https://www.bankofchina.com/sourcedb/whpj/enindex_1619.html"
TIMEOUT = 25
DATA_DIR = "data"

def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)

def normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip())

def parse_pub_time(pub_time_raw: str) -> Tuple[str, str]:
    s = normalize_spaces(pub_time_raw)
    dt = datetime.strptime(s, "%Y/%m/%d %H:%M:%S")
    return dt.strftime("%Y-%m-%d"), dt.strftime("%Y-%m-%d %H:%M:%S")

def fetch_usd_row() -> Dict[str, str]:
    resp = requests.get(BOC_URL, timeout=TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.find("table")
    if not table:
        raise RuntimeError("Could not find table on BOC page.")

    usd_tr = None
    for tr in table.find_all("tr"):
        tds = tr.find_all(["td", "th"])
        if not tds:
            continue
        first = normalize_spaces(tds[0].get_text())
        if first.upper() == "USD":
            usd_tr = tr
            break

    if usd_tr is None:
        raise RuntimeError("USD row not found on BOC page.")

    cols = [normalize_spaces(td.get_text()) for td in usd_tr.find_all("td")]
    def safe(i: int) -> str:
        return cols[i] if i < len(cols) else ""

    currency = safe(0)
    buying = safe(1)
    cash_buying = safe(2)
    selling = safe(3)
    cash_selling = safe(4)
    middle = safe(5)
    pub_time_raw = safe(6)

    if currency.upper() != "USD":
        raise RuntimeError(f"Row currency mismatch: {currency}")
    if not pub_time_raw:
        raise RuntimeError("Pub Time missing in USD row.")

    date_iso, pub_time_iso = parse_pub_time(pub_time_raw)

    return {
        "date": date_iso,
        "publishTime": pub_time_iso,
        "publishTimeRaw": pub_time_raw,
        "currency": "USD",
        "buying": buying,
        "cashBuying": cash_buying,
        "selling": selling,
        "cashSelling": cash_selling,
        "middle": middle,
        "source": BOC_URL,
        "capturedAtUtc": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
    }

def month_paths(date_iso: str) -> Tuple[str, str, str, str]:
    yyyy = date_iso[:4]
    mm = date_iso[5:7]
    folder = os.path.join(DATA_DIR, yyyy)
    ensure_dir(folder)
    base = os.path.join(folder, f"{yyyy}-{mm}")
    return folder, base + ".json", base + ".csv", base + ".xlsx"

def load_json(path: str) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path: str, data: List[Dict[str, str]]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def save_csv(path: str, data: List[Dict[str, str]]) -> None:
    fieldnames = [
        "date", "publishTime", "publishTimeRaw", "currency",
        "buying", "cashBuying", "selling", "cashSelling", "middle",
        "source", "capturedAtUtc"
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in data:
            w.writerow({k: r.get(k, "") for k in fieldnames})

def autosize(ws) -> None:
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            v = "" if cell.value is None else str(cell.value)
            max_len = max(max_len, len(v))
        ws.column_dimensions[col_letter].width = min(max_len + 2, 40)

def to_float(s: str) -> Optional[float]:
    try:
        return float(str(s).strip())
    except:
        return None

def build_daily_tables(all_rows: List[Dict[str, str]]):
    by_date = {}
    for r in all_rows:
        by_date.setdefault(r["date"], []).append(r)

    dates = sorted(by_date.keys())

    avg_header = ["date","publishes","avgBuying","avgCashBuying","avgSelling","avgCashSelling","avgMiddle","minMiddle","maxMiddle"]
    avg_rows = [avg_header]

    first_header = ["date","firstPublishTime","buying","cashBuying","selling","cashSelling","middle","publishTimeRaw"]
    first_rows = [first_header]

    for d in dates:
        rows = sorted(by_date[d], key=lambda x: x.get("publishTime",""))
        publishes = len(rows)

        fr = rows[0]
        first_rows.append([
            d, fr.get("publishTime",""),
            fr.get("buying",""), fr.get("cashBuying",""),
            fr.get("selling",""), fr.get("cashSelling",""),
            fr.get("middle",""), fr.get("publishTimeRaw","")
        ])

        def avg_of(key: str) -> str:
            vals = [to_float(r.get(key,"")) for r in rows]
            vals = [v for v in vals if v is not None]
            if not vals:
                return ""
            return f"{sum(vals)/len(vals):.4f}"

        mids = [to_float(r.get("middle","")) for r in rows]
        mids = [m for m in mids if m is not None]

        avg_rows.append([
            d, str(publishes),
            avg_of("buying"), avg_of("cashBuying"),
            avg_of("selling"), avg_of("cashSelling"),
            avg_of("middle"),
            (f"{min(mids):.4f}" if mids else ""),
            (f"{max(mids):.4f}" if mids else "")
        ])

    return avg_rows, first_rows

def save_xlsx(path: str, all_rows: List[Dict[str, str]]) -> None:
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "All Published Values"

    header = ["date","publishTime","buying","cashBuying","selling","cashSelling","middle","publishTimeRaw","capturedAtUtc","source"]
    ws1.append(header)
    for r in all_rows:
        ws1.append([
            r.get("date",""), r.get("publishTime",""),
            r.get("buying",""), r.get("cashBuying",""),
            r.get("selling",""), r.get("cashSelling",""),
            r.get("middle",""), r.get("publishTimeRaw",""),
            r.get("capturedAtUtc",""), r.get("source","")
        ])
    autosize(ws1)

    ws2 = wb.create_sheet("Daily Summary")
    avg_table, first_table = build_daily_tables(all_rows)

    for row in avg_table:
        ws2.append(row)
    ws2.append([])
    ws2.append(["Day First Published Values"])
    for row in first_table:
        ws2.append(row)

    autosize(ws2)
    wb.save(path)

def dedupe_and_append(existing: List[Dict[str, str]], new_record: Dict[str, str]):
    key = f"{new_record.get('currency','')}|{new_record.get('publishTime','')}"
    seen = set(f"{r.get('currency','')}|{r.get('publishTime','')}" for r in existing)
    if key in seen:
        return existing, False
    existing.append(new_record)
    existing.sort(key=lambda x: x.get("publishTime",""))
    return existing, True

def main():
    rec = fetch_usd_row()
    _, json_path, csv_path, xlsx_path = month_paths(rec["date"])

    existing = load_json(json_path)
    updated, changed = dedupe_and_append(existing, rec)

    if not changed:
        print("No new publishTime. Nothing to update.")
        return

    save_json(json_path, updated)
    save_csv(csv_path, updated)
    save_xlsx(xlsx_path, updated)

    print("Updated files:")
    print(json_path)
    print(csv_path)
    print(xlsx_path)

if __name__ == "__main__":
    main()

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

BOC_URL = "https://www.bankofchina.com/sourcedb/whpj/enindex_1619.html"  # official table + Pub Time
TIMEOUT = 25

# Store data under data/YYYY/YYYY-MM.(json|csv|xlsx)
DATA_DIR = "data"

# ===== Helpers =====
def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)

def normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip())

def parse_pub_time(pub_time_raw: str) -> Tuple[str, str]:
    """
    BOC page shows: YYYY/MM/DD HH:MM:SS
    Returns: (date_iso YYYY-MM-DD, datetime_iso YYYY-MM-DD HH:MM:SS)
    """
    s = normalize_spaces(pub_time_raw)
    # Example: 2026/01/02 16:58:08
    dt = datetime.strptime(s, "%Y/%m/%d %H:%M:%S")
    return dt.strftime("%Y-%m-%d"), dt.strftime("%Y-%m-%d %H:%M:%S")

def fetch_usd_row() -> Dict[str, str]:
    """
    Pull USD row from BOC official page.
    Keep values EXACTLY as published (strings), no rounding.
    """
    resp = requests.get(BOC_URL, timeout=TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Find the main rates table: typically contains headers:
    # Currency Name, Buying Rate, Cash Buying Rate, Selling Rate, Cash Selling Rate, Middle Rate, Pub Time
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
    # Expected:
    # 0 Currency
    # 1 Buying
    # 2 CashBuying
    # 3 Selling
    # 4 CashSelling
    # 5 Middle
    # 6 PubTime
    # Some currencies may omit columns; USD should be full but we guard anyway.
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

    record = {
        "date": date_iso,                 # YYYY-MM-DD
        "publishTime": pub_time_iso,      # YYYY-MM-DD HH:MM:SS
        "publishTimeRaw": pub_time_raw,   # exactly as page shows
        "currency": "USD",
        # EXACT strings as published (RMB per 100 USD)
        "buying": buying,
        "cashBuying": cash_buying,
        "selling": selling,
        "cashSelling": cash_selling,
        "middle": middle,
        # Audit
        "source": BOC_URL,
        "capturedAtUtc": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
    }
    return record

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
    # Keep a stable column order
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

def build_daily_tables(all_rows: List[Dict[str, str]]) -> Tuple[List[List[str]], List[List[str]]]:
    """
    Returns:
      - day_averages table rows
      - day_first_published table rows
    Averages computed numerically from the stored strings.
    """
    # Group by date
    by_date: Dict[str, List[Dict[str, str]]] = {}
    for r in all_rows:
        by_date.setdefault(r["date"], []).append(r)

    dates = sorted(by_date.keys())

    # Day Averages: for each date, compute avg/min/max for each column
    avg_header = ["date", "publishes",
                  "avgBuying", "avgCashBuying", "avgSelling", "avgCashSelling", "avgMiddle",
                  "minMiddle", "maxMiddle"]
    avg_rows = [avg_header]

    first_header = ["date", "firstPublishTime",
                    "buying", "cashBuying", "selling", "cashSelling", "middle",
                    "publishTimeRaw"]
    first_rows = [first_header]

    def to_float(s: str) -> Optional[float]:
        try:
            return float(str(s).strip())
        except:
            return None

    for d in dates:
        rows = sorted(by_date[d], key=lambda x: x.get("publishTime", ""))
        publishes = len(rows)

        # First published row
        fr = rows[0]
        first_rows.append([
            d,
            fr.get("publishTime", ""),
            fr.get("buying", ""),
            fr.get("cashBuying", ""),
            fr.get("selling", ""),
            fr.get("cashSelling", ""),
            fr.get("middle", ""),
            fr.get("publishTimeRaw", ""),
        ])

        # Averages
        mids = [to_float(r.get("middle", "")) for r in rows]
        mids = [m for m in mids if m is not None]

        def avg_of(key: str) -> str:
            vals = [to_float(r.get(key, "")) for r in rows]
            vals = [v for v in vals if v is not None]
            if not vals:
                return ""
            return f"{sum(vals)/len(vals):.4f}"

        avg_rows.append([
            d,
            str(publishes),
            avg_of("buying"),
            avg_of("cashBuying"),
            avg_of("selling"),
            avg_of("cashSelling"),
            avg_of("middle"),
            (f"{min(mids):.4f}" if mids else ""),
            (f"{max(mids):.4f}" if mids else ""),
        ])

    return avg_rows, first_rows

def save_xlsx(path: str, all_rows: List[Dict[str, str]]) -> None:
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "All Published Values"

    header = ["date", "publishTime", "buying", "cashBuying", "selling", "cashSelling", "middle", "publishTimeRaw", "capturedAtUtc", "source"]
    ws1.append(header)
    for r in all_rows:
        ws1.append([
            r.get("date",""),
            r.get("publishTime",""),
            r.get("buying",""),
            r.get("cashBuying",""),
            r.get("selling",""),
            r.get("cashSelling",""),
            r.get("middle",""),
            r.get("publishTimeRaw",""),
            r.get("capturedAtUtc",""),
            r.get("source",""),
        ])
    autosize(ws1)

    # Summary sheet
    ws2 = wb.create_sheet("Daily Summary")
    avg_table, first_table = build_daily_tables(all_rows)

    # Put averages at A1
    for row in avg_table:
        ws2.append(row)

    # Leave gap rows, then first table
    ws2.append([])
    ws2.append(["Day First Published Values"])
    for row in first_table:
        ws2.append(row)

    autosize(ws2)
    wb.save(path)

def dedupe_and_append(existing: List[Dict[str, str]], new_record: Dict[str, str]) -> Tuple[List[Dict[str, str]], bool]:
    """
    Dedupe by publishTime (unique key) for USD.
    """
    key = f"{new_record.get('currency','')}|{new_record.get('publishTime','')}"
    seen = set()
    for r in existing:
        seen.add(f"{r.get('currency','')}|{r.get('publishTime','')}")
    if key in seen:
        return existing, False
    existing.append(new_record)
    # keep sorted by publishTime
    existing.sort(key=lambda x: x.get("publishTime", ""))
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

    print(f"Updated: {json_path}")
    print(f"Updated: {csv_path}")
    print(f"Updated: {xlsx_path}")

if __name__ == "__main__":
    main()

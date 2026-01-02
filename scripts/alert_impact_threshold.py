import json, glob, os
from datetime import datetime, timezone
import requests

def latest_month_json():
    files = sorted(glob.glob("data/*/*.json"))
    return files[-1] if files else None

def to_float(x):
    try: return float(str(x).strip())
    except: return None

def main():
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print("No token/repo; skip.")
        return

    # Defaults (you can hardcode if needed)
    usd_exp = float(os.environ.get("USD_EXPOSURE", "1500000000"))
    base_rate = float(os.environ.get("BASE_RATE", "714.6"))
    threshold_m = float(os.environ.get("THRESHOLD_M", "10"))

    base_cny = usd_exp * (base_rate/100.0)

    path = latest_month_json()
    if not path:
        print("No json data yet.")
        return

    with open(path, "r", encoding="utf-8") as f:
        rows = json.load(f)
    rows = sorted(rows, key=lambda r: r.get("publishTime",""))
    if not rows:
        return

    last = rows[-1]
    mid = to_float(last.get("middle"))
    if mid is None:
        return

    usd_now = base_cny / (mid/100.0)
    impact = usd_now - usd_exp
    impact_m = impact / 1_000_000

    if abs(impact_m) < threshold_m:
        print(f"OK impact {impact_m:.2f}M < {threshold_m}M")
        return

    owner, name = repo.split("/", 1)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}

    title = f"FX ALERT: USD Impact {impact_m:+.0f}M (threshold {threshold_m:.0f}M)"
    body = (
        f"**USD Exposure:** {usd_exp:,.0f}\n"
        f"**Base Rate (RMB/100USD):** {base_rate}\n"
        f"**Latest Middle:** {mid}\n"
        f"**Latest Publish:** {last.get('publishTime')}\n\n"
        f"**USD Now:** {usd_now:,.0f}\n"
        f"**USD Impact:** {impact:,.0f}  ({impact_m:+.2f}M)\n\n"
        f"**Time:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
        f"**Data:** `{path}`\n"
    )

    # Create issue
    r = requests.post(
        f"https://api.github.com/repos/{owner}/{name}/issues",
        headers=headers,
        json={"title": title, "body": body, "labels": ["fx-alert"]},
        timeout=20
    )
    r.raise_for_status()
    print("Created issue:", r.json().get("html_url"))

if __name__ == "__main__":
    main()

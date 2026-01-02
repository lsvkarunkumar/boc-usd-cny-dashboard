import json
import os
import glob
from datetime import datetime, timezone
import requests

# ===== SETTINGS =====
# Alert on % move between last TWO published Middle rates
ALERT_THRESHOLD_PCT = 0.15  # change this to 0.10 or 0.20 etc
ISSUE_TITLE = "BOC USD/CNY Alert"
LABELS = ["fx-alert", "boc"]

def latest_month_json():
  files = sorted(glob.glob("data/*/*.json"))
  return files[-1] if files else None

def pct_change(curr, prev):
  if prev == 0:
    return None
  return ((curr - prev) / prev) * 100.0

def main():
  token = os.environ.get("GITHUB_TOKEN", "")
  repo = os.environ.get("GITHUB_REPOSITORY", "")
  if not token or not repo:
    print("[INFO] No token/repo (skipping alerts).")
    return

  path = latest_month_json()
  if not path:
    print("[INFO] No data JSON yet.")
    return

  with open(path, "r", encoding="utf-8") as f:
    rows = json.load(f)

  rows = sorted(rows, key=lambda r: r.get("publishTime",""))
  if len(rows) < 2:
    print("[INFO] Not enough published points for alert check.")
    return

  last = rows[-1]
  prev = rows[-2]

  try:
    last_mid = float(str(last.get("middle","")).strip())
    prev_mid = float(str(prev.get("middle","")).strip())
  except:
    print("[INFO] Middle not numeric; skipping alert.")
    return

  chg = pct_change(last_mid, prev_mid)
  if chg is None:
    return

  if abs(chg) < ALERT_THRESHOLD_PCT:
    print(f"[OK] No alert. Change {chg:.4f}% < {ALERT_THRESHOLD_PCT}%")
    return

  # Create/Update Issue so GitHub sends emails to watchers (free)
  api = "https://api.github.com"
  headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
  owner, name = repo.split("/", 1)

  body = (
    f"**Threshold:** {ALERT_THRESHOLD_PCT}%\n\n"
    f"**Change:** {chg:.4f}%\n\n"
    f"**Prev Publish:** {prev.get('publishTime')} | Middle: {prev_mid}\n"
    f"**Last Publish:** {last.get('publishTime')} | Middle: {last_mid}\n\n"
    f"**Data file:** `{path}`\n"
    f"**Time:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
  )

  # Find existing open issue with same title
  issues = requests.get(
    f"{api}/repos/{owner}/{name}/issues?state=open&per_page=50",
    headers=headers, timeout=20
  ).json()

  existing = None
  for it in issues:
    if it.get("title") == ISSUE_TITLE:
      existing = it
      break

  if existing:
    number = existing["number"]
    # add a comment
    r = requests.post(
      f"{api}/repos/{owner}/{name}/issues/{number}/comments",
      headers=headers, json={"body": body}, timeout=20
    )
    r.raise_for_status()
    print(f"[ALERT] Commented on existing issue #{number}")
  else:
    r = requests.post(
      f"{api}/repos/{owner}/{name}/issues",
      headers=headers,
      json={"title": ISSUE_TITLE, "body": body, "labels": LABELS},
      timeout=20
    )
    r.raise_for_status()
    print("[ALERT] Created new issue:", r.json().get("html_url"))

if __name__ == "__main__":
  main()

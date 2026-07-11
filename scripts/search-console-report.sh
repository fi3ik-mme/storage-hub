#!/usr/bin/env bash
# Fetch Google Search Console performance for Storage Hub.
# Requires: gcloud CLI, Search Console API enabled, and the same Google account
# that owns https://fi3ik-mme.github.io/storage-hub/ in Search Console.
#
# One-time setup:
#   gcloud auth login
#   gcloud services enable searchconsole.googleapis.com --project=1048248785186
#
# Usage:
#   bash scripts/search-console-report.sh
#   bash scripts/search-console-report.sh 2026-07-01 2026-07-03

set -euo pipefail

SITE_URL='https://fi3ik-mme.github.io/storage-hub/'
ENCODED_SITE='https%3A%2F%2Ffi3ik-mme.github.io%2Fstorage-hub%2F'
API_BASE='https://searchconsole.googleapis.com/webmasters/v3'

END_DATE="${2:-$(date +%Y-%m-%d)}"
START_DATE="${1:-$(date -v-28d +%Y-%m-%d 2>/dev/null || date -d '28 days ago' +%Y-%m-%d)}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Error: gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "Error: not logged in. Run: gcloud auth login" >&2
  exit 1
fi

TOKEN="$(gcloud auth print-access-token)"
AUTH_HEADER="Authorization: Bearer ${TOKEN}"

echo "Storage Hub — Search Console report"
echo "Property: ${SITE_URL}"
echo "Period:   ${START_DATE} → ${END_DATE}"
echo

query() {
  local dimensions="$1"
  local limit="${2:-10}"
  curl -sS -X POST \
    -H "${AUTH_HEADER}" \
    -H 'Content-Type: application/json' \
    "${API_BASE}/sites/${ENCODED_SITE}/searchAnalytics/query" \
    -d "{\"startDate\":\"${START_DATE}\",\"endDate\":\"${END_DATE}\",\"dimensions\":[${dimensions}],\"rowLimit\":${limit}}"
}

print_table() {
  python3 - "$@" <<'PY'
import json, sys

title, raw = sys.argv[1], sys.argv[2]
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print(f"{title}: API error\n{raw}", file=sys.stderr)
    sys.exit(1)

rows = data.get("rows") or []
if not rows:
    print(f"{title}: no data yet (impressions can take 2–3 days to appear)")
    return

print(title)
print(f"{'Impr':>7}  {'Clicks':>6}  {'CTR':>6}  {'Pos':>5}  Dimension")
print("-" * 72)
for row in rows:
    impr = int(row.get("impressions", 0))
    clicks = int(row.get("clicks", 0))
    ctr = row.get("ctr", 0) * 100
    pos = row.get("position", 0)
    keys = " | ".join(row.get("keys") or ["(total)"])
    print(f"{impr:>7}  {clicks:>6}  {ctr:>5.1f}%  {pos:>5.1f}  {keys}")
print()
PY
}

# Verify property access
SITES="$(curl -sS -H "${AUTH_HEADER}" "${API_BASE}/sites")"
if ! echo "${SITES}" | python3 -c "import json,sys; sites=[e['siteUrl'] for e in json.load(sys.stdin).get('siteEntry',[])]; sys.exit(0 if '${SITE_URL}' in sites else 1)" 2>/dev/null; then
  echo "Warning: ${SITE_URL} not found in your Search Console account." >&2
  echo "Signed-in properties:" >&2
  echo "${SITES}" | python3 -c "import json,sys; [print(' ', e['siteUrl']) for e in json.load(sys.stdin).get('siteEntry',[])]" 2>/dev/null || echo "${SITES}" >&2
  echo >&2
  echo "Use the Google account that verified the site in Search Console." >&2
  exit 1
fi

print_table "Summary (site total)" "$(query '')" 1
print_table "Top pages" "$(query '\"page\"' 15)"
print_table "Top queries" "$(query '\"query\"' 15)"

echo "Dashboard: https://search.google.com/search-console/performance/search-analytics?resource_id=${ENCODED_SITE}"

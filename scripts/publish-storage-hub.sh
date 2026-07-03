#!/usr/bin/env bash
# Finish migration to https://mishamikuseleks.github.io/storage-hub/
# Requires: .git_key line 2 (fine-grained PAT with Contents write on target repo)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY_FILE="$ROOT/.git_key"
TOKEN="$(sed -n '2p' "$KEY_FILE" | tr -d '[:space:]')"
AUTH="https://MishaMikusEleks:${TOKEN}@github.com"
API() { curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$@"; }

cd "$ROOT"

echo "→ Checking empty storage-hub blocker..."
EMPTY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/MishaMikusEleks/storage-hub)"

if [ "$EMPTY_STATUS" = "200" ]; then
  SIZE="$(API https://api.github.com/repos/MishaMikusEleks/storage-hub | python3 -c 'import sys,json; print(json.load(sys.stdin).get("size",-1))')"
  if [ "$SIZE" = "0" ]; then
    echo ""
    echo "Blocked: empty repo MishaMikusEleks/storage-hub exists but this PAT cannot write to it."
    echo "Fix (choose one):"
    echo "  A) Delete it: https://github.com/MishaMikusEleks/storage-hub/settings (Danger Zone)"
    echo "  B) Edit PAT: https://github.com/settings/personal-access-tokens"
    echo "     → add repository 'storage-hub' with Contents: Read and write"
    echo ""
    echo "Then re-run: bash scripts/publish-storage-hub.sh"
    exit 1
  fi
fi

echo "→ Trying direct push to storage-hub..."
if git push "$AUTH/MishaMikusEleks/storage-hub.git" main 2>/dev/null; then
  TARGET="storage-hub"
else
  if [ "$EMPTY_STATUS" = "404" ]; then
    echo "→ Renaming storage-hub-tmp → storage-hub..."
    API -X PATCH https://api.github.com/repos/MishaMikusEleks/storage-hub-tmp \
      -d '{"name":"storage-hub","description":"Storage Hub — browser file manager for Google Drive, local storage, and GitHub repos","homepage":"https://mishamikuseleks.github.io/storage-hub/"}' \
      | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("full_name", d.get("message"))); sys.exit(0 if d.get("name")=="storage-hub" else 1)'
    TARGET="storage-hub"
  else
    echo "Push failed and storage-hub still exists. See instructions above."
    exit 1
  fi
fi

echo "→ Ensuring GitHub Pages (main /)..."
PAGES_HTTP="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/MishaMikusEleks/$TARGET/pages \
  -d '{"build_type":"legacy","source":{"branch":"main","path":"/"}}')"
echo "   Pages API: HTTP $PAGES_HTTP (409 = already enabled)"

git remote set-url origin "https://github.com/MishaMikusEleks/$TARGET.git"

echo ""
echo "Done. Repository: https://github.com/MishaMikusEleks/$TARGET"
echo "Live site (may take 1–2 min): https://mishamikuseleks.github.io/storage-hub/"

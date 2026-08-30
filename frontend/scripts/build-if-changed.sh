#!/usr/bin/env bash
# Wrapper untuk Cloudflare Pages — build hanya jika folder app berubah.
# Dipakai sebagai Build command di dashboard Cloudflare Pages:
#   bash scripts/build-if-changed.sh console-admin
#   bash scripts/build-if-changed.sh console-user
#   bash scripts/build-if-changed.sh console-landing
#   bash scripts/build-if-changed.sh console-docs
#
# Cara kerja:
# - Baca CF_PAGES_COMMIT_SHA (di-set otomatis oleh Cloudflare)
# - Bandingkan commit sekarang vs parent via git diff
# - Jika apps/<nama>/ atau package.json berubah → jalankan npm run build
# - Jika tidak ada perubahan → skip build tapi tetap exit 0 (Pages anggap sukses, deploy dilewati/tetap pakai build sebelumnya)
# - Lokal (tanpa CF_PAGES_COMMIT_SHA) → selalu build
set -euo pipefail

APP_NAME="${1:-}"
if [ -z "$APP_NAME" ]; then
  echo "usage: build-if-changed.sh <app-name> (console-admin|console-user|console-auth|console-landing|console-docs)" >&2
  exit 1
fi

APP_DIR="apps/$APP_NAME"
WORKSPACE_FILES="package.json package-lock.json"

# Lokal: selalu build
SHA="${CF_PAGES_COMMIT_SHA:-}"
if [ -z "$SHA" ]; then
  echo "[build-if-changed] Lokal — build $APP_NAME"
  npm run build -w "apps/$APP_NAME"
  exit $?
fi

# Cloudflare Pages clone shallow — ambil history parent dulu
if ! git rev-parse --verify "$SHA^" >/dev/null 2>&1; then
  echo "[build-if-changed] Fetch parent commit..."
  git fetch --depth=2 origin "${CF_PAGES_BRANCH:-main}" 2>/dev/null || git fetch --depth=2 2>/dev/null || true
fi

if ! git rev-parse --verify "$SHA^" >/dev/null 2>&1; then
  echo "[build-if-changed] First deploy — build $APP_NAME"
  npm run build -w "apps/$APP_NAME"
  exit $?
fi

CHANGED="$(git diff --name-only "$SHA^" "$SHA" || true)"
echo "[build-if-changed] Changed files:"
echo "$CHANGED" | sed 's/^/  /'

SHOULD_BUILD=0
for f in $CHANGED; do
  case "$f" in
    "$APP_DIR"/*) SHOULD_BUILD=1; echo "[build-if-changed] → $APP_DIR changed"; break ;;
    frontend/"$APP_DIR"/*) SHOULD_BUILD=1; echo "[build-if-changed] → frontend/$APP_DIR changed"; break ;;
    frontend/package.json|frontend/package-lock.json) SHOULD_BUILD=1; echo "[build-if-changed] → workspace package.json changed"; break ;;
    package.json|package-lock.json) SHOULD_BUILD=1; echo "[build-if-changed] → root package.json changed"; break ;;
  esac
done

if [ "$SHOULD_BUILD" -eq 1 ]; then
  echo "[build-if-changed] Building $APP_NAME..."
  npm run build -w "apps/$APP_NAME"
else
  echo "[build-if-changed] No changes in $APP_DIR — skipping build (exit 0, Pages keeps previous deployment)"
  # Pastikan output dir ada agar Pages tidak error "Output directory not found"
  mkdir -p "$APP_DIR/dist"
  # Jika dist kosong (fresh clone + skip), buat placeholder supaya Pages tidak fail
  if [ ! -f "$APP_DIR/dist/index.html" ]; then
    echo '<!doctype html><html><body>Skipped — no changes</body></html>' > "$APP_DIR/dist/index.html"
  fi
fi
exit 0

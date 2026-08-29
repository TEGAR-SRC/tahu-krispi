#!/usr/bin/env bash
# Generates .env for frontend local development (kilat-cloud.com domains).
# Never commit the resulting .env — it is gitignored.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists — leaving it untouched."
  exit 0
fi

cat > .env <<EOF
# Kilat Cloud Frontend — Local development environment
VITE_APP_TITLE=Kilat Cloud
VITE_APP_DOMAIN=localhost
VITE_API_BASE_URL=http://localhost:8080
VITE_PORT=5173
VITE_CONSOLE_BASE_URL=http://localhost:5173
VITE_DOWNLOAD_BASE_URL=https://dl.kilat-cloud.com
VITE_REQUEST_ID_HEADER=X-Request-ID
EOF

chmod 600 .env
echo ".env generated (chmod 600)."

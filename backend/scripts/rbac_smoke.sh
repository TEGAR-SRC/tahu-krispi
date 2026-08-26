#!/usr/bin/env bash
# Live RBAC matrix + hourly quote verification.
set -euo pipefail
cd "$(dirname "$0")/.."   # backend root
set -a; . ./.env; set +a
B=http://localhost:8081
TS=$(date +%s)
PSQL() { psql "$DATABASE_URL" -tAc "$1"; }

register() { # $1 prefix
  curl -s -X POST $B/v1/auth/register -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1$TS@kilat-cloud.com\",\"password\":\"SuperSecret123!\",\"full_name\":\"X\",\"terms_accepted\":true,\"privacy_accepted\":true}" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["access_token"])'
}
token_of() { curl -s -X POST $B/v1/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1$TS@kilat-cloud.com\",\"password\":\"SuperSecret123!\"}" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["access_token"])'; }

for u in fin noc cst; do register "$u" >/dev/null; done
PSQL "UPDATE app.users SET staff_role='finance' WHERE email='fin$TS@kilat-cloud.com'"
PSQL "UPDATE app.users SET staff_role='noc'     WHERE email='noc$TS@kilat-cloud.com'"

ADM=$(curl -s -c /tmp/rb-adm.jar -X POST $B/v1/auth/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"adm$TS@kilat-cloud.com\",\"password\":\"SuperSecret123!\",\"full_name\":\"A\",\"terms_accepted\":true,\"privacy_accepted\":true}" >/dev/null
  PSQL "UPDATE app.users SET is_platform_admin=true WHERE email='adm$TS@kilat-cloud.com'" >/dev/null
  curl -s -c /tmp/rb-adm.jar -b /tmp/rb-adm.jar -X POST $B/v1/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"adm$TS@kilat-cloud.com\",\"password\":\"SuperSecret123!\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["access_token"])')
FIN=$(token_of fin); NOC=$(token_of noc); CST=$(token_of cst)
CUSTID=$(PSQL "SELECT id FROM app.users WHERE email='cst$TS@kilat-cloud.com'")

probe() { # $1 label, $2 who-token, $3 path, $4 method, $5 expect
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X "${4:-GET}" "$B/v1/admin/$3" -H "Authorization: Bearer $2")
  local verdict="FAIL"; [ "$code" = "$5" ] && verdict="ok"
  printf "%-6s %-46s -> %s (harap %s)\n" "$verdict" "$1" "$code" "$5"
}
echo "== Matriks RBAC live =="
probe "finance baca orders"            "$FIN" "orders?page=1"                          GET  200
probe "noc baca orders"                "$NOC" "orders?page=1"                          GET  403
probe "customer baca admin orders"     "$CST" "orders?page=1"                          GET  403
probe "noc list instances"             "$NOC" "instances?page=1"                       GET  200
probe "finance list instances"         "$FIN" "instances?page=1"                       GET  403
probe "noc tickets"                    "$NOC" "tickets"                                GET  200
probe "finance tickets"                "$FIN" "tickets"                                GET  403
probe "finance suspend user (admin-only)" "$FIN" "users/$CUSTID/suspend"             POST 403
probe "noc set limits (admin-only)"    "$NOC" "users/$CUSTID/limits"                   PATCH 403
probe "admin audit-logs"               "$ADM" "audit-logs"                             GET  200
probe "finance audit-logs (admin-only)" "$FIN" "audit-logs"                           GET  403

echo "== Quote hourly =="
ORG=$(curl -s $B/v1/organizations -H "Authorization: Bearer $CST" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])')
curl -s -o /tmp/h.json -w 'hourly HTTP ' -X POST $B/v1/pricing/quote \
  -H "Authorization: Bearer $CST" -H "X-Organization-ID: $ORG" -H 'Content-Type: application/json' \
  -d '{"custom_resources":{"vcpu":3,"ram_gb":5,"nvme_gb":80},"currency":"IDR","billing_period":"hourly"}'
python3 - <<'PY'
import json
d = json.load(open('/tmp/h.json'))["data"]
print(d["total"], "| breakdown:")
for l in d["breakdown"]:
    print("  ", l["dimension_code"], l["unit_price"], "x", l["billable_quantity"], "=", l["amount"])
PY

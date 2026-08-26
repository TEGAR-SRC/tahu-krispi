#!/usr/bin/env bash
# Drill-down detail verification: admin order/invoice/instance + customer order.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
B=${BASE:-http://localhost:8081}
TS=$(date +%s)
PSQL() { psql "$DATABASE_URL" -tAc "$1"; }

ACC=$( {
  curl -s -c /tmp/dd.jar -X POST $B/v1/auth/register -H 'Content-Type: application/json' \
    -d "{\"email\":\"adm$TS@kilat-cloud.com\",\"password\":\"SuperSecret123!\",\"full_name\":\"A\",\"terms_accepted\":true,\"privacy_accepted\":true}" >/dev/null
  PSQL "UPDATE app.users SET is_platform_admin=true WHERE email='adm$TS@kilat-cloud.com'" >/dev/null
  curl -s -b /tmp/dd.jar -X POST $B/v1/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"adm$TS@kilat-cloud.com\",\"password\":\"SuperSecret123!\"}" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["access_token"])'
} )

ORD=$(PSQL "SELECT id FROM app.orders WHERE coupon_id IS NOT NULL ORDER BY created_at DESC LIMIT 1")
echo "== admin order detail =="
curl -s "$B/v1/admin/orders/$ORD" -H "Authorization: Bearer $ACC" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
print("order:",d["public_id"],"| status:",d["status"],"| total:",d["total"])
print("items:",[(i["description"],i["quantity"],i["unit_price"]) for i in d["items"]])
print("invoices:",d["invoices"])
print("coupon:",(d.get("coupon_redemption") or {}).get("code"))
q=d.get("quote") or {}
print("quote:",q.get("price_mode"),"total",q.get("total"))'

INV=$(PSQL "SELECT id FROM app.invoices ORDER BY created_at DESC LIMIT 1")
echo "== admin invoice detail =="
curl -s "$B/v1/admin/invoices/$INV" -H "Authorization: Bearer $ACC" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
print("invoice:",d["invoice_number"],d["status"],"due",d["amount_due"])
print("items:",len(d["items"]),"payments:",len(d.get("payments",[])),"events:",len(d.get("payment_events",[])))'

IID=$(PSQL "SELECT id FROM app.instances ORDER BY created_at DESC LIMIT 1")
if [ -n "$IID" ]; then
  echo "== admin instance detail (NOC) =="
  curl -s "$B/v1/admin/instances/$IID" -H "Authorization: Bearer $ACC" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
print("instance:",d["name"],d["status"],"| provider_actions:",len(d["provider_actions"]),"jobs:",len(d["jobs"]),"counts:",d["child_counts"])'
else
  echo "(no instances yet — NOC detail endpoint registered, untested)"
fi

OPUB=$(PSQL "SELECT public_id FROM app.orders WHERE coupon_id IS NOT NULL ORDER BY created_at DESC LIMIT 1")
OORG=$(PSQL "SELECT organization_id FROM app.orders WHERE coupon_id IS NOT NULL ORDER BY created_at DESC LIMIT 1")
echo "== customer order detail =="
curl -s "$B/v1/orders/$OPUB" -H "Authorization: Bearer $(PSQL "SELECT id FROM app.users WHERE email='nonexist'" >/dev/null; echo)" >/dev/null 2>&1 || true
# customer token: buat user & jadikan owner org tsb via direct DB agar sederhana
CMAIL="own$TS@kilat-cloud.com"
curl -s -X POST $B/v1/auth/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$CMAIL\",\"password\":\"SuperSecret123!\",\"full_name\":\"O\",\"terms_accepted\":true,\"privacy_accepted\":true}" >/dev/null
CTOK=$(curl -s -X POST $B/v1/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$CMAIL\",\"password\":\"SuperSecret123!\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["access_token"])')
CUUID=$(PSQL "SELECT id FROM app.users WHERE email='$CMAIL'")
psql "$DATABASE_URL" -qc "INSERT INTO app.organization_members(organization_id, user_id, role) VALUES ('$OORG','$CUUID','owner') ON CONFLICT DO NOTHING; UPDATE app.organizations SET created_by='$CUUID' WHERE id='$OORG'" >/dev/null
curl -s "$B/v1/orders/$OPUB" -H "Authorization: Bearer $CTOK" -H "X-Organization-ID: $OORG" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
print("customer order view:",d["public_id"],"| invoices:",d["invoices"],"| has items:",("items" in d))'

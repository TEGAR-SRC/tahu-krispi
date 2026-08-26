#!/usr/bin/env bash
# End-to-end smoke test for the Kilat Cloud backend.
# Usage: BASE=http://localhost:8081 bash scripts/smoke.sh
set -uo pipefail

BASE="${BASE:-http://localhost:8081}"
PASS=0
FAIL=0
TS=$(date +%s)
JAR=$(mktemp)
RESP=/tmp/kilat-smoke-resp.json

say() { printf '%s\n' "$*"; }
ok() { PASS=$((PASS + 1)); say "  ok   $1"; }
fail() { FAIL=$((FAIL + 1)); say "  FAIL $1"; }

jsonget() { # jsonget FILE pyexpr
  python3 -c "import json,sys;d=json.load(open('$1'));print($2)" 2>/dev/null || echo ""
}

# req METHOD PATH [DATA] [AUTH_HEADER] -> prints HTTP status, body saved to $RESP
req() {
  local m=$1 p=$2 d=${3:-} a=${4:-}
  local args=(-s -o "$RESP" -w '%{http_code}' -X "$m" "$BASE$p")
  [ -n "$d" ] && args+=(-H 'Content-Type: application/json' --data-binary "$d")
  [ -n "$a" ] && args+=(-H "$a")
  [ -n "${ORG:-}" ] && args+=(-H "X-Organization-ID: $ORG")
  args+=(-b "$JAR" -c "$JAR")
  curl "${args[@]}"
}

expect() { # expect GOT WANT DESC
  local got=$1 want=$2 desc=$3
  if [ "$got" = "$want" ]; then ok "$desc [$got]"; else fail "$desc — got $got want $want body=$(head -c 220 "$RESP")"; fi
}

say "== health =="
expect "$(req GET /healthz)" 200 "GET /healthz"
expect "$(req GET /readyz)" 200 "GET /readyz"

say "== auth =="
EMAIL="smoke${TS}@kilat-cloud.com"
REG_DATA='{"email":"'"$EMAIL"'","password":"SuperSecret123!","full_name":"Smoke Bot","terms_accepted":true,"privacy_accepted":true}'
expect "$(req POST /v1/auth/register "$REG_DATA")" 201 "POST /auth/register"
ACCESS=$(jsonget "$RESP" "d['data']['access_token']")
[ -n "$ACCESS" ] && ok "register returns access_token" || fail "no access_token in register response"
AUTH="Authorization: Bearer $ACCESS"

LOGIN_DATA='{"email":"'"$EMAIL"'","password":"SuperSecret123!"}'
expect "$(req POST /v1/auth/login "$LOGIN_DATA")" 200 "POST /auth/login"
expect "$(req GET /v1/me)" 401 "GET /me without token -> 401"
expect "$(req GET /v1/me "" "$AUTH")" 200 "GET /me with token"

req GET /v1/organizations "" "$AUTH" >/dev/null
ORG=$(jsonget "$RESP" "d['data'][0]['id']")
if [ -n "$ORG" ]; then ok "personal organization present"; else fail "no organization returned"; fi

say "== negative cases =="
BAD_LOGIN='{"email":"'"$EMAIL"'","password":"WrongPassword!"}'
expect "$(req POST /v1/auth/login "$BAD_LOGIN")" 401 "login wrong password -> 401"
DUP_REG='{"email":"'"$EMAIL"'","password":"AnotherSecret123!","terms_accepted":true,"privacy_accepted":true}'
expect "$(req POST /v1/auth/register "$DUP_REG")" 409 "duplicate email register -> 409"

say "== profile & addresses =="
expect "$(req PATCH /v1/me/profile '{"country_code":"ID","company_name":"Kilat Dev"}' "$AUTH")" 200 "PATCH /me/profile"
ADDR_DATA='{"type":"billing","country_code":"ID","city_or_regency":"Jakarta","address_line1":"Jl. Cloud 1","postal_code":"12190","is_default":true}'
expect "$(req POST /v1/me/addresses "$ADDR_DATA" "$AUTH")" 201 "POST /me/addresses"
expect "$(req GET /v1/me/addresses "" "$AUTH")" 200 "GET /me/addresses"
expect "$(req GET /v1/me/profile-completion "" "$AUTH")" 200 "GET /me/profile-completion"
expect "$(req GET /v1/me/sessions "" "$AUTH")" 200 "GET /me/sessions"
expect "$(req GET /v1/me/security/events "" "$AUTH")" 200 "GET /me/security/events"

say "== MFA =="
expect "$(req POST /v1/me/mfa/totp/setup '{}' "$AUTH")" 200 "POST /me/mfa/totp/setup"
TOTP_SECRET=$(jsonget "$RESP" "d['data']['secret']")
if [ -n "$TOTP_SECRET" ]; then
  CODE=$(python3 - "$TOTP_SECRET" <<'PY'
import sys, hmac, hashlib, base64, struct, time
s = sys.argv[1]
key = base64.b32decode(s + '=' * ((8 - len(s) % 8) % 8))
c = int(time.time()) // 30
mac = hmac.new(key, struct.pack('>Q', c), hashlib.sha1).digest()
o = mac[-1] & 15
print('%06d' % ((struct.unpack('>I', mac[o:o + 4])[0] & 0x7fffffff) % 1000000))
PY
)
  CONFIRM_DATA='{"code":"'"$CODE"'"}'
  expect "$(req POST /v1/me/mfa/totp/confirm "$CONFIRM_DATA" "$AUTH")" 200 "confirm TOTP with valid code"
else
  fail "totp setup did not return secret"
fi

say "== API keys =="
KEY_DATA='{"name":"smoke-key","owner_type":"user","scopes":["instances.read","profile.read"]}'
expect "$(req POST /v1/api-keys "$KEY_DATA" "$AUTH")" 201 "POST /api-keys"
APIKEY=$(jsonget "$RESP" "d['data']['secret']")
[ -n "$APIKEY" ] && ok "api key secret shown once" || fail "no api key secret"
KEYID=$(jsonget "$RESP" "d['data']['key']['id']")
expect "$(req GET "/v1/api-keys/$KEYID" "" "$AUTH")" 200 "GET /api-keys/:id"
ROT_CODE=$(req POST "/v1/api-keys/$KEYID/rotate" '{}' "$AUTH")
case "$ROT_CODE" in
  200 | 201) ok "POST /api-keys/:id/rotate [$ROT_CODE]"; APIKEY=$(jsonget "$RESP" "d['data']['secret']") ;;
  *) fail "rotate api key — got $ROT_CODE" ;;
esac
expect "$(req GET /v1/me "" "X-API-Key: $APIKEY")" 200 "GET /me via X-API-Key"
expect "$(req DELETE "/v1/api-keys/$KEYID" "" "$AUTH")" 204 "DELETE (revoke) api key"

say "== catalog =="
expect "$(req GET /v1/regions)" 200 "GET /regions"
expect "$(req GET /v1/plans)" 200 "GET /plans"
expect "$(req GET /v1/instance-types)" 200 "GET /instance-types"
expect "$(req GET /v1/os-templates)" 200 "GET /os-templates"

say "== wallet topup + webhook =="
TOPUP_DATA='{"amount":150000,"currency":"IDR"}'
expect "$(req POST /v1/wallet/topup "$TOPUP_DATA" "$AUTH")" 201 "POST /wallet/topup"
PAYID=$(jsonget "$RESP" "d['data']['id']")
WEBHOOK_SECRET=$(grep '^PAYMENT_WEBHOOK_SECRET=' .env | cut -d= -f2)
if [ -n "$PAYID" ] && [ -n "$WEBHOOK_SECRET" ]; then
  EVENT_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
  WH_BODY='{"event_id":"'"$EVENT_ID"'","payment_id":"'"$PAYID"'","event_type":"payment.settled","status":"paid","fee":0}'
  SIG=$(printf '%s' "$WH_BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -binary | base64 | tr '+/' '-_' | tr -d '=')
  expect "$(req POST /v1/payments/webhook "$WH_BODY" "X-Signature: $SIG")" 200 "POST /payments/webhook (topup paid)"
  expect "$(req POST /v1/payments/webhook "$WH_BODY" "X-Signature: $SIG")" 200 "webhook replay idempotent"
else
  fail "topup payment id or webhook secret missing"
fi
sleep 7 # allow worker to credit the wallet from the queued job
expect "$(req GET '/v1/wallet?currency=IDR' "" "$AUTH")" 200 "GET /wallet after topup"
BAL=$(jsonget "$RESP" "d['data']['balance']")
if python3 -c "exit(0 if float('${BAL:-0}')>=150000 else 1)" 2>/dev/null; then ok "wallet credited (balance=$BAL)"; else fail "wallet balance=$BAL (worker may not have processed yet)"; fi
expect "$(req GET '/v1/wallet/transactions?currency=IDR' "" "$AUTH")" 200 "GET /wallet/transactions"

say "== orders/invoices/subscriptions =="
expect "$(req POST /v1/orders '{"items":[]}' "$AUTH")" 400 "POST /orders without quote_id -> 400"
expect "$(req GET /v1/orders "" "$AUTH")" 200 "GET /orders"
expect "$(req GET /v1/invoices "" "$AUTH")" 200 "GET /invoices"
expect "$(req GET /v1/subscriptions "" "$AUTH")" 200 "GET /subscriptions"

say "== instances =="
expect "$(req GET /v1/instances "" "$AUTH")" 200 "GET /instances"
QUO_DATA='{"custom_resources":{"vcpu":2,"ram_gb":4,"nvme_gb":80},"currency":"IDR","billing_period":"monthly"}'
expect "$(req POST /v1/pricing/quote "$QUO_DATA" "$AUTH")" 200 "quote with seeded rates"
python3 -c 'import json;d=json.load(open("'"$RESP"'"))["data"];assert d["total"]>0 and d["breakdown"]' 2>/dev/null && ok "quote breakdown valid" || fail "quote breakdown invalid"

say "== network =="
VPC_DATA='{"name":"smoke-vpc","ipv4_cidr":"10.10.0.0/24"}'
expect "$(req POST /v1/vpcs "$VPC_DATA" "$AUTH")" 201 "POST /vpcs"
VPCID=$(jsonget "$RESP" "d['data']['id']")
expect "$(req GET /v1/vpcs "" "$AUTH")" 200 "GET /vpcs"
expect "$(req DELETE "/v1/vpcs/$VPCID" "" "$AUTH")" 204 "DELETE /vpcs/:id"
FW_DATA='{"name":"smoke-fw","description":"smoke firewall"}'
expect "$(req POST /v1/firewall-groups "$FW_DATA" "$AUTH")" 201 "POST /firewall-groups"
FWID=$(jsonget "$RESP" "d['data']['id']")
RULE_DATA='{"protocol":"tcp","port_from":443,"port_to":443,"subnet":"0.0.0.0/0"}'
expect "$(req POST "/v1/firewall-groups/$FWID/rules" "$RULE_DATA" "$AUTH")" 201 "POST firewall rule"
BAD_RULE='{"protocol":"bogus","subnet":"0.0.0.0/0"}'
expect "$(req POST "/v1/firewall-groups/$FWID/rules" "$BAD_RULE" "$AUTH")" 400 "invalid protocol rule -> 400"
expect "$(req GET "/v1/firewall-groups/$FWID/rules" "" "$AUTH")" 200 "GET firewall rules"
expect "$(req POST /v1/ip-lists '{"name":"office"}' "$AUTH")" 201 "POST /ip-lists"
ILID=$(jsonget "$RESP" "d['data']['id']")
ENTRY_DATA='{"value":"192.168.1.0/24"}'
expect "$(req POST "/v1/ip-lists/$ILID/entries" "$ENTRY_DATA" "$AUTH")" 201 "add ip list entry"
expect "$(req POST "/v1/ip-lists/$ILID/entries" "$ENTRY_DATA" "$AUTH")" 409 "duplicate entry -> 409"
expect "$(req GET "/v1/ip-lists/$ILID" "" "$AUTH")" 200 "GET /ip-lists/:id"

say "== support & notifications =="
TICKET_DATA='{"subject":"Smoke ticket","body":"hello","priority":"low"}'
expect "$(req POST /v1/tickets "$TICKET_DATA" "$AUTH")" 201 "POST /tickets"
TICKID=$(jsonget "$RESP" "d['data']['id']")
REPLY_DATA='{"body":"reply from smoke"}'
expect "$(req POST "/v1/tickets/$TICKID/messages" "$REPLY_DATA" "$AUTH")" 201 "reply ticket"
expect "$(req GET "/v1/tickets/$TICKID/messages" "" "$AUTH")" 200 "GET ticket messages"
expect "$(req POST "/v1/tickets/$TICKID/close" '{}' "$AUTH")" 200 "close ticket"
expect "$(req GET /v1/notifications "" "$AUTH")" 200 "GET /notifications"
expect "$(req POST /v1/notifications/read-all '{}' "$AUTH")" 200 "POST /notifications/read-all"
WH_DATA='{"name":"ops-hook","url":"https://hooks.kilat-cloud.com/smoke","events":["invoice.paid"]}'
expect "$(req POST /v1/webhooks "$WH_DATA" "$AUTH")" 201 "POST /webhooks"
WHID=$(jsonget "$RESP" "d['data']['webhook']['id']")
expect "$(req GET /v1/webhook-deliveries "" "$AUTH")" 200 "GET /webhook-deliveries"
expect "$(req DELETE "/v1/webhooks/$WHID" "" "$AUTH")" 204 "DELETE /webhooks/:id"

say "== audit & dashboard =="
expect "$(req GET /v1/audit-logs "" "$AUTH")" 200 "GET /audit-logs"
expect "$(req GET /v1/dashboard/summary "" "$AUTH")" 200 "GET /dashboard/summary"

say "== admin guard =="
expect "$(req GET /v1/admin/users "" "$AUTH")" 403 "non-admin GET /admin/users -> 403"

say ""
say "SMOKE RESULT: PASS=$PASS FAIL=$FAIL"
rm -f "$JAR"
[ "$FAIL" = "0" ]

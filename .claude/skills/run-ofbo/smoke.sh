#!/usr/bin/env bash
# OFBO demo-profile driver: launches the Nebras simulator + BFF locally,
# drives one real flow through each surface, and reports PASS/FAIL.
#
# Usage (from repo root):
#   .claude/skills/run-ofbo/smoke.sh          # launch, smoke, shut down
#   .claude/skills/run-ofbo/smoke.sh --keep   # launch, smoke, LEAVE RUNNING
#
# Ports: BFF http://localhost:${BFF_PORT:-8787}, sim http://localhost:${SIM_PORT:-8788}.
# Reads repo-root .env if present (DATABASE_URL -> durable Postgres stores,
# SIM_ADMIN_TOKEN -> guards the sim's /admin/faults endpoint).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BFF_PORT="${BFF_PORT:-8787}"
SIM_PORT="${SIM_PORT:-8788}"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

for port in "$BFF_PORT" "$SIM_PORT"; do
  if lsof -ti ":$port" >/dev/null 2>&1; then
    echo "FATAL: port $port already in use (old run? 'lsof -ti :$port | xargs kill')" >&2
    exit 1
  fi
done

LOG_DIR="${TMPDIR:-/tmp}/ofbo-run"
mkdir -p "$LOG_DIR"

(cd "$ROOT/services/nebras-sim" && PORT="$SIM_PORT" ADMIN_TOKEN="${SIM_ADMIN_TOKEN:-}" \
  exec pnpm exec tsx scripts/serve.ts) >"$LOG_DIR/sim.log" 2>&1 &
SIM_PID=$!
(cd "$ROOT/services/bff" && PORT="$BFF_PORT" \
  exec pnpm exec tsx scripts/serve.ts) >"$LOG_DIR/bff.log" 2>&1 &
BFF_PID=$!

cleanup() {
  kill "$SIM_PID" "$BFF_PID" 2>/dev/null
  wait "$SIM_PID" "$BFF_PID" 2>/dev/null
}
[ "$KEEP" = 1 ] || trap cleanup EXIT

# Readiness: sim has no /, probe a data route; any BFF response (even 400) means up.
for i in $(seq 1 60); do
  curl -sf "http://localhost:$SIM_PORT/tpp-reports/2026-05" -o /dev/null && sim_up=1 || sim_up=0
  curl -s "http://localhost:$BFF_PORT/" -o /dev/null && bff_up=1 || bff_up=0
  [ "$sim_up" = 1 ] && [ "$bff_up" = 1 ] && break
  sleep 0.5
done
if [ "${sim_up:-0}" != 1 ] || [ "${bff_up:-0}" != 1 ]; then
  echo "FATAL: services did not come up; logs in $LOG_DIR" >&2
  tail -5 "$LOG_DIR"/*.log >&2
  [ "$KEEP" = 1 ] && cleanup
  exit 1
fi

FAILS=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected $2, got $3)"; FAILS=$((FAILS+1)); fi
}
FAPI="$(uuidgen | tr 'A-Z' 'a-z')"
BFF="http://localhost:$BFF_PORT"
SIM="http://localhost:$SIM_PORT"

# --- BFF middleware chain ---
check "BFF: missing x-fapi-interaction-id -> 400" 400 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BFF/approvals/pending")"
check "BFF: no bearer token -> 401" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BFF/approvals/pending" -H "x-fapi-interaction-id: $FAPI")"
check "BFF: demo persona token -> 200 approvals list" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BFF/approvals/pending" \
     -H "x-fapi-interaction-id: $FAPI" -H "Authorization: Bearer demo-token:customer-care-agent")"
# Probe a contract path whose scope the persona holds (platform:operations:read) but
# that has no story yet — the onboarding-handover-health view is a stable 501 stub — so
# this exercises the 501 path, not a scope denial. Prior probes (finance-view, then the
# BCBS 239 lineage read) have since been implemented (BACKOFFICE-31, -49); update this if
# onboarding-handover-health ever gets built.
check "BFF: unimplemented contract path -> 501 envelope" 501 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BFF/back-office/analytics/onboarding-handover-health" \
     -H "x-fapi-interaction-id: $FAPI" -H "Authorization: Bearer demo-token:operations-analyst")"

# --- Nebras simulator: deterministic data + fault injection round-trip ---
check "sim: TPP report 2026-05 -> 200" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$SIM/tpp-reports/2026-05")"

ADMIN_HDR=()
[ -n "${SIM_ADMIN_TOKEN:-}" ] && ADMIN_HDR=(-H "x-admin-token: $SIM_ADMIN_TOKEN")
check "sim: inject fee_variance fault -> 201" 201 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SIM/admin/faults" "${ADMIN_HDR[@]}" \
     -H 'Content-Type: application/json' \
     -d '{"fault":"fee_variance","period":"2026-05","variance_minor_units":999}')"
if [ -n "${SIM_ADMIN_TOKEN:-}" ]; then
  check "sim: wrong admin token -> 401" 401 \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SIM/admin/faults" -H 'x-admin-token: wrong' -d '{}')"
fi
# The fault perturbs exactly one deterministic line of the period's report.
baseline_total="$(curl -s "$SIM/tpp-reports/2026-06" | python3 -c 'import sys,json;print(sum(r["fee"]["amount"] for r in json.load(sys.stdin)["rows"]))')"
faulted_total="$(curl -s "$SIM/tpp-reports/2026-05" | python3 -c 'import sys,json;print(sum(r["fee"]["amount"] for r in json.load(sys.stdin)["rows"]))')"
clean="$(curl -s -X DELETE "$SIM/admin/faults" "${ADMIN_HDR[@]}" -o /dev/null -w '%{http_code}')"
check "sim: clear faults -> 200" 200 "$clean"
unfaulted_total="$(curl -s "$SIM/tpp-reports/2026-05" | python3 -c 'import sys,json;print(sum(r["fee"]["amount"] for r in json.load(sys.stdin)["rows"]))')"
check "sim: fault perturbed report by +999 minor units" "$((unfaulted_total + 999))" "$faulted_total"

echo
grep -h "listening" "$LOG_DIR"/sim.log "$LOG_DIR"/bff.log
if [ "$FAILS" -gt 0 ]; then
  echo "RESULT: $FAILS check(s) failed; logs in $LOG_DIR"
  [ "$KEEP" = 1 ] && cleanup
  exit 1
fi
if [ "$KEEP" = 1 ]; then
  echo "RESULT: all checks passed — services LEFT RUNNING (BFF pid $BFF_PID, sim pid $SIM_PID)"
  echo "stop with: lsof -ti :$BFF_PORT -ti :$SIM_PORT | xargs kill"
else
  echo "RESULT: all checks passed — services stopped"
fi

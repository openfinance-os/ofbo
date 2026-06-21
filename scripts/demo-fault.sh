#!/usr/bin/env bash
# Presenter helper for the Nebras simulator's injectable faults (PRD §3.1 — "demos must be
# able to trigger breaks and signals on demand"). Wraps POST/DELETE /admin/faults so you don't
# have to remember the curl. Reads SIM_ADMIN_TOKEN + SIM_URL from the repo-root .env if present.
#
#   pnpm demo:fault fee-variance <period> <minor_units>   # e.g. fee-variance 2026-05 999
#   pnpm demo:fault revoke-delay <ms>                      # push a consent revoke past its 5s SLA
#   pnpm demo:fault rate-limit <n>                         # 429 the next N report polls (back-off)
#   pnpm demo:fault list                                   # show active faults
#   pnpm demo:fault clear                                  # remove all injected faults
#
# fee-variance / rate-limit perturb the upstream Nebras surfaces; they only reach the back
# office once it runs its ingestion pass. Follow with `pnpm demo:ingest <period>` to pull the
# fault in on demand (Finance View freshness/aggregate) and refresh risk signals.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
SIM="${SIM_URL:-http://localhost:8788}"
TOKEN="${SIM_ADMIN_TOKEN:-}"
HDR=(-H 'content-type: application/json')
[ -n "$TOKEN" ] && HDR+=(-H "x-admin-token: $TOKEN")

inject() { curl -fsS -X POST "$SIM/admin/faults" "${HDR[@]}" -d "$1" && echo; }

cmd="${1:-list}"
case "$cmd" in
  fee-variance)
    period="${2:?usage: demo:fault fee-variance <period> <minor_units>}"; minor="${3:?minor_units required}"
    echo "Injecting fee_variance: +${minor} fils on period ${period} …"
    inject "{\"fault\":\"fee_variance\",\"period\":\"${period}\",\"variance_minor_units\":${minor}}"
    echo "→ pull it into the back office:  pnpm demo:ingest ${period}   (then refresh the Finance View)" ;;
  revoke-delay)
    ms="${2:?usage: demo:fault revoke-delay <ms>}"
    echo "Injecting revoke_delay: ${ms}ms (>5000 breaches the scheme SLA) …"
    inject "{\"fault\":\"revoke_delay\",\"delay_ms\":${ms}}" ;;
  rate-limit)
    n="${2:?usage: demo:fault rate-limit <n>}"
    echo "Injecting report_rate_limit: 429 the next ${n} report poll(s) …"
    inject "{\"fault\":\"report_rate_limit\",\"fail_times\":${n}}"
    echo "→ pull it into the back office:  pnpm demo:ingest   (exhausted retries → amber freshness)" ;;
  list)
    echo "Active faults:"; curl -fsS "$SIM/admin/faults" "${HDR[@]}"; echo ;;
  clear)
    echo "Clearing all injected faults …"; curl -fsS -X DELETE "$SIM/admin/faults" "${HDR[@]}"; echo ;;
  *)
    echo "usage: pnpm demo:fault {fee-variance <period> <minor>|revoke-delay <ms>|rate-limit <n>|list|clear}" >&2
    exit 2 ;;
esac

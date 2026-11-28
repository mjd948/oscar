#!/usr/bin/env bash
# Nightly ORNL catch-up: if ORNL has published a release that our rollin branches do not contain
# yet, run Claude Code headless with RUNBOOK.md (merge, test, build, rehearse, deploy, roll back on
# failure), then email the summary. Nights with nothing new exit silently and never start Claude.
#
#   nightly-upstream.sh [--no-deploy] [--force-tag vX.Y.Z] [--test-email]
#
#   --no-deploy    stop after the rehearsal; push nothing, leave live alone
#   --force-tag    run for this tag even if it is merged or was already attempted
#   --test-email   send a test email through the configured relay and exit
#
# Config: /etc/oscar-nightly/config (EMAIL_TO, EMAIL_FROM, optional CHECKOUT, DISK_MAX_PCT)
#         /etc/oscar-nightly/claude.env (CLAUDE_CODE_OAUTH_TOKEN=..., mode 600)
set -Euo pipefail

CONF_DIR=/etc/oscar-nightly
LIB_DIR=/usr/local/lib/oscar-nightly
STATE_DIR=/var/lib/oscar-nightly
LOG_ROOT=/var/log/oscar-nightly
CHECKOUT=/root/oscar-nightly
DISK_MAX_PCT=65   # ORNL 3.12 prunes alarm media from 75%; a build + rehearsal needs ~10 GB
CLAUDE_TIMEOUT=6h
MAINTENANCE_LOCK=/run/oscar-maintenance.lock   # touch this to make the job skip a night

NO_DEPLOY=0 FORCE_TAG="" TEST_EMAIL=0
while [ $# -gt 0 ]; do
  case $1 in
    --no-deploy) NO_DEPLOY=1 ;;
    --force-tag) FORCE_TAG=${2:?--force-tag needs a tag}; shift ;;
    --test-email) TEST_EMAIL=1 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# shellcheck source=/dev/null
[ -r "$CONF_DIR/config" ] && . "$CONF_DIR/config"
: "${EMAIL_TO:?EMAIL_TO missing from $CONF_DIR/config}"
EMAIL_FROM=${EMAIL_FROM:-$EMAIL_TO}
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=${HOME:-/root}

send_mail() { # subject, body-file
  {
    printf 'From: OSCAR nightly <%s>\nTo: %s\nSubject: %s\nContent-Type: text/plain; charset=UTF-8\n\n' \
      "$EMAIL_FROM" "$EMAIL_TO" "$1"
    cat "$2"
  } | /usr/sbin/sendmail -f "$EMAIL_FROM" -t
}

if [ "$TEST_EMAIL" = 1 ]; then
  tmp=$(mktemp); printf 'Test message from the OSCAR nightly job on %s at %s.\n' "$(hostname)" "$(date)" >"$tmp"
  send_mail "[OSCAR nightly] test email" "$tmp"; rm -f "$tmp"; echo "sent to $EMAIL_TO"; exit 0
fi

mkdir -p "$STATE_DIR" "$LOG_ROOT"
exec 9>"$STATE_DIR/lock"
flock -n 9 || { echo "another run is in progress"; exit 0; }

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

live_status() { # prints "healthy <image>" or "UNHEALTHY <detail>"
  local h img code
  h=$(docker inspect -f '{{.State.Health.Status}}' oscar-oscar-1 2>/dev/null || echo missing)
  img=$(docker inspect -f '{{.Config.Image}}' oscar-oscar-1 2>/dev/null || echo none)
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 https://localhost/healthz || echo 000)
  if [ "$h" = healthy ] && [ "$code" = 200 ]; then echo "healthy $img"; else echo "UNHEALTHY container=$h healthz=$code image=$img"; fi
}

# 1. Is there anything new? ------------------------------------------------------------------
cd "$CHECKOUT" || { log "checkout $CHECKOUT missing"; exit 1; }
TAG=$FORCE_TAG
[ -n "$TAG" ] || TAG=$(gh release list -R ORNL/oscar --limit 1 --exclude-drafts --exclude-pre-releases \
                       --json tagName -q '.[0].tagName') || { log "gh release list failed"; exit 1; }
[ -n "$TAG" ] || { log "no release found"; exit 1; }
# Fetch only this tag from ORNL: our fork carries an older, different v3.11.0, so a blanket
# --tags fetch is rejected ("would clobber existing tag").
git fetch -q --no-tags origin "+refs/heads/*:refs/remotes/origin/*" "refs/tags/$TAG:refs/tags/$TAG" \
  && git fetch -q my-fork || { log "git fetch failed"; exit 1; }
git rev-parse -q --verify "refs/tags/$TAG^{commit}" >/dev/null || { log "tag $TAG not fetched"; exit 1; }

if [ -z "$FORCE_TAG" ]; then
  if git merge-base --is-ancestor "refs/tags/$TAG" my-fork/ornl-3.11-rollin; then
    log "$TAG is already in ornl-3.11-rollin; nothing to do"; exit 0
  fi
  if grep -q "^$TAG " "$STATE_DIR/attempted" 2>/dev/null; then
    log "$TAG was already attempted ($(grep "^$TAG " "$STATE_DIR/attempted" | tail -1)); rerun with --force-tag"; exit 0
  fi
fi

RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)-$TAG
RUN_DIR=$LOG_ROOT/$RUN_ID
mkdir -p "$RUN_DIR"
exec > >(tee -a "$RUN_DIR/wrapper.log") 2>&1
log "new ORNL release $TAG; run dir $RUN_DIR (no-deploy=$NO_DEPLOY)"

finish() { # status, subject-suffix, body-file ; records the attempt and mails
  local status=$1 subj=$2 body=$3
  [ "$status" = skipped ] || printf '%s %s %s\n' "$TAG" "$status" "$RUN_ID" >>"$STATE_DIR/attempted"
  send_mail "[OSCAR nightly] $TAG: $subj" "$body" && log "emailed $EMAIL_TO ($status)" || log "EMAIL FAILED"
}

# 2. Preflight -----------------------------------------------------------------------------
skip_reason=""
pct=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$pct" -lt "$DISK_MAX_PCT" ] || skip_reason="disk is at ${pct}% (limit ${DISK_MAX_PCT}%); a build and rehearsal need ~10 GB"
[ -e "$MAINTENANCE_LOCK" ] && skip_reason="maintenance lock $MAINTENANCE_LOCK is present"
ls_before=$(live_status)
case $ls_before in healthy*) ;; *) [ -n "$skip_reason" ] || skip_reason="live is not healthy before starting ($ls_before)";; esac
# The nightly checkout belongs to this job alone: reset it to the fork's rollin tips, unless it
# holds commits that never reached the fork (a deploy whose push failed); those need a human.
unpushed=""
for p in . include/osh-core include/osh-oakridge-modules web/oscar-viewer; do
  n=$(git -C "$p" rev-list --count my-fork/ornl-3.11-rollin..ornl-3.11-rollin 2>/dev/null || echo 0)
  [ "$n" = 0 ] || unpushed="$unpushed $p($n)"
done
if [ -n "$unpushed" ]; then
  [ -n "$skip_reason" ] || skip_reason="the nightly checkout has commits that were never pushed to GitHub:$unpushed"
elif [ -z "$skip_reason" ]; then
  git merge --abort 2>/dev/null; git checkout -q -f ornl-3.11-rollin && git reset -q --hard my-fork/ornl-3.11-rollin
  git submodule update -q --init --force
  for p in include/osh-core include/osh-oakridge-modules web/oscar-viewer; do
    git -C "$p" merge --abort 2>/dev/null
    git -C "$p" checkout -q -f -B ornl-3.11-rollin my-fork/ornl-3.11-rollin
  done
  [ "$(git rev-parse HEAD)" = "$(git rev-parse my-fork/ornl-3.11-rollin)" ] || skip_reason="could not reset the nightly checkout"
fi
if [ -n "$skip_reason" ]; then
  log "skipping: $skip_reason"
  printf 'ORNL published %s, but tonight'"'"'s update was skipped and nothing was changed.\n\nReason: %s\n\nIt will try again tomorrow night.\nLog: %s\n' \
    "$TAG" "$skip_reason" "$RUN_DIR" >"$RUN_DIR/summary.md"
  finish skipped "skipped" "$RUN_DIR/summary.md"; exit 0
fi

# 3. Claude does the work ------------------------------------------------------------------
# shellcheck source=/dev/null
set -a; . "$CONF_DIR/claude.env"; set +a
unset ANTHROPIC_BASE_URL ANTHROPIC_API_KEY
PROMPT=$(cat <<EOF
You are running unattended as the OSCAR nightly upstream job. Nobody is watching; nobody can
answer questions. Follow the runbook below exactly.

Run parameters:
- RELEASE_TAG=$TAG
- RUN_DIR=$RUN_DIR   (write result.json and summary.md here; scratch files too)
- CHECKOUT=$CHECKOUT
- NO_DEPLOY=$NO_DEPLOY   (1 = stop after the rehearsal: push nothing, touch nothing on live)
- LIVE_BEFORE="$ls_before"

$(cat "$LIB_DIR/RUNBOOK.md")
EOF
)
log "starting claude (timeout $CLAUDE_TIMEOUT)"
timeout --kill-after=2m "$CLAUDE_TIMEOUT" claude -p "$PROMPT" \
  --output-format stream-json --verbose --max-turns 600 \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
  >"$RUN_DIR/claude.jsonl" 2>"$RUN_DIR/claude.stderr"
rc=$?
log "claude exited rc=$rc"

# 4. Report --------------------------------------------------------------------------------
status=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1])).get("status","error"))' "$RUN_DIR/result.json" 2>/dev/null || echo error)
[ -s "$RUN_DIR/summary.md" ] || printf 'The nightly job did not finish its own report (exit code %s%s).\n\nCheck the log in %s, or ask Claude to look at it.\n' \
  "$rc" "$([ "$rc" = 124 ] && echo ', it ran out of time')" "$RUN_DIR" >"$RUN_DIR/summary.md"
sleep 5
ls_after=$(live_status)
{
  cat "$RUN_DIR/summary.md"
  printf '\n----\nIndependent check by the wrapper after the run:\n  before: %s\n  after:  %s\n' "$ls_before" "$ls_after"
  printf 'Full log: %s on %s\n' "$RUN_DIR" "$(hostname)"
} >"$RUN_DIR/email.txt"

case $status in
  deployed)         subj="updated and live" ;;
  ready-no-deploy)  subj="tested, not deployed (dry run)" ;;
  rolled-back)      subj="deploy FAILED, rolled back" ;;
  stopped-conflict) subj="needs you: merge conflict, nothing changed" ;;
  tests-failed)     subj="needs you: tests failed, nothing changed" ;;
  *)                subj="needs you: job error ($status)" ;;
esac
case $ls_after in healthy*) ;; *) subj="LIVE UNHEALTHY - $subj" ;; esac
finish "$status" "$subj" "$RUN_DIR/email.txt"

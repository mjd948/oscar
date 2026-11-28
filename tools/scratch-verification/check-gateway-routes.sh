#!/usr/bin/env bash
# Read-only gateway and routing checks (ORNL's Step-3 checks, lifted out). Safe on live.
#   OSCAR_BASE=https://<host> PW_FILE=<admin password file> bash check-gateway-routes.sh
# Every viewer route exported by web/oscar-viewer is requested signed in and must return 200.
set -uo pipefail
BASE=${OSCAR_BASE:-https://localhost}; HOST=${BASE#https://}
PW=$(tr -d '\n' < "$PW_FILE"); fail=0
WEB=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../web/oscar-viewer/web" && pwd)
jar=$(mktemp); trap 'curl -sk -b "$jar" -o /dev/null "$BASE/logout"; rm -f "$jar"' EXIT
expect() { local want=$1 got=$2 what=$3; if [[ $got == "$want" ]]; then echo "PASS $what ($got)"; else echo "FAIL $what (got $got, want $want)"; fail=1; fi; }
code() { curl -sk -o /dev/null -w '%{http_code}' "$@"; }
expect 308 "$(code "http://$HOST/")" "HTTP redirects to HTTPS"
expect 200 "$(code "$BASE/healthz")" "/healthz"
expect 401 "$(code -H 'Accept: application/json' "$BASE/sensorhub/api/systems")" "anonymous ConSys API refused"
expect 200 "$(code "$BASE/login")" "sign-in page"
expect 200 "$(code -u "admin:$PW" "$BASE/sensorhub/api/systems?limit=1")" "ConSys API with Basic"
# Sign in through the login form, as operators do. Since 3.12.2 a Basic request within 30 s of an
# earlier one for the same user is served from ORNL's verified-credential cache without minting a
# session cookie, so a Basic request is no reliable way to get one.
expect 302 "$(code -c "$jar" --data-urlencode username=admin --data-urlencode "password=$PW" "$BASE/login")" "form sign-in"
expect 200 "$(code -b "$jar" "$BASE/sensorhub/api/systems?limit=1")" "ConSys API with the session cookie"
expect 200 "$(code -b "$jar" "$BASE/sensorhub/session")" "session API under /sensorhub"
expect 200 "$(code -b "$jar" "$BASE/session")" "session API at the root"
expect 200 "$(code -b "$jar" -L "$BASE/sensorhub/admin")" "admin console"
expect 200 "$(code -b "$jar" "$BASE/sensorhub/test")" "servlet test endpoint"
for d in $(cd "$WEB" && find . -name index.html -printf '%h\n' | sed 's#^\.$#/#; s#^\./#/#' | sort); do
  expect 200 "$(code -b "$jar" "$BASE${d%/}/")" "viewer route $d"
done
exit $fail

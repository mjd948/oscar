# Scratch-instance verification (OSCAR 3.11)

Scripts used on 2026-11-17 to verify the `ornl-3.11-rollin` branches end to end on a
throwaway Docker stack beside the live node. Results are recorded in `ROLL_IN_TRIAGE.md`
("Scratch verification").

**Test deployments only.** The checks stop simulators, cut camera feeds inside the OSCAR
container's network namespace, and send a Code 9 adjudication. Adjudications are permanent.

## Stand up the stack

```bash
./gradlew build -x test -x osgi                        # after `npm run build` in web/oscar-viewer
mkdir -p /opt/oscar-scratch && unzip -q build/distributions/oscar-3.11.0.zip -d /opt/oscar-scratch
cd /opt/oscar-scratch/oscar-3.11.0
OSCAR_SETUP_ADMIN_PASSWORD='<password>' bash oscar.sh init --non-interactive \
  --hostname oscar-scratch.local --port 443 --timezone UTC --tls-san 127.0.0.1 --tls-san localhost \
  --skip-hosts-entry --skip-start --backup-mode disabled --prerequisites existing
# set OSCAR_JAVA_OPTS in .env to a heap that fits beside anything else on the host, then
bash oscar.sh start
```

Use port 443. ORNL's gateway forwards `Host: $host` without the port, so on any other port the
backend's trailing-slash redirects (`/event-log` → `/event-log/`) point at 443 and the viewer
routes fail.

The Compose project name (`oscar`), the volume names and port 80 are fixed by ORNL's scripts:
one scratch stack per host, and only on a host whose live node is not itself a Compose
deployment.

## Lanes and simulators

```bash
tools/scratch-verification/mockctl.sh start rapiscan10100   # also: rapiscan10101 rs350 d5
docker cp oscar-oscar-1:/var/lib/oscar/config.json config.json
python3 -I tools/scratch-verification/seed-scratch-lanes.py config.json config.new.json
# stop the oscar container, copy config.new.json over /var/lib/oscar/config.json as uid 10001
# (mode 600) with a one-shot container on the oscar_oscar_state volume, then start it again
```

`mockctl.sh` records each simulator's own PID (`exec` in the backgrounded subshell). Without
that, `stop` kills the wrapper shell and the simulator keeps serving, which is exactly what an
outage test must not do.

## Checks (Playwright)

Run from a directory with `playwright` installed (`npm i playwright && npx playwright install chromium`).
All read the admin password from `PW_FILE`; `OSCAR_BASE` defaults to `https://oscar-scratch.local`.

| script | env | what it proves |
|---|---|---|
| `check-outage.mjs` | `MOCK`, `LANE`, `DOWN_S`, `MOCKCTL` | the lane chip goes offline while its simulator is down and returns without a module restart |
| `check-map.mjs` | `SHOT` | walker markers present and moving, alarm markers present, the map does not re-centre |
| `check-alarm-clear.mjs` | `OBS`, `CS` | the alarm popup links to the event, and a Code 9 adjudication clears the marker |
| `check-video.mjs` | `CPID` (oscar container PID), `LANE`, `RTSP_PORT` | live HLS plays, survives a 45 s RTSP cut in the container's netns, and resumes unattended |
| `check-dashboards.mjs` | `MODE` (`capture` on an old viewer, `check`), `OUT` / `SEED` | ORNL's `/dashboards` renders, home is ORNL's Dashboard, and a browser seeded with dashboards saved by our pre-3.12 viewer loads with no page errors. Our own widget-dashboard checks were retired on 2026-11-28 with the move to ORNL's dashboards |
| `check-event-log-paging.mjs` | - | read-only, safe on live: the Event Log's Newest-first toggle flips, ORNL's offset CQL probe (`gammaAlarm=true AND neutronAlarm=false`, `offset=45`) returns 200, paging forward and back shows the same rows (visited pages come from the 3.11.11 cache), and no `/sensorhub/api/observations` request returns 5xx |

Two more checks run without a browser (same `OSCAR_BASE` and `PW_FILE`):

| script | what it proves |
|---|---|
| `check-user-onboarding.py` (`python3 -I`) | safe on live, cleans up after itself: a throwaway account (`PROBE_USER`, default `zzprobe`) can get in with every credential the Users page shows. The creation invite, the row's QR & Invite and the Reset password invite open `/login/enroll` (200, never consumed), an older invite is revoked (410), the reset temporary password signs in typed in any letter case, and a case-only duplicate account is refused. Before the 2026-11-24 fix every `/sensorhub/session` call ran twice, so the row invite and reset password were dead when shown |
| `check-gateway-routes.sh` | read-only, safe on live: ORNL's Step-3 checks. HTTP→HTTPS 308, `/healthz`, anonymous API 401, ConSys with Basic and with the session cookie, the session API under `/sensorhub` and at the root, the admin console, and every viewer route exported in `web/oscar-viewer/web` |

**Checking a viewer build against a running node without deploying it:** `verify-proxy.mjs` serves
`web/oscar-viewer/web` (after `npm run build`) on `https://localhost:9443` and passes sign-in, API,
MQTT and video through to the node's gateway (default `127.0.0.1:443`), so the checks above run on
the new UI with the node's real lanes and cameras. Usage is in the script's header. Page layouts
stay in the test browser's own storage, so the node is untouched. A first app load in a fresh
browser clears saved state once (`oscar_credentials_migrated_v1` in `Store.tsx`), so seed
`persist:root` after that first load, not before.

ORNL's own `tools/test-live-deployment-regression.sh` is CI-only: it stops apache/nginx and
deletes `/opt/oscar-ci-regression` on exit. Its Step-3 checks (gateway, ConSys auth, viewer
routes, admin) can be lifted out and pointed at `oscar-scratch.local`. Chromium needs
`--host-resolver-rules=MAP oscar-scratch.local 127.0.0.1` for `.local` names.

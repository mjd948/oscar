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
| `check-custom-pages.mjs` | - | ORNL's dashboard untouched; custom pages from the Dashboard and Lane View templates render every widget, persist across reload, two maps share a page, video/chart follow the page lane |
| `check-column-prefs.mjs` | - | an event-table widget's hidden column and dragged width survive a reload, and do not leak into ORNL's `/event-log` |

ORNL's own `tools/test-live-deployment-regression.sh` is CI-only: it stops apache/nginx and
deletes `/opt/oscar-ci-regression` on exit. Its Step-3 checks (gateway, ConSys auth, viewer
routes, admin) can be lifted out and pointed at `oscar-scratch.local`. Chromium needs
`--host-resolver-rules=MAP oscar-scratch.local 127.0.0.1` for `.local` names.

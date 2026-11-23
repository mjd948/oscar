# Live node upgrade: OSCAR 3.5.0 → 3.11 (our `ornl-3.11-rollin` build)

Drafted 2026-11-17, rehearsed and **executed the same day** (see "Cutover results" at the end).
The live node is now OSCAR 3.11 at `/opt/oscar/oscar-3.11.0`; 3.5 is stopped and kept for rollback.

## Where we start

| | live node today |
|---|---|
| install | `/opt/oscar/oscar-3.5.0`, native Java (`oscar.service` → `launch-all.sh`), not Docker Compose |
| database | separate container `oscar-postgis-container` (PostgreSQL 16.4 / PostGIS), bind-mounted `pgdata` = **22 GB**, 18.4 M observations from 2026-07-12 onward (older history was lost in the July purge incident) |
| files | `osh-node-oscar/files` = 5 GB (clips, daily files, OCR crops, reports, adjudication uploads, site map) |
| access | plain HTTP on `:8282` (no TLS), MQTT 1883 and 8083 exposed, Cloudflare tunnel (token-managed, target set in the Cloudflare dashboard), anonymous user enabled |
| lanes | Marshall, AFM Gate, Selfridge, Memorial Ave (Rapiscan + one RTSP camera each, OCR on) and Patrol 1 (RS-350 mobile); all point at the site simulator 10.235.20.94 |
| host | 8 GB RAM (live JVM `-Xmx6g`, swap fully used), **20 GB free disk** of 98 GB, UTC, LAN 10.235.20.56, hostname `OSCAR-3-3-6.anthracitered.com` |
| also on the host | the 3.11 **scratch stack** (`/opt/oscar-scratch`), which owns the Compose project name `oscar`, the volumes `oscar_oscar_state`/`oscar_postgres_data` and ports 443/80. ORNL hard-codes all of those, so **one 3.11 deployment per host**: the scratch stack must be removed before the live one is created |

## What ORNL supports, and what that means here

- `oscar.sh upgrade` only upgrades an existing **Docker Compose** 3.x deployment. The live node is
  not one, so there is no supported in-place path.
- Even for Docker deployments, ORNL's guidance for 3.11 is: **initialize production with a fresh
  3.11 database and configuration** (new tiered Parquet archive, data checksums, new write path),
  keep pre-3.11 history read-only behind a verified backup, and design any history migration
  separately (DEPLOYMENT.md "3.11.0 storage migration boundary").

So this is a **rebuild with configuration carried over**, not an upgrade:
fresh `oscar.sh init` from our release zip, the lanes/cameras/settings re-created from the live
`config.json`, and the 3.5 data kept as a verified dump (and in place until sign-off) rather than
imported.

## Decisions needed before scheduling

1. **History.** The 3.5 observations (sim data since 12 July) will not be visible in 3.11. Options:
   **(a)** keep a verified `pg_dump` + the 3.5 directory, nothing browsable *(recommended)*;
   (b) additionally keep 3.5 startable on demand for look-ups (only with 3.11 stopped: two JVMs do
   not fit in 8 GB); (c) a custom history import, which ORNL explicitly does not provide (days of work).
2. **Address.** 3.11 serves only HTTPS (443, with 80 → HTTPS) through its gateway with a
   self-signed certificate (or an imported one). Pick the hostname clients will use
   (`OSCAR-3-3-6.anthracitered.com`? `oscar.local`?), whether to import a real certificate, and
   confirm 443 instead of `:8282` is acceptable. **Port 443 is required in practice:** ORNL's
   gateway drops non-443 ports from redirects (found on the scratch run).
3. **Cloudflare tunnel.** Its target lives in the Cloudflare dashboard. At cutover it must change
   from (probably) `http://localhost:8282` to `https://localhost:443` with *No TLS Verify* (or the
   origin server name set to the certificate's hostname). Only you can make that change.
4. **MQTT/WebSocket ports 1883/8083.** 3.11 does not publish them; MQTT reaches the viewer through
   the gateway only. No connections were open when checked; confirm nothing external subscribes.
5. **Accounts.** 3.11 has no anonymous access: everyone signs in (session login). `init` sets a new
   admin password; decide which operator accounts to create afterwards (live has only `admin`).
6. **Video retention.** Live keeps full clips 7 days, then decimates to 5 frames.
   3.11 defaults to `timeToRetention: 0` (5 JPEG frames retained as soon as the event closes, plus
   storage-pressure deletion at 85 % disk). Keep 7 days or take ORNL's default?
7. **OCR.** 3.11 adds `alarmsOnly` (default `true`). Live reads every occupancy. Keep reading all, or
   alarms only?
8. **Backups.** `--backup-mode single` needs a backup directory with room for a full snapshot; on
   this one disk that protects against software faults only. Choose `single` to a separate disk/share,
   or `disabled`.
9. **Window.** About 45 minutes of downtime for the cutover itself; more if the rehearsal finds
   anything.

## Phase 1: preparation (no downtime)

1. **Freeze a release.** Tag the parent `ornl-3.11-rollin` (e.g. `v3.11.0-mjd948.1`) after the last
   merge, `npm run build` the viewer, `./gradlew build -x test -x osgi`, keep the zip
   (`build/distributions/oscar-3.11.0.zip`) and its SHA-256.
2. **Config migration script** (`tools/live-upgrade/migrate-config.py`, unit tests alongside). It
   reads the live `config.json` and writes only lane and service settings into a **fresh 3.11
   `config.json`**:
   - lanes keep `name`, `uniqueID` (NSDD1–4, PATROL1, so system UIDs stay the same), `location`,
     `laneOptionsConfig` (RPM host/port, EML), `ocrConfig` (drops `plateAutofillConfidence`, sets
     `alarmsOnly` per decision 7); `subsystems` are left empty so LaneSystem rebuilds its members;
   - **cameras converted**: `remoteHost: "10.235.20.94"` + `streamPath: ":9001/cam1"` →
     `remoteHost: "10.235.20.94:9001"` + `streamPath: "/cam1"` (all four live cameras use the 3.5
     form, which 3.11 turns into `rtsp://10.235.20.94/:9001/cam1` and never connects);
   - asserts lane names are 12 characters or fewer (3.11 refuses longer ones; all five pass);
   - Patrol 1 stays a `MobileDetectorConfig`; the `MobileDetectorConfigForm` admin form is already in
     our standard config;
   - OSCAR service: `webIdApiRoot`, `statsFrequencyMinutes`, video retention per decision 6. Nothing
     else from the 3.5 module list is copied (3.11's database, journal, bucket and MQTT modules
     replace them).
3. **Rehearse on the scratch stack.** Re-init the scratch stack from the frozen zip, apply the
   migrated config with the RPM and RTSP hosts rewritten to the local mocks (never the site
   simulator, which the live node is connected to), and run every check in
   `tools/scratch-verification` plus ORNL's Step-3 live-deployment checks. Time each step.
4. **Viewer layouts.** Anyone with custom pages or layouts in the current viewer exports them
   (Import / Export → Export all pages). 3.11 runs on a new origin (HTTPS) and ORNL clears old
   persisted state once anyway; the export imports into 3.11 (schema v3 converts old seeded pages
   into custom pages).
5. **Disk.** The dump needs room: free space now is 20 GB. Remove the scratch stack's volumes and
   images after the rehearsal (step 3.1 below does this anyway), and the 3.5 `.bak` jars and stale
   config backups can go.

## Phase 2: backup (live keeps running)

1. `docker exec oscar-postgis-container pg_dump -U postgres -Fc -d gis > /srv/oscar-3.5-archive/gis-<date>.dump`
   (consistent online snapshot), then `pg_restore --list` it to verify it is readable, and record its
   size and SHA-256.
2. `tar` the 3.5 `osh-node-oscar` directory without `files/videos` (config, keystores, daily files,
   OCR crops, reports, adjudication uploads, site map) to the same place. Clips stay in place until
   sign-off.
3. Note the current state for the acceptance comparison: lanes online, last occupancy per lane,
   cameras streaming.

## Phase 3: cutover (downtime starts)

1. **Remove the rehearsal stack** (now at `/opt/oscar-rehearsal`): `oscar.sh stop`, then
   `docker compose -p oscar --env-file .env -f compose.yaml down --remove-orphans`,
   `docker volume rm oscar_oscar_state oscar_postgres_data`, stop the simulators
   (`tools/scratch-verification/mockctl.sh stop …`), delete the directory, and remove its `/etc/hosts`
   line. 7 s in rehearsal.
2. **Stop 3.5**: `systemctl stop oscar && systemctl disable oscar`, then `docker stop oscar-postgis-container`.
   Nothing is deleted: `pgdata`, the container and `/opt/oscar/oscar-3.5.0` stay for rollback.
3. **Install 3.11**: unzip the frozen release to `/opt/oscar/oscar-3.11.0`, then run
   `OSCAR_SETUP_ADMIN_PASSWORD=… bash oscar.sh init --non-interactive --hostname <decision 2> --port 443 --timezone UTC --tls-san 10.235.20.56 --skip-hosts-entry --skip-start --backup-mode <decision 8> …`
   (add `--certificate/--private-key` if importing a real certificate). In `.env`, set
   `OSCAR_JAVA_OPTS` to about `-Xms1g -Xmx4g`: 6 GB plus PostgreSQL's 512 MB of shared buffers and the
   gateway does not fit this 8 GB host.
4. `bash oscar.sh start` once so 3.11 writes its standard config. Copy it out with
   `docker cp oscar-oscar-1:/var/lib/oscar/config.json fresh.json`, then run
   `migrate-config.py --live <3.5 config.json> --fresh fresh.json --out config.json` (no host
   rewrites on the real cutover). Stop the oscar container, copy `config.json` into the
   `oscar_oscar_state` volume with a one-shot container (`--user 10001:10001`, mode 600; stage the
   file in a directory Docker can read), and start it again. Wait for `healthy`. If it sticks at
   `starting`, check for ORNL's bucket-service race ("Could not find this OSH node's Bucket
   Service"); one restart clears it.
5. Smoke check from the host: `/healthz`, sign in, all five lanes under Sensors in the admin UI.
   No admin-UI Save is needed: the lanes are in `config.json` already, and a restart reloads them
   (rehearsed).

## Phase 4: acceptance (on the live node)

`tools/live-upgrade/acceptance.mjs` automates the read-only part (lanes and cameras online, no
portal faults on the walker, every camera plays, the walker moves, no page errors):
`OSCAR_BASE=https://<host> PW_FILE=… node acceptance.mjs`.

- ORNL's Step-3 checks against the live hostname: TLS gateway, 401 for anonymous, ConSys systems
  and datastreams, all eight viewer routes, admin UI (`tools/scratch-verification` README).
- Dashboard: five lane cards online. Patrol 1 shows no portal-fault icons. Occupancies arrive from
  the site simulator, and the alarm table and sound work.
- Each of the four cameras plays in Lane View. OCR results appear on new events.
- Map: Patrol 1's walker marker moves. Its unadjudicated alarms show, and one test adjudication
  clears its marker. **Use Code 9 (test)**: adjudications are permanent.
- `oscar.sh archive status` / `archive verify`; `oscar.sh backup` + `backup-verify` if enabled.
- Restart the oscar container once and confirm all five lanes come back (the config persisted).

## Phase 5: repoint access

- Cloudflare tunnel target (decision 3), bookmarks/kiosks to the new HTTPS URL, and the TLS
  certificate (`tls/server.crt`) installed on every client workstation unless a real certificate
  was imported.
- Create operator accounts (decision 5).
- Import exported viewer pages (Phase 1.4).

## Phase 6: retire 3.5 (after a sign-off period, e.g. 7 days)

- Keep the verified dump and tarball (decision 1); then delete `/opt/oscar/oscar-3.5.0/pgdata`
  (+22 GB), `files/videos`, the `oscar-postgis-container` container and the `oscar-postgis:latest`
  image, and the `oscar.service` unit.
- Update memory/docs: the live node is a Compose deployment at `/opt/oscar/oscar-3.11.0`;
  `deploy-oscar-viewer` no longer applies (the viewer is inside the `oscar:3.11.0` image; updates
  are new releases through `oscar.sh upgrade`).

## Rollback (any time before Phase 6)

`bash /opt/oscar/oscar-3.11.0/oscar.sh stop` → `docker start oscar-postgis-container` →
`systemctl enable --now oscar`. 3.5 comes back on `:8282` with its database exactly as it was at
cutover; 3.11's ports (443/80) and volumes do not collide with it. Revert the Cloudflare target.
Data recorded by 3.11 in the meantime stays in its volumes and is not visible to 3.5.

## Known 3.11 behaviours to expect (from the scratch run)

- RS-350 WebID can fail to attach at startup (ORNL race); a restart of that lane re-attaches it.
- Portal RPMs no longer give up after about 2 minutes offline (our lane recovery supervisor), and
  the D5 driver now reconnects too.
- Live video retries on its own after a camera drop.
- Mobile GPS (`location`) is not in ORNL's Parquet allowlist, so it stays in hot PostGIS. That is
  fine at this scale.

## Rehearsal results (2026-11-17, on this host, live node running alongside)

Release: parent `4b65507`, modules `3fe11ea8`, viewer `44ee7b1`; `oscar-3.11.0.zip` SHA-256
`c7ead736d5181956…`. Installed at `/opt/oscar-rehearsal/oscar-3.11.0` as `oscar-rehearsal.local:443`,
`-Xmx4g`, backups disabled. Input was a copy of the **live** `config.json`; RPM endpoints were rewritten to
local simulators on the live ports (10100–10103, 10110); cameras stayed on the shared RTSP box.

| step | result | time |
|---|---|---|
| 3.1 remove the previous 3.11 stack | done; live node unaffected (HTTP 200 throughout) | 7 s |
| 3.3 unzip + `init` | done (Docker build layers cached; a cold image build takes several minutes more) | 5 s + 26 s |
| 3.4 first start | healthy | 46 s |
| 3.4 migrate config | 5 lanes, 4 cameras converted, OCR `plateAutofillConfidence` dropped, service settings + 7-day retention carried | <1 s |
| 3.4 apply + start | healthy; only warning is ORNL's RS-350 WebID startup race | 27 s |
| 4 ORNL Step-3 checks | pass (TLS gateway, 401 anonymous, ConSys, 8 viewer routes, admin) | ~1 min |
| 4 `acceptance.mjs` | pass: 4 portal lanes and cameras online, every camera plays in Lane View, Patrol 1 online with no portal faults and moving on the map, no page errors | ~2 min |
| 4 data | occupancies on all four portal lanes; OCR results on each, including non-alarm vehicles (all-occupancies setting works) | after ~6 min |
| 4 archive status / verify | pass | |
| 4 restart persistence | `oscar.sh restart` → healthy in 54 s, five lanes in `config.json`, acceptance passes again | 54 s |

**Measured machine time for Phase 3 is under 3 minutes**; a 30-minute window leaves room for the human
steps (Cloudflare, certificates, sign-off). With both JVMs running (3.5 at 6 GB, 3.11 at 4 GB) the
host held up for the rehearsal, but run them together only briefly.

Not rehearsed: the `pg_dump` of the live database (Phase 2 reads the live node; size and duration
unknown, expect a few GB compressed from the 22 GB cluster); the Cloudflare change; importing a real
certificate; `--backup-mode single`; a cold Docker image build; Patrol 1 alarm occupancies (the
simulated walker had not reached a hotspot; covered earlier on the scratch stack).


## Cutover results (2026-11-17, executed)

Decisions taken (plan defaults): **1** (a) verified dump + 3.5 directory kept, no history import;
**2** `https://oscar-3-3-6.anthracitered.com` on 443, self-signed, SANs `10.235.20.56` and
`OSCAR-3-3-6`; **4** no MQTT clients were connected to 1883/8083, so they were dropped;
**5** `admin` only (password in `/root/oscar-3.11-admin-password.txt`, mode 600); **6** 7-day
video retention; **7** OCR on every occupancy; **8** backups disabled (single disk).
**3 (Cloudflare) is still to do**, along with Phase 5 client steps.

| step | result | time (UTC) |
|---|---|---|
| 1.1 release | parent tag `v3.11.0-mjd948.1` (81caa36), zip SHA-256 `c7ead736…` | |
| 3.1 rehearsal stack removed | done before the backup, to free disk | 12:14 |
| 2 backup | `/srv/oscar-3.5-archive/`: `gis-2026-11-17.dump` 642 MB in 2 min 31 s (`pg_restore --list` reads 16 tables incl. `obs`), node tarball 568 MB, `config-3.5.json`, `SHA256SUMS` | 12:15–12:18 |
| 3.3 unzip + init | done while 3.5 still ran (init binds no ports); heap `-Xmx4g` with ORNL's other JVM flags kept | 14 s |
| 3.4 first start | healthy, standard config | 53 s |
| 3.4 migrate | 5 lanes, 4 cameras converted, 7-day retention, OCR all occupancies | <1 s |
| **downtime start** | `oscar` disabled and stopped, `oscar-postgis-container` stopped (restart policy set to `no`) | 12:19:59 |
| 3.4 apply + start | the first copy failed (staging dir not readable by uid 10001), redone with a 10001-owned dir | |
| 3.4 health | **unhealthy**: see the readiness defect below. The gateway served throughout (401 for anonymous) | 12:23 |
| hotfix | modules `a3325cfd`, overlay image (`overlay/Dockerfile`, base tagged `oscar:3.11.0-mjd948.1`), `oscar.sh restart` → healthy, ready marker present | 12:30:43 |
| 4 `acceptance.mjs` (portal lanes) | pass: 4 RPMs and cameras online, video plays in every Lane View, no page errors | |
| 4 ORNL Step-3 checks | pass (308 redirect, TLS `/healthz` and headers, 401 anonymous, ConSys systems and datastreams, 8 viewer routes, admin UI) | |
| 4 data | occupancies and `vehicleOcr` results on all four portal lanes within minutes | |
| 4 archive status / verify | pass (empty archive, as expected on a fresh deployment) | |

**Downtime:** about 10 minutes of a usable but unhealthy node (12:20–12:30), all of it the
readiness defect; under 1 minute otherwise.

**Readiness defect found at cutover.** The site simulator's RS-350 (10.235.20.94:10110) and D5
(10111) were not listening. Our RPM recovery supervisor restarts the failed RS-350, and each
attempt holds it in `STARTING` for the driver's whole connection loop (about 100 s); ORNL's
`ApplicationReadiness` read that as a start in flight and withdrew `/tmp/oscar-ready`, so one
unreachable detector kept the node unhealthy and `oscar.sh start` failed. Fixed in modules
`b5547e82` (merged as `a3325cfd`): the supervisor reports recovery, `LaneSystem` exposes it through
`IAutoStartDispatchStatus.isMemberUnderRecovery`, and readiness treats such a member as settled.
Tests: `RpmRecoverySupervisorTest` (7), `ApplicationReadinessTest` (11). The rehearsal missed it
because every simulator was up; the next release zip must include it (the live image is the
`.1` image plus this overlay).

**After cutover (same day):** the viewer's Video Stream widget showed ORNL's fixed 500 px player
inside a shorter frame (black, scroll to see the picture). Fixed in viewer `0d7ab80` (merged as
`90e6182`): opt-in `fillHeight` on `VideoMedia`/`HLSVideoComponent`, set by the widget; Lane View
keeps 500 px. Deployed in the same overlay image (the viewer `web/` replaced, ORNL's
`video-guides` kept); `check-video-fit.mjs` passes on the live node.

**Still open:** Patrol 1 is offline until the site's RS-350 simulator is back (it will reconnect
by itself); Cloudflare tunnel target (decision 3); client certificate trust and bookmarks; viewer
page imports; Phase 6 retirement after sign-off.

## Update to 3.11.10 (ORNL merge): plan and rehearsal (2026-11-23)

The live node is now a Compose deployment, so this is ORNL's supported **clean sibling-directory
upgrade** (`oscar.sh upgrade`), not a rebuild: same volumes, data and accounts kept.

### Rehearsal

Release: parent `50a83b1` (modules `92f519f6`, viewer `bd8581d`), `oscar-3.11.10.zip` SHA-256
`fff276c4b41fbc1d…`. ORNL's compose hard-codes the project name, external volume names and port 80,
so a second stack cannot share the live Docker daemon: the rehearsal ran in a privileged
Docker-in-Docker container (`docker:27-dind`, capped at 3.5 GB, 172.17.0.2 as
`oscar-rehearsal.local`) with ORNL's scripts unmodified. It started from an exact copy of live:
the `v3.11.0-mjd948.1` zip (`c7ead736…`) plus the live overlay image, and the live `config.json`
(accounts included) with only the five RPM endpoints pointed at local simulators.

| step | result | time |
|---|---|---|
| baseline on the live copy | acceptance passes (5 lanes, cameras, video, Patrol 1 moving), occupancies recorded | |
| extract 3.11.10 beside, copy `.env`/`secrets/`/`tls/`, add `OSCAR_GUI_UPDATE=disabled` | volumes already labelled; no adoption needed | <1 min |
| `oscar.sh upgrade` | images built, containers recreated from the new dir, healthy | **81 s** |
| first run of ORNL's endpoint sync on the old config | 5 lanes intact; sync markers persisted | |
| `acceptance.mjs` | pass, incl. Patrol 1 | |
| ORNL 3.11.10 Step-3 checks | pass | |
| `check-custom-pages`, `check-video-fit` | pass | |
| history | all pre-upgrade occupancies present, new ones arriving | |
| archive status / verify | pass | |
| `oscar.sh restart` | healthy | 53 s |
| System Update page | `guiUpdateEnabled: false`, version 3.11.10, no host agent installed | |
| **rollback**: `stop` in 3.11.10, `start` in 3.11.0 | healthy on the migrated volumes, acceptance passes, data intact | 5 s + 48 s |
| upgrade again (idempotent) | healthy, acceptance passes | 58 s |

Harness fix: 3.11.10's login page adds "Sign in with a passkey", so the sign-in button locator is
now exact.

### Found during the rehearsal: live disk pressure (action needed)

ORNL's storage-pressure retention deletes media when the disk passes **85%** until it is back at
80%. The live disk crossed 85% on **2026-11-20**; since then the live node has run 1,813 cleanups,
deleting **OCR evidence crops only** (1,200 at first, then each new crop shortly after it was
written). No clips or events were deleted ("inspecting 0 media sets" throughout). The rehearsal
pushed the disk to 94%; pruning Docker build caches and the dropped packaging's builder images
(Wine/Electron, InnoSetup, RockyLinux; re-downloadable) brought it to 79%, under the threshold.
The lasting fix is Phase 6: the retired 3.5 data is 22 GB `pgdata` + 5 GB `files` (the verified
dump and tarball in `/srv/oscar-3.5-archive` stay).

### Live procedure

1. Disk well under 85% (Phase 6 retirement of 3.5 data recommended first).
2. `unzip oscar-3.11.10.zip -d /opt/oscar/`; copy `.env`, `secrets/`, `tls/` from `oscar-3.11.0`;
   append `OSCAR_GUI_UPDATE=disabled` (keeps ORNL's GitHub updater from replacing this fork build).
3. `cd /opt/oscar/oscar-3.11.10 && bash oscar.sh upgrade`; the image build happens before the stop,
   so downtime is about a minute, plus up to ~100 s if a detector is offline (readiness waits out
   its first connection loop).
4. `acceptance.mjs`, ORNL Step-3 checks, `check-video-fit.mjs` against the live hostname.
5. Rollback: `bash oscar.sh stop` in `oscar-3.11.10`, `bash oscar.sh start` in `oscar-3.11.0`
   (rehearsed). Keep `oscar-3.11.0` until sign-off.

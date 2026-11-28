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

### Executed on the live node (2026-11-23)

1. **3.5 retired (Phase 6):** `oscar-postgis-container`, the `oscar-postgis:latest` image, the
   `oscar.service` unit and `/opt/oscar/oscar-3.5.0` (22 GB `pgdata`, 5 GB files) deleted; the
   verified dump, tarball and config in `/srv/oscar-3.5-archive` re-checked against `SHA256SUMS`
   first and kept. Disk 79% → **44%**.
2. **Upgrade:** `/opt/oscar/oscar-3.11.10` from `oscar-3.11.10.zip` (`fff276c4…`), `.env` identical
   to 3.11.0 plus `OSCAR_GUI_UPDATE=disabled`; `oscar.sh upgrade` 23:11:51–23:15:24 UTC (3 min 33 s,
   image build while 3.11.0 served; downtime about 2.5 min, longer than rehearsed because readiness
   waited out Patrol 1's unreachable RS-350 at the site simulator).
3. **Checks (no sign-in):** `/healthz` ok, 308 to HTTPS, anonymous API 401, login page 200, tunnel
   host header 200; all containers from the new directory (`oscar:3.11.10`, `oscar-postgis:3.11.10`,
   nginx 1.30.7); all four portal lanes, RPMs and cameras started; archive verify passes, 2,880,279
   archived observations in 930 objects unchanged; hot rows 3,685 → 5,004 (new data arriving); OCR
   completed on a new occupancy; no storage-pressure activity.
4. **Signed-in checks (run afterwards):** `acceptance.mjs` (four portal lanes and cameras online,
   video plays in every Lane View, no page errors; Patrol 1 skipped, its detector is down at the
   site), `check-video-fit.mjs` and ORNL's 3.11.10 Step-3 checks all pass. The admin password is
   unchanged (`/root/oscar-3.11-admin-password.txt`); one API probe returned 401 before the upgrade,
   but form and basic sign-in both work with it.

Rollback until sign-off: `bash oscar.sh stop` in `/opt/oscar/oscar-3.11.10`, then
`bash oscar.sh start` in `/opt/oscar/oscar-3.11.0` (rehearsed; its `oscar:3.11.0` overlay image is
kept). 3.5 is no longer a rollback target.

## Widgets for every ORNL view: live deployment (2026-11-24)

Viewer `f3bb4d9` (parent `v3.11.10-mjd948.2`), backend modules unchanged; zip SHA-256 `c56e150c…`.
Same-version update, so the release went to a uniquely named sibling directory
`/opt/oscar/oscar-3.11.10-mjd948.2` (`.env`, `secrets/`, `tls/` copied; `.env` identical), and the
images it replaces were tagged first as `oscar:3.11.10-mjd948.1` / `oscar-postgis:3.11.10-mjd948.1`.
`oscar.sh upgrade` 00:14:12–00:17:34 UTC, downtime about 2.5 min (Patrol 1's RS-350 still offline
at the site, so readiness waits out its first connection loop).

Checks on live: `check-view-widgets.mjs` (`RS350_LANE=""`, Patrol 1 offline; spectra verified in
the rehearsal against the simulator), `check-custom-pages`, `check-video-fit`, `acceptance.mjs`
and ORNL Step-3, all pass. The Event Details widget showed a live Memorial Ave alarm with chart,
video, occupancy overview and daily file. Its OCR crop (2026-11-23) returned 404: crops from
2026-11-20 to the 2026-11-23 disk fix were removed by storage-pressure cleanup (none left for
20–22 Nov, 69 for 23 Nov); crops since the fix are kept.

Rollback: `bash oscar.sh stop` in `oscar-3.11.10-mjd948.2`, `docker tag oscar:3.11.10-mjd948.1
oscar:3.11.10 && docker tag oscar-postgis:3.11.10-mjd948.1 oscar-postgis:3.11.10`, then
`bash oscar.sh start` in `/opt/oscar/oscar-3.11.10`.

## Editable main pages: live deployment (2026-11-24)

ORNL's main sidebar pages (Dashboard, Events, State of Health, Map, National, Report Generator,
Alarm Transfer, and Lane View, which has an RS-350 variant) now open built-in editable widget pages.
A sidebar switch "Editable main pages" (per browser, default on) goes back to ORNL's originals.
Viewer `8aef021`, parent tag `v3.11.10-mjd948.3`, zip SHA-256 `fda91160…`. Release dir
`/opt/oscar/oscar-3.11.10-mjd948.3`; the replaced images were tagged `oscar:3.11.10-mjd948.2` /
`oscar-postgis:3.11.10-mjd948.2` first. `oscar.sh upgrade` 01:20:02–01:23:33 UTC (downtime about
2.5 min; Patrol 1 offline at the site).

Rehearsed in dind with the live config and simulators: `check-main-pages` (all sidebar entries,
typed ORNL addresses, lane click, RS-350 swap with Patrol 1 spectra, edits survive reload, Reset,
no Delete, switch off and on), `check-view-widgets`, `check-custom-pages`, `check-column-prefs`,
`check-video-fit`, `acceptance`: all pass, after fixing a real bug the rehearsal found (Reset
dropped a main page's marker). On live, the same checks pass (`RS350_LANE=""`).

Rollback: `bash oscar.sh stop` in `oscar-3.11.10-mjd948.3`, re-tag `oscar:3.11.10-mjd948.2` and
`oscar-postgis:3.11.10-mjd948.2` as `:3.11.10`, `bash oscar.sh start` in
`/opt/oscar/oscar-3.11.10-mjd948.2`. Without a rollback, the switch alone restores ORNL's pages for
anyone who wants them.

## One sidebar list of widget dashboards: live deployment (2026-11-24)

The sidebar has two sections: every widget dashboard (the built-in ones first, the user's after,
Add last) and the fixed settings pages. Built-in dashboards can be renamed and deleted (with a
confirmation); the "Editable main pages" switch is gone. Dashboards open at
`/dashboard/?name=<slug>`; old `/custom-page/?id=` links redirect. A deleted built-in's ORNL route
(a lane click, an alarm notification) opens ORNL's original page until a dashboard made from the
same layout takes it back; home falls back to the first dashboard. Saved layouts migrate to schema 4.

Viewer `068bddc`, parent tag `v3.11.10-mjd948.4` (`26e855a`), zip `oscar-3.11.10-mjd948.4.zip`
SHA-256 `2244c971…`. Release dir `/opt/oscar/oscar-3.11.10-mjd948.4` (`.env` identical, `secrets/`
and `tls/` copied); the replaced images were tagged `oscar:3.11.10-mjd948.3` /
`oscar-postgis:3.11.10-mjd948.3` first. `oscar.sh upgrade` 13:57:58–14:01:36 UTC.

No dind rehearsal: the change is viewer-only, so the build was checked before deploying through
`tools/scratch-verification/verify-proxy.mjs` (the new export served locally, everything else
passed to the live gateway). `check-main-pages`, `check-custom-pages` and `check-view-widgets` all
pass, and a real schema-3 saved state from the deployed build (a user page, switch set to ORNL)
migrated with the page kept and the switch dropped. On live after the upgrade: the served
`/dashboard/` bundle matches the verified build; `check-main-pages`, `check-custom-pages` and
`acceptance.mjs` (4 portal lanes online, live video) pass.

Opened by raw IP (`https://127.0.0.1`), the sign-in page logs one console 400. That is ORNL's
passkey options call (`/login/webauthn/options`), which refuses IP addresses; by hostname it is
clean. Not related to this release.

Rollback: `bash oscar.sh stop` in `oscar-3.11.10-mjd948.4`, re-tag `oscar:3.11.10-mjd948.3` and
`oscar-postgis:3.11.10-mjd948.3` as `:3.11.10`, `bash oscar.sh start` in
`/opt/oscar/oscar-3.11.10-mjd948.3`. The older viewer keeps dashboards saved by this release, but
brings back deleted built-ins, restores their original names and lists them under ORNL's menu again.

## Update to 3.11.11 (ORNL merge): live deployment (2026-11-24)

ORNL 3.11.11 merged into the rollin branches (parent `bde0652`, osh-core `c7e43068`, modules
`97611077`, viewer `38219716`, osh-addons `06cb2813`; details in `ROLL_IN_TRIAGE.md`). It adds the
Event Log visited-page cache and backward prefetch, `phenomenonTime`-bounded live alarm lookups,
the PostGIS boolean alarm prefilter and `FederatedObsStore` offset pushdown. No schema or storage
script changes, so 3.11.10 stays a safe rollback target. Parent tag `v3.11.11-mjd948.1`, zip
`oscar-3.11.11-mjd948.1.zip` SHA-256 `43ebe9d47267b358…` (viewer chunks and the PostGIS, core and
service jars checked against the merged build).

**Rehearsal** (dind, `docker:27-dind` capped at 3.5 GB, 172.17.0.2 as `oscar-rehearsal.local`):
the live `v3.11.10-mjd948.4` zip with the live `config.json`, its 11 RPM endpoints pointed at
host simulators 10100–10103/10110 (cameras left on the site simulator).

| step | result | time |
|---|---|---|
| baseline `acceptance.mjs` | pass, incl. Patrol 1 (simulated RS-350) | |
| copy `.env`/`secrets/`/`tls/` into the 3.11.11 dir, `oscar.sh upgrade` | `oscar:3.11.11` from the new dir, `OSCAR_VERSION` set from the release, GUI updater still disabled | 81 s (`/healthz` down ~25 s) |
| `acceptance.mjs`, history | pass; observations 2,040 → 4,566 | |
| `check-event-log-paging` (new), `check-main-pages`, `check-view-widgets` (Patrol 1 spectra), `check-custom-pages`, `check-video-fit`, `check-column-prefs` | all pass | |
| Step-3 checks (308 to HTTPS, anonymous 401, ConSys 200, all viewer routes, admin), `archive verify` | pass | |
| **rollback**: `stop` in 3.11.11, `start` in 3.11.10 | healthy, acceptance passes, data intact | 6 s + 48 s |
| upgrade again | healthy, acceptance passes | 56 s |

Rehearsal container, its volume, the rehearsal dir (live accounts), the hosts entry and the
simulators were removed afterwards.

**Live:** `/opt/oscar/oscar-3.11.11-mjd948.1` (`.env`, `secrets/`, `tls/` copied, identical);
`oscar.sh upgrade` 14:58:52–15:02:37 UTC, `/healthz` down 14:59:43–15:02:04 (about 2 min 20 s;
readiness waits out Patrol 1's RS-350, still down at the site). The images are new tags
(`oscar:3.11.11`, `oscar-postgis:3.11.11`), so nothing was re-tagged. Checks on live: 308, 401
anonymous, ConSys 200, `/login` 200 for the tunnel hosts, all viewer routes 200;
`acceptance.mjs` (four portal lanes, cameras and video; `MOBILE=""`), `check-event-log-paging`
(back to a visited page in 93 ms, no 5xx), `check-main-pages`, `check-custom-pages`,
`check-video-fit`, `check-view-widgets` (`RS350_LANE=""`) all pass; `archive verify` passes;
occupancies from before the upgrade (14:30–14:58), the previous day and after it are all
queryable for all four portal lanes (the 14:30 hot partition rolled into the archive at 15:00 as
usual); OCR running; no storage-pressure activity. Disk 72% after the build (ORNL deletes media at
85%).

Startup log noise, all from Patrol 1's offline RS-350: the comm-provider retries, the RPM recovery
supervisor restarting it, and one `WebIdHelper` NullPointerException ("Failed to create
WebId/Occupancy subscription", `DefaultSystemRegistry.getDatabase` with a null UID) because the
lane's occupancy subsystem never initialised. Not from this release (3.11.11 changes no lane code).

Rollback: `bash oscar.sh stop` in `/opt/oscar/oscar-3.11.11-mjd948.1`, then `bash oscar.sh start`
in `/opt/oscar/oscar-3.11.10-mjd948.4` (its `oscar:3.11.10` images are untouched; rehearsed).

## New users can sign in: live deployment (2026-11-24)

New accounts could not get in: every QR invite the Users page showed returned 410 ("invalid,
expired, or already used"), the temporary password from Reset password never worked, and sign-in
was case-sensitive (`mike` for `Mike`). Cause: osh-core's mutable `HandlerCollection` passed every
request to every handler, and the viewer's root file server wraps its context in a security
handler that sees every path, so `BasicSessionAuthenticator` ran each `/sensorhub/session` call
twice. The second pass minted another invite (revoking the one returned) and reset the password
again (replacing the one shown). Account creation itself was safe (its second pass fails with
"already exists"). Fixes: osh-core `03286d8f` (stop dispatching once a handler answers), modules
`d32712bf` (answer each request once; any-case usernames; case-only duplicates refused), viewer
`9fefaef` (the banner's QR follows the newest invite). Parent `c0c3166`, tag `v3.11.11-mjd948.2`,
zip `oscar-3.11.11-mjd948.2.zip` SHA-256 `100ffe483f085c0c…`. New read-only/self-cleaning checks:
`check-user-onboarding.py`, `check-gateway-routes.sh`.

**Rehearsal** (dind, `docker:27-dind` capped at 3.5 GB, 172.17.0.2 as `oscar-rehearsal.local`):
the live `v3.11.11-mjd948.1` zip, `.env`/`secrets/`/`tls/` copied from live, the live `config.json`
seeded into fresh labelled volumes (ORNL's upgrade migration needs an existing `config.json`), its 11
RPM endpoints pointed at host simulators 10100–10103/10110.

| step | result | time |
|---|---|---|
| baseline `acceptance.mjs` | pass, incl. Patrol 1 (simulated RS-350) | |
| baseline `check-user-onboarding.py` (control) | reproduces live: row invite 410, reset password 401 in any case, case-only duplicate created | |
| tag `:3.11.11-mjd948.1`, new sibling dir, `oscar.sh upgrade` | new `oscar:3.11.11` from the new dir; PostGIS image byte-identical | 74 s (`/healthz` down ~22 s) |
| `check-user-onboarding.py` | 13/13 pass | |
| `check-gateway-routes.sh` (308, 401, ConSys Basic + cookie, session API both paths, admin console, all 19 viewer routes) | pass | |
| `acceptance`, `check-main-pages`, `check-view-widgets` (Patrol 1 spectra), `check-custom-pages`, `check-video-fit`, `check-event-log-paging`, `check-column-prefs` | all pass | |
| node log | only the usual startup warnings | |
| **rollback**: `stop` in `-mjd948.2`, re-tag `-mjd948.1` images as `:3.11.11`, `start` in `-mjd948.1` | healthy on the old image, acceptance passes | 5 s + 48 s |

The second re-upgrade was skipped (the disk was at 81% with the rehearsal's 6.4 GB; ORNL deletes
media at 85%). Rehearsal container, volume, dir (live accounts), hosts entry and simulators were
removed before the live upgrade (disk back to 73%).

**Live:** `/opt/oscar/oscar-3.11.11-mjd948.2` (`.env`, `secrets/`, `tls/` copied, identical); the
replaced images were tagged `oscar:3.11.11-mjd948.1` / `oscar-postgis:3.11.11-mjd948.1` first.
Before it, the admin had deleted the broken Mike and Test accounts (16:05), so only `admin` was
left and `config.json` was current. `oscar.sh upgrade` 16:14:13–16:17:45 UTC, `/healthz` down
16:14:51–16:17:12 (about 2 min 20 s; readiness waits out Patrol 1's RS-350, still down at the
site). On live the PostGIS image was rebuilt with a new ID (same sources). Checks on live:
`check-user-onboarding.py` 13/13 (probe account removed), `check-gateway-routes.sh` all pass,
`/login` 200 for both tunnel hosts, `acceptance.mjs` (four portal lanes, cameras and video;
`MOBILE=""`), `check-event-log-paging`, `check-main-pages`, `check-custom-pages`,
`check-video-fit`, `check-view-widgets` (`RS350_LANE=""`) all pass; `archive verify` passes; every
lane module started; log errors only from Patrol 1's offline RS-350 (as in 3.11.11); no
storage-pressure activity. Disk 78%.

Rollback: `bash oscar.sh stop` in `/opt/oscar/oscar-3.11.11-mjd948.2`, `docker tag
oscar:3.11.11-mjd948.1 oscar:3.11.11 && docker tag oscar-postgis:3.11.11-mjd948.1
oscar-postgis:3.11.11`, then `bash oscar.sh start` in `/opt/oscar/oscar-3.11.11-mjd948.1`
(rehearsed). The older release brings the double-run bug back.

## A late detector no longer strands its lane: live deployment (2026-11-24)

The node restarted at 16:15 (the sign-in deploy) while Patrol 1's RS-350 was down. SensorSystem
gives each auto-start member 10 s, so "Cannot start subsystem 'Patrol 1 - Occupancy'". At 17:07
the RPM recovery supervisor brought the detector back, and LaneSystem re-ran the occupancy
process's `init()` but nothing started it. Patrol 1 recorded nothing and `/tmp/oscar-ready` stayed
withdrawn (container unhealthy) until a manual `oscar.sh restart` at 18:47. The 16:15 notes above
("every lane module started") missed it. Fix: modules `b1ec3cdb` (`OccupancyProcessStarter`
starts the process once the lane's auto-start pass is over), parent `b17ab8d`, tag
`v3.11.11-mjd948.3`, zip `oscar-3.11.11-mjd948.3.zip` SHA-256 `34de8e962e43c801…` (viewer
byte-identical to `-mjd948.2`).

**Disk first:** 82% before the build. With the user's OK, deleted the superseded installs
(`oscar-3.11.0`, `oscar-3.11.10`, `-3.11.10-mjd948.2/.3`), their images (`oscar:3.11.0*`,
`oscar:3.11.10-mjd948.1/2/3` and the PostGIS tags), and old zips (3.11.0, 3.11.10-mjd948.1/2,
3.5.0, 3.6.0-rc.1). That brought the disk to 71%.

**Rehearsal** (dind, `docker:27-dind` capped at 3.5 GB, 172.17.0.2). The live `config.json` was
seeded into fresh labelled volumes, its 11 RPM endpoints and 6 sync markers pointed at host
simulators 10100–10103/10110, with `OSCAR_ARCHIVE_DIR` and `-Xmx1600m` set for the rehearsal.

| step | result |
|---|---|
| baseline `-mjd948.2`, all simulators up | healthy; Patrol 1 occupancy started, dailyFile at 1 Hz |
| **control**: RS-350 simulator off → `oscar.sh restart` → "Cannot start subsystem 'Patrol 1 - Occupancy'" → simulator on | supervisor recovered the RPM in 5 s; occupancy process **initialized, never started**, dailyFile stale, ready marker **absent** (reproduces live) |
| tag `:3.11.11-mjd948.2`, `oscar.sh upgrade` in `-mjd948.3` | 67 s, healthy, fix class in the running jar |
| **fix**: same late-detector run | "Starting occupancy process Patrol 1 - Occupancy after its detector came up" 1 ms after init; dailyFile fresh; ready marker present; no "already started" warnings on a normal boot |
| **rollback**: `stop` in `-mjd948.3`, re-tag `-mjd948.2` images, `start` in `-mjd948.2` | 6 s + 49 s, healthy on the old image |

Rehearsal container, volume, dir (live accounts) and simulators were removed before the live upgrade.

**Live:** `/opt/oscar/oscar-3.11.11-mjd948.3` (`.env`, `secrets/`, `tls/` copied, identical). The
replaced images were tagged `oscar:3.11.11-mjd948.2` / `oscar-postgis:3.11.11-mjd948.2` first.
`oscar.sh upgrade` ran 20:05:36–20:07:18 UTC, with `/healthz` down 20:06:11–20:06:45 (34 s; the
RS-350 was up). Checks on live:
- fix class in the running jar; every lane module started, including `Patrol 1 - Occupancy`;
  Patrol 1 dailyFile fresh; ready marker present; 0 ERROR lines since the upgrade;
- `acceptance.mjs` with `MOBILE="Patrol 1"`: four portal lanes, cameras and video, Patrol 1
  online, walker moving;
- ORNL's Step-7 route/heading loop; `check-event-log-paging`; `check-gateway-routes.sh` 29/29;
  `archive verify`. Disk 76%.

Known gap (pre-existing, not this fix): `WebIdHelper` waits only 5 s for the occupancy process, so
after a late detector WebID analysis stays unattached for that lane until the next restart
("Failed to create WebId/Occupancy subscription").

Rollback: `bash oscar.sh stop` in `/opt/oscar/oscar-3.11.11-mjd948.3`, `docker tag
oscar:3.11.11-mjd948.2 oscar:3.11.11 && docker tag oscar-postgis:3.11.11-mjd948.2
oscar-postgis:3.11.11`, then `bash oscar.sh start` in `/opt/oscar/oscar-3.11.11-mjd948.2`
(rehearsed).

## WebID and OCR re-attach after a late detector: live deployment (2026-11-24)

LaneSystem's occupancy helpers bind to the occupancy producer at lane start. `WebIdHelper` waits 5 s
and `OcrHelper` 10 s for it to reach STARTED, and both give up at once when it is in error
(`waitForState` rethrows the module's error). So after a detector that was offline at boot came
back, the RS-350 lane ran without WebID ("Failed to create WebId/Occupancy subscription") and a
portal lane without vehicle OCR ("OCR inactive on lane") until the next restart. Fix: modules
`61cbdf00`. Each helper reports whether it attached; when the occupancy producer reaches STARTED
after the lane's auto-start pass, the lane re-creates the helpers that gave up. EML is re-attached
on portal lanes only, since on RS-350 lanes it never subscribed before. Parent `d138abc`, tag
`v3.11.11-mjd948.4`, zip SHA-256 `6dab6031382152ed…`.

**Rehearsal** (dind, as for -mjd948.3), RS-350 (Patrol 1) **and** Rapiscan 10100 (Marshall)
simulators off at boot, then back:

| run | result |
|---|---|
| control on `-mjd948.3` | Marshall "OCR inactive" and Patrol 1 "Failed to create WebId" stay so after both RPMs recover |
| first `-mjd948.4` build, normal boot | all helpers attach, but a spurious "Re-attached EML" on Patrol 1 → EML re-attach limited to portal lanes, rebuilt |
| final `-mjd948.4`, normal boot | no re-attach lines |
| final `-mjd948.4`, late detectors | "Re-attached WebID … Patrol 1" + both WebID subscriptions; "Re-attached vehicle OCR … Marshall" + OCR subscription; readiness present |
| rollback to `-mjd948.3` | 5 s + 53 s, healthy |

**Live:** `/opt/oscar/oscar-3.11.11-mjd948.4`; replaced images tagged `:3.11.11-mjd948.3` first;
`oscar.sh upgrade` ran 20:48:35–20:50:23 UTC, with `/healthz` down 20:49:18–20:49:52 (34 s). Checks:
- WebID subscribed on Patrol 1, OCR subscribed on all four portal lanes, nothing re-attached (normal
  boot), every lane module started, 0 ERROR lines;
- `acceptance.mjs` (Patrol 1 included), Step-7 routes, `check-event-log-paging`,
  `check-gateway-routes.sh` 29/29, `archive verify`.

The disk reached 81% after the build; `docker builder prune -f` (21.9 GB of unused build cache)
brought it to 59%.

Rollback: `bash oscar.sh stop` in `/opt/oscar/oscar-3.11.11-mjd948.4`, `docker tag
oscar:3.11.11-mjd948.3 oscar:3.11.11 && docker tag oscar-postgis:3.11.11-mjd948.3
oscar-postgis:3.11.11`, then `bash oscar.sh start` in `/opt/oscar/oscar-3.11.11-mjd948.3`.

## Archive query slots leaked by WebID lookups: live deployment (2026-11-25)

Symptom: the dashboard Alarm Table showed "Events could not be loaded" from 00:39 UTC; every
history query failed with `DuckDB session capacity is busy for operation cold-query after 30
seconds`. The node allows 2 DuckDB sessions (`duckDbMaximumConcurrentSessions`), and a session is
returned only when the store's result stream is closed. `WebIdHelper` looked up observation keys
with `selectKeys(filter).findFirst().get()` and never closed the stream, so each empty WebID match on
Patrol 1 that reached the cold tier kept a session (leaks at 23:29:57 and 00:39:25, visible as
leftover `cold-query-<uuid>` dirs in `/var/lib/oscar/duckdb-tmp`). The mjd948.4 re-attach made the
helper active on Patrol 1. Not related to the second cameras added to each lane the same evening.

Fix: modules `4d4710f2` (try-with-resources, missing match logged as a warning), parent `c6e8ff0`,
tag `v3.11.11-mjd948.5`, zip SHA-256 `f1d78f4538da2894…`. No dind rehearsal: a module-only change
of two lookups; rollback is unchanged.

**Live:** `/opt/oscar/oscar-3.11.11-mjd948.5`; replaced images tagged `:3.11.11-mjd948.4` first;
`oscar.sh upgrade` ran 00:58:53–01:00:42 UTC. Checks: fix class in the running jar, no leftover
DuckDB session dirs, the alarm-table query returns 200 with all 48 unadjudicated alarms, a 7-day
per-datastream query returns 200 in 0.09 s, WebID subscribed on Patrol 1, 0 ERROR lines. Disk 69%.

Rollback: `bash oscar.sh stop` in `/opt/oscar/oscar-3.11.11-mjd948.5`, `docker tag
oscar:3.11.11-mjd948.4 oscar:3.11.11 && docker tag oscar-postgis:3.11.11-mjd948.4
oscar-postgis:3.11.11`, then `bash oscar.sh start` in `/opt/oscar/oscar-3.11.11-mjd948.4`.

## Update to 3.11.15 (ORNL merge): live deployment (2026-11-25)

ORNL 3.11.12–3.11.15 merged into the rollin branches (parent `1ce8503`, modules `fce581ea`,
osh-core `618d8389`, viewer `c21dab2`, osh-addons `c206a0a1`, video-guides `36fec49d`). They bring
Event Log paging/filter fixes, the DuckDB interactive-session reservation, lazy cold-tier streams,
and ORNL's versions of our upstreamed fixes (sign-in, lane recovery, RS-350 watchdog, liveness, HLS
retry, WebID slot leak). Conflicts took ORNL's side except where our unmerged Mobile Detector work
lives: `LaneSystem` keeps the reused occupancy-process member (plus ORNL's "detector already up"
start for a new process), and `RS350Sensor` keeps `LocationOutput`. The first build lost
`LocationOutput` (taken from ORNL's side) and the rehearsal caught it: walkers stopped reporting
GPS, so Patrol 1 went offline and the map froze. Fixed in modules `fce581ea`. Parent tag
`v3.11.15-mjd948.1`, zip SHA-256 `7a1706dfb8baa8a4…`.

Checks before the build: viewer lint/tsc, 359/359 component tests, `npm run build`; modules lane
(70), RS-350, D5, session (19) and i18n tests; osh-core registry and HTTP tests.

**Rehearsal** (dind, live config with RPMs on host simulators):

| step | result |
|---|---|
| baseline `-mjd948.5` | acceptance passes |
| upgrade to first 3.11.15 build | Patrol 1 offline, walker frozen (missing `LocationOutput`) → fixed, rebuilt |
| rollback `stop` 3.11.15, `start` 3.11.11 | 7 s + 58 s, acceptance passes |
| upgrade to final build | 71 s; acceptance passes incl. Patrol 1 GPS; `check-event-log-paging` passes (one cold-start miss, then 2/2), gateway routes, `archive verify`; OCR on all 4 portal lanes, WebID on Patrol 1 |

Known, not new: one `OccupancyProcessInterface` null-datablock NPE after start (also on live
3.11.11 at 01:01:11).

**Live:** `/opt/oscar/oscar-3.11.15-mjd948.1`; images tagged `:3.11.11-mjd948.5` first;
`oscar.sh upgrade` ran 12:29:26–12:32:53 UTC, `/healthz` down 12:30:09–12:32:21 (the site's
RS-350 at 10.235.20.94:10110 was refusing connections). Checks: four portal lanes online with
video, `check-event-log-paging` passes, `check-gateway-routes.sh` 29/29, `archive verify`, OCR
subscribed on all portal lanes. Patrol 1 has been offline since its site simulator stopped at
01:02:55 UTC (before this upgrade); the lane keeps retrying, and its WebID helper is re-attached
when the detector comes back.

Rollback: `bash oscar.sh stop` in `/opt/oscar/oscar-3.11.15-mjd948.1`, then `bash oscar.sh start`
in `/opt/oscar/oscar-3.11.11-mjd948.5` (images `oscar:3.11.11` / `oscar-postgis:3.11.11`, also
tagged `:3.11.11-mjd948.5`). Older fallback: `/opt/oscar/oscar-3.11.11-mjd948.4`.

## Update to 3.12.2 (re-sync to ORNL): plan and rehearsal (2026-11-28)

ORNL 3.12.0–3.12.2 rebuilt our mobile-detector and widget-dashboard work its own way (our PRs
modules#57, viewer#49/#50 and oscar#76 were closed, credited as co-authored), so the nightly job
stopped on 3.12.1 with 108 conflicts. Every one of our fixes was already in ORNL, so the
rollin branches were **re-synced to ORNL**: all conflicts take ORNL's side and our dashboard layer
is dropped (user decision: ORNL's `/dashboards`, start fresh).
- **Pins:** parent `0d7dc0b`+, osh-core `9369a4af` (tree = ORNL `3cbb901a`), osh-addons
  `80c37a08`, modules `9d734ef1` (ORNL `cfdff1e7` + one D5 test), viewer `afad809` (ORNL
  `8019a830` + one lane-health test + the fork-first fix `fix/rs350-summary-card-counts`),
  video-guides `b3b2d145`.
- **Release:** `oscar-3.12.2-mjd948.1.zip`, SHA-256 `714299c8aaa56bf3…`.
- **Checks before the build:**
  - viewer: tsc, 353/353 component tests, build;
  - release metadata;
  - gradle: lane, RS-350, D5, session, webui, OSCAR service, bucket, journal and OCR (680);
  - osh-core (37);
  - PostGIS 273 against a 3.12.2 test DB, failing only the 8 known ones plus one knock-on that
    passes alone;
  - RAD utils, consys, hivemq, aspect, ffmpeg, rapiscan.

**Rollback is a one-way door from 3.12 on.** 3.12 marks the RS-350 `alarm`/`location` streams
archive-only in PostgreSQL; 3.11.15 started on those volumes reports **healthy** but fails every
write batch ("Datastream 8 cannot change between mutable and immutable storage classes") and
records nothing on any lane. Rollback = stop, restore the cold snapshot taken just before the
upgrade (`tools/live-upgrade/state-snapshot.sh`), start the old dir.

**Rehearsal** (dind, live `config.json` with RPMs on host simulators; the RS-350 simulator now
walks our site loop via `site-loop.json`):

| step | result | time |
|---|---|---|
| baseline 3.11.15-mjd948.1 | acceptance passes (4 portal lanes with video, Patrol 1 moving) | |
| capture the old viewer's saved dashboards | 10 pages incl. a user-made one | |
| prepare 3.12.2 dir (`merge-env.py`: version + G1 flags, heap kept), pre-build | baseline untouched | 28 s |
| stop, snapshot, `oscar.sh upgrade` | healthy on 3.12.2 | 6 s + 0 s (132 MB) + 55 s |
| acceptance | pass, incl. Patrol 1 GPS and moving walker | |
| `check-event-log-paging`, `archive verify`, `check-gateway-routes` | pass (29/29) | |
| `check-dashboards` with the old saved state | `/dashboards` renders, home is ORNL's Dashboard, no page errors | |
| Patrol 1 mobile card | Gamma 1,230 Counts, Neutron 1 Counts (the fork-first fix) | |
| server log | 0 ERROR; pre-existing "Could not attach WebID Analysis to RS350" warning, same as baseline | |
| occupancy history | all pre-upgrade occupancies present on all 4 portal lanes, new ones arriving | |
| **control:** start 3.11.15 on the upgraded volumes without restore | healthy, but 164 storage errors in 2 min and **0 occupancies recorded** | |
| **rollback:** stop, `state-snapshot.sh restore`, start 3.11.15 | healthy, 0 errors, history intact, occupancies recorded again | 6 s + 0 s + 58 s |

Harness changes found by the rehearsal: since 3.12.2 a Basic request within 30 s of an earlier
one is served from ORNL's credential cache without a new session cookie, so
`check-gateway-routes.sh` now signs in through the login form.

**Live procedure (waiting for the user's go):** `/opt/oscar/oscar-3.12.2-mjd948.1` from the zip,
copy `.env`/`secrets/`/`tls/`, `merge-env.py`, pre-build, copy `config.json` out, then stop live,
`state-snapshot.sh take /opt/oscar/snapshots/pre-3.12.2 --archive-dir /opt/oscar/oscar-storage/archive`
(about 1.9 GB), `oscar.sh upgrade`, repoint the sandbox-agent / usb-backup-status units. Expected
outage about 1.5–3 min.

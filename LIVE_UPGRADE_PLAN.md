# Live node upgrade: OSCAR 3.5.0 → 3.11 (our `ornl-3.11-rollin` build)

Drafted 2026-11-17. Nothing in this plan has been executed against the live node.

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
2. **Config migration script** (`tools/live-upgrade/migrate-config.py`, to be written, built on
   `tools/scratch-verification/seed-scratch-lanes.py`). It reads the live `config.json` and writes
   only lane and service settings into a **fresh 3.11 `config.json`**:
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

1. **Remove the scratch stack**: `bash /opt/oscar-scratch/oscar-3.11.0/oscar.sh stop`, then
   `docker compose -p oscar down`, `docker volume rm oscar_oscar_state oscar_postgres_data`, stop the
   mock simulators, delete `/opt/oscar-scratch`, and remove the `oscar-scratch.local` line from
   `/etc/hosts`.
2. **Stop 3.5**: `systemctl stop oscar && systemctl disable oscar`, then `docker stop oscar-postgis-container`.
   Nothing is deleted: `pgdata`, the container and `/opt/oscar/oscar-3.5.0` stay for rollback.
3. **Install 3.11**: unzip the frozen release to `/opt/oscar/oscar-3.11.0`, then run
   `OSCAR_SETUP_ADMIN_PASSWORD=… bash oscar.sh init --non-interactive --hostname <decision 2> --port 443 --timezone UTC --tls-san 10.235.20.56 --skip-hosts-entry --skip-start --backup-mode <decision 8> …`
   (add `--certificate/--private-key` if importing a real certificate). In `.env`, set
   `OSCAR_JAVA_OPTS` to about `-Xms1g -Xmx4g`: 6 GB plus PostgreSQL's 512 MB of shared buffers and the
   gateway does not fit this 8 GB host.
4. `bash oscar.sh start` once so 3.11 writes its standard config, then stop the oscar container,
   apply the migrated `config.json` into the state volume (as uid 10001, mode 600) and start again.
   Wait for `healthy`. If it sticks at `starting`, check for ORNL's bucket-service race
   ("Could not find this OSH node's Bucket Service"); one restart clears it.
5. Smoke check from the host: `/healthz`, sign in, all five lanes under Sensors in the admin UI,
   then **Save** in the admin UI so the lane modules persist.

## Phase 4: acceptance (on the live node)

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

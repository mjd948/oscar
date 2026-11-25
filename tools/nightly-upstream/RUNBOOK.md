# OSCAR nightly upstream runbook

Goal: bring ORNL release `RELEASE_TAG` into our `ornl-3.11-rollin` branches. Test it, build it,
rehearse it beside live, deploy it, and roll back if live is not healthy. Then report.

The person who reads your summary is not a developer. Write `summary.md` in plain language:
what changed for them, what was done, and whether they need to do anything.

## Ground rules (never break these)
- **Push only to `my-fork`.** Never push to `origin` (ORNL). Never force-push. Never run
  `git submodule sync`.
- **Never resolve a merge conflict.** A conflict anywhere, except the parent repo's submodule
  pointers, means status `stopped-conflict`: abort the merges and STOP. Leave live and the fork as
  they were.
- **Leave these alone:** Docker data volumes (`oscar_oscar_state`, `oscar_postgres_data`), the
  admin password, `.env` secrets, and `/srv/oscar-3.5-archive`. Never delete a release dir that
  live or the rollback target uses.
- Never adjudicate alarms or change lanes or users on live. Live checks are read-only.
- Never point a rehearsal or scratch node at the site's real detector ports (10.235.20.94); live
  is connected to them. Rehearsals use the local mocks.
- **The host has 8 GB of RAM, shared with live.** Use gradle `-Xmx2g --max-workers=2`, a dind
  container with `--memory 3500m`, and one heavy job at a time.
- **On anything this runbook does not cover, or a step you can't make pass: stop safely and
  report.** Don't improvise on live. A stop means:
  - live still runs the version it ran before,
  - nothing is pushed,
  - any rehearsal container is cleaned up.
- Always finish by writing `RUN_DIR/result.json` and `RUN_DIR/summary.md`, even on failure:
  `{"status": "...", "release": "RELEASE_TAG", "live_version": "...", "notes": "..."}`. Valid
  statuses:
  - `deployed`
  - `ready-no-deploy` (when NO_DEPLOY=1 and everything passed)
  - `rolled-back`
  - `stopped-conflict`
  - `tests-failed`
  - `error`
- Background reading if you need it:
  - `LIVE_UPGRADE_PLAN.md`: every past live update, with its exact commands and checks. Copy
    the most recent "live deployment" section.
  - memory in `/root/.claude/projects/-root-osh-oakridge-buildnode/memory/`: `oscar-live-node-3-11.md`,
    `osh-fork-topology.md` and `oscar-311-scratch-stack.md`.

## Layout
- **Parent repo:** `CHECKOUT` (the wrapper has already reset it to `my-fork/ornl-3.11-rollin`).
- **Submodules:**
  - `include/osh-core`, `include/osh-oakridge-modules` and `web/oscar-viewer`: on branch
    `ornl-3.11-rollin`, with remotes `origin` = ORNL and `my-fork` = our fork.
  - `include/osh-addons` and `docs/video-guides`: just follow ORNL's pin.
- **Live:** Compose project `oscar`, the newest release dir under `/opt/oscar/`, with containers
  `oscar-oscar-1`, `oscar-postgres-1` and `oscar-gateway-1`. Find the live dir with `docker inspect
  oscar-oscar-1 --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'`.
- **Admin password file:** `/root/oscar-3.11-admin-password.txt`. Live URL: `https://localhost`.
  Never use `127.0.0.1`.
- **Checks:**
  - in `tools/scratch-verification/`: `check-event-log-paging.mjs`, `check-gateway-routes.sh`,
    `mockctl.sh` (simulators), `harness.mjs`
  - in `tools/live-upgrade/`: `acceptance.mjs`
  - They need Playwright. Reuse an existing install: look for `node_modules/playwright` under
    `/root/osh-oakridge-buildnode/tools` or the session scratchpads. Otherwise install it in
    `RUN_DIR/pw`.

## Steps

### 1. Fetch and dry-run the merge
- In the parent and in osh-core, modules and the viewer: `git fetch origin` and
  `git fetch my-fork`. The wrapper already fetched `RELEASE_TAG`. Don't run
  `git fetch origin --tags` in the parent: our fork's `v3.11.0` differs from ORNL's, so it's
  rejected. Fetch a specific tag with `git fetch origin refs/tags/X:refs/tags/X`.
- Find ORNL's submodule pins at `RELEASE_TAG`: `git ls-tree RELEASE_TAG include/ web/ docs/`.
  Per submodule, the ORNL side is that pinned commit.
- For each of osh-core, modules, viewer and the parent, run
  `git merge-tree --write-tree --name-only ornl-3.11-rollin <ornl side>`.
  - If every one is already an ancestor (nothing to merge) and NO_DEPLOY=0: status `error`,
    with a note saying "already merged", then stop.
  - If NO_DEPLOY=1 (a dry run), skip to step 3 on the current rollin branches.
- **Conflicts**, other than the parent's gitlink paths: status `stopped-conflict`. For each
  conflict, list:
  - the repo and file,
  - our commits that touched it (`git log --oneline <merge-base>..ornl-3.11-rollin -- <file>`),
  - ORNL's commits that touched it.

  Explain in plain words what clashed. Then stop.

### 2. Merge (no conflicts)
- In osh-core, modules and the viewer:
  `git merge --no-ff <ornl side> -m "Merge ORNL <ver> (<repo> <short sha>) into ornl-3.11-rollin"`.
- osh-addons and video-guides: check out ORNL's pinned commit.
- Parent: run `git merge --no-ff RELEASE_TAG`. Then `git add` the five submodule paths at their new
  commits, and commit with a message that summarizes the ORNL release notes
  (`gh release view RELEASE_TAG -R ORNL/oscar`).
- **Watch for silent losses.** A clean merge can still drop our work: on 3.11.15, `RS350Sensor`
  lost our `LocationOutput`. For each repo, compare
  `git diff <ornl side> ornl-3.11-rollin --stat` before and after the merge. Every file where our
  diff from ORNL shrank sharply needs a look. A loss you can't explain means `tests-failed`.

### 3. Test (stop on any failure that isn't allowlisted: status `tests-failed`, push nothing)
- **Viewer** (`web/oscar-viewer`):
  - `npm ci`, `npm run lint`, `npx tsc --noEmit` if a script for it exists
  - `npx cypress run --component --browser electron` (NOT the npm script; chrome isn't installed)
  - `npm run build`
  - Record the pass counts.
- **Release metadata:** `node tools/validate-release-metadata.js`, plus
  `node --test tools/update-version.test.js tools/collect-release-contributors.test.js`.
- **Gradle:** add `-Dorg.gradle.jvmargs=-Xmx2g --max-workers=2 --no-parallel` to every
  invocation.
  - Modules: the lane, RS-350, D5, session and i18n tests.
  - osh-core: the registry and HTTP tests.
  - The PostGIS tests listed in `build-all.sh`.
  - The PostGIS tiered suite needs a DB on localhost:5432 (gis/postgres/postgres). Run
    `oscar-postgis:<ver>` with `OSCAR_STORAGE_PROFILE_VERSION` and `OSCAR_DB_PASSWORD_FILE`,
    plus `OSCAR_IT_ARCHIVE_DIR`. If it can't be started, note that and continue; the rehearsal
    covers the store.
- **Allowlist** (known ORNL failures, not ours): `deepOffsetPaginationSkipsArchivedClusters…`
  (expected 16 decodes, got 0). A new upstream-only failure can be allowlisted only if it fails
  identically on a clean ORNL checkout of `RELEASE_TAG`. Prove it, and note it in the summary.

### 4. Build
- Run `./gradlew build -x test -x osgi` with the memory flags above. The viewer is already built.
- **Release name:** `v<ver>-mjd948.N`. `<ver>` comes from `.env.example` / the release metadata.
  N is 1 plus the highest existing `v<ver>-mjd948.*` tag.
- Copy `build/distributions/oscar-<ver>.zip` to `build/distributions/oscar-<ver>-mjd948.N.zip`,
  and write its `.sha256` next to it.

### 5. Rehearse in dind (mandatory; it caught the 3.11.15 regression)
Check `df` first: you need about 10 GB free and must stay under 80%. Follow the "Rehearsing beside
live" recipe in memory `oscar-live-node-3-11.md`:
1. Start a privileged `docker:27-dind` container with `--memory 3500m`. Bind-mount the rehearsal
   dir `/opt/oscar-nightly-rehearsal` at the same path.
2. Copy the live `config.json` read-only. Rewrite the RPM `remoteHost` entries (ports
   10100–10103/10110/10111) and the `lastSyncedEndpoint` markers to `172.17.0.1`.
3. Start the mocks on the host with `mockctl.sh`.
4. Build the baseline from the live release's zip (`build/distributions/` in
   `/root/osh-oakridge-buildnode`, or rebuild it from the live tag). Check that `acceptance.mjs`
   passes.
5. Upgrade to the new zip with `oscar.sh upgrade`. Then run `acceptance.mjs` (portal lanes:
   "Marshall,AFM Gate,Selfridge,Memorial Ave"; mobile: "Patrol 1", including GPS) and
   `check-event-log-paging.mjs`, and look for new ERROR lines in the logs.
   - Known and harmless: one `OccupancyProcessInterface` null-datablock NPE after start.
6. Roll back to the baseline (`stop` the new, `start` the old). Check that it's healthy.
7. **Clean up whatever the result:** remove the dind container, its volumes and
   `/opt/oscar-nightly-rehearsal`. They hold live account data and use about 6 GB. Stop the mocks
   you started.

A failure here means `tests-failed`. If NO_DEPLOY=1, stop after the cleanup with status
`ready-no-deploy`.

### 6. Deploy to live
1. Record the current live dir, the images (`docker inspect` on all three containers) and
   `/healthz`.
2. If the new `<ver>` equals the live version, first tag the current `oscar:<ver>` and
   `oscar-postgis:<ver>` images as `:<live release name minus the v>`, e.g. `:3.11.15-mjd948.1`.
   A new version gets new image tags by itself.
3. Unzip to a temp dir, then move it to `/opt/oscar/oscar-<ver>-mjd948.N`.
4. Copy over `.env`, `secrets/`, `tls/` and `.oscar-volume-adoption` (if present) from the live
   dir. Keep `OSCAR_GUI_UPDATE=disabled`, the heap `-Xmx4g` and backups as they were. Diff the new
   `.env.example` against the old one, and carry over any new keys with ORNL's defaults.
5. Run `bash oscar.sh upgrade` in the new dir. Log the start and end times.
6. Repoint the systemd units that hardcode the release path at the new dir:
   `grep -l /opt/oscar/oscar- /etc/systemd/system/*.service`. Today those are
   `oscar-sandbox-agent` and `oscar-usb-backup-status`. Then `systemctl daemon-reload`.

### 7. Health gate (up to 10 minutes after `upgrade` returns)
All of these must hold:
- `oscar-oscar-1` is healthy and `https://localhost/healthz` returns 200;
- a sign-in with the admin password works;
- `check-event-log-paging.mjs` passes;
- `tools/scratch-verification/check-gateway-routes.sh` passes;
- `bash oscar.sh archive verify` passes;
- the portal lanes are online with video (`acceptance.mjs` against live is read-only; use it);
- there's no crash or restart loop (`docker inspect` RestartCount is unchanged) and no flood of
  new ERROR lines.

A lane that was already offline before the deploy, because its site simulator was down, isn't a
failure. Compare against `LIVE_BEFORE` and the pre-deploy lane states you recorded.

**If the gate fails, roll back.** Run `bash oscar.sh stop` in the new dir. If step 6.2 re-tagged
images, put the old tags back. Run `bash oscar.sh start` in the previous live dir, point the
systemd units back, and re-check health. Status: `rolled-back`. Don't push the merge. Explain what
failed. Keep the new dir for diagnosis, but delete its images if disk is above 75%.

### 8. Record and push (only after a passed gate)
- Add a section to `LIVE_UPGRADE_PLAN.md` in the style of the previous ones: what merged, the
  checks, the rehearsal table, the live times, and the exact rollback commands. Commit it as
  "Deploy ORNL <ver> to live (v<ver>-mjd948.N)". Tag the parent with `v<ver>-mjd948.N`.
- Push `ornl-3.11-rollin` in osh-core, modules and the viewer to `my-fork` first, then push the
  parent branch and tag. If a push is rejected because it isn't a fast-forward (someone pushed in
  the meantime), don't force it: report it in the summary.
- Update memory `oscar-live-node-3-11.md`:
  - the live dir, release and rollback command,
  - a note that `/root/osh-oakridge-buildnode` needs a `git pull` and
    `git submodule update` to catch up.
- **Clean up:**
  - `docker builder prune -f`
  - keep the newest 3 `/opt/oscar/oscar-*` release dirs (live plus 2 rollbacks) and their image
    tags; remove older release dirs and their `oscar:`/`oscar-postgis:` image tags
  - never remove `/opt/oscar/oscar-storage`
  - keep the 3 newest zips in `build/distributions`

### 9. Summary (`summary.md`, plain language, under about 60 lines)
1. One line: the result. For example, "OSCAR was updated to ORNL 3.11.16 and is running normally."
2. What ORNL changed, in user terms, from the release notes. Say whether any of our open upstream
   PRs were merged: modules#57, viewer#49, viewer#50, oscar#76 and modules#60 (check with
   `gh pr view -R ORNL/<repo> <n> --json state`).
3. Tests: counts passed and failed, plus anything allowlisted.
4. The rehearsal result, and the live result with the downtime in seconds.
5. Anything to look at. If something went wrong or needs a decision: what happened, what state
   things are in now, and what the options are.
6. The rollback command, in one line.

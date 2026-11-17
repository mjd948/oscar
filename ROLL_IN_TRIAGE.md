# ORNL 3.11 roll-in — commit triage (2026-11-17)

Base: ORNL `main` at v3.11.0 (`oscar` 16bed16, `oscar-viewer` 867a204, `osh-oakridge-modules` 2cd233f8,
`osh-core@OSCAR` 95bb1d32, `osh-addons@OSCAR` e6891b02). Our heads before the roll-in are tagged `pre-ornl/2026-11-17*`
in every repo, both in the old forks (`*-botts-archive`, `osh-oakridge-buildnode`) and in the new ORNL forks.

Verdicts:
- **port**: not in ORNL. Cherry-pick or re-apply it onto the integration branch.
- **upstream**: ORNL already has it (their OCR is a squash import of ours).
- **superseded**: ORNL fixed the same defect differently. Drop it.
- **drop**: out of scope by decision (desktop/non-Docker packaging, version bumps, pointer-only bumps).

Parent commits that only bump submodules take the verdict of the submodule commits they carry, so they are not listed.

## osh-core (2 commits)
| commit | subject | verdict | evidence |
|---|---|---|---|
| e4b41a3b | Fix subsystems clone race, uninitialized-member registration, admin UI errors | port | not in ORNL/osh-core@OSCAR (`git cherry`) |
| 6f6627a3 | Fix module restart failures: registration rollback + struct check harmonization | port | same; pairs with modules 683a0e92 |

## osh-addons
No local commits. Pin to `ORNL/osh-addons@OSCAR` e6891b02.

## osh-oakridge-modules (17 commits)
| commit | subject | verdict | evidence |
|---|---|---|---|
| bcfde772 | Per-lane statistics in siteStatistics output | superseded | ORNL's `StatisticsControl` takes a `laneUID` parameter (semicolon list) and `StatisticsOutput.getStats(start, end, laneUIDs)` scopes the counts, so the viewer can fetch per-lane counts with one command per lane. Only our per-lane `numAdjudicated`/`avgTimeToAdjudicateSec` are lost. A cherry-pick would have meant rewriting ORNL's cancellable publication framework |
| 79059f32 | HLS: RTSP reconnect, PTS rebase, wider live window | superseded | ORNL MediaMTX loopback proxy + in-place reconnect + DTS/PTS normalization (modules 06a0b6c4, d7ab00da). ORNL keeps `hls_list_size 2` on purpose for startup latency; re-test our video freeze against it |
| 2624aa47 | HLS inactivity watchdog never fired | **ported as new commit** | Part 2 (one handler per lane) is superseded by ORNL's per-bucket `HLS_HANDLERS` map. Part 1 still applies: ORNL `HlsStreamHandler.stopStream` still builds `CommandData` with `BigId.NONE`, and the scheduled sweep has no catch, so a throw would cancel it. Verify with ORNL's `HlsStreamHandlerTest`, and port the exception-proof sweep and direct `endStreamNow`. **Done:** confirmed that `OshAsserts.checkValidInternalID` rejects `BigId.NONE`. The fix uses the `CommandData(id, params)` direct-to-driver constructor, makes the sweep catch per stream, and also fixes `FFMPEGSensorBase.beforeStop`, whose same bug meant a module stop never closed the recording file or ended HLS |
| c48fd756 | RS350: GPS location datastream, alarm position on occupancies | port | mobile track; no MobileDetector or location output in ORNL |
| d8f52c7e | Kromek D5: UID stub/output naming, GPS location | port | mobile track |
| c20486e6 | Kromek D5 as mobile lane: d5-occupancy process + LaneSystem wiring | port | mobile track |
| bdcbacec | Vehicle OCR module + lane wiring | upstream | ORNL `sensorhub-process-ocr` (95ddf66e, 62be45c3, 2cd233f8): 20 of our file names survive, and it has been rebuilt with a two-tier scanner and a resource governor |
| b3d812ec | Mobile Detector System module type + lane config fixes | port | mobile track; conflicts in `LaneSystem`, `LaneConfig`, `LaneConfigForm` |
| 683a0e92 | RS350/lane: stop mutating registered structures; interrupt reader threads | port (half) | The struct-copy half was ported. The thread-interrupt half is superseded by ORNL's staged `requestStop`/`awaitSourceStopped`/`awaitAncillaryStopped` |
| 26efa7e6 | Duplicate clip recording after camera restart | **port** | ORNL `OccupancyWrapper.addFFmpegSensor` uses `cameras.addIfAbsent(sensor)`, which is still identity dedupe, so the bug is present |
| 20b3dce0 | Stop reading camera OSD banners as container numbers | upstream | ORNL `Iso6346` strips OSD dates/clocks and has the same digit-coerced-category guard (`!Character.isDigit(source.charAt(3))`), and `CandidateAggregator.isStaticEdgeOsd` rejects banners |
| 59096ca0 | Rank real container numbers above overlay text | upstream | ORNL `CandidateAggregator` ranks by `effectiveScore` with a checksum-valid floor and static-OSD rejection |
| 509afce1 | RS-350 watchdog measures real silence | port | none of our watchdog fields exist in ORNL RS350 |
| b083c5bc | RS-350 self-recovers when comms return | port | same |
| 72327263 | Video retention segfault + clip shredding | superseded | ORNL `VideoRetention.decimate`: the close callback only calls `stopProcessingStream`, `closeFile()` runs after `join`, and `validateDecimatedFile` runs before the replace |
| 8c667dab | Video retention ffmpeg-context leak | superseded | ORNL decimator rewritten (lock-guarded close with `avformat_free_context`) |
| 379e150a | RTSP reconnect leaves recorder holding freed timing | superseded | ORNL `FileOutput` copies the time base with `av_make_q(...)` instead of caching `@ByRef` |

## oscar-viewer (60 commits)
Tracks: **R** = reliability, **M** = mobile, **W** = widget dashboard.

| commit | subject | verdict |
|---|---|---|
| a67cacb | Update dashboard UI and lane status views | port W (re-host on ORNL dashboard) |
| ed5d732 | Smooth lane-view bar charts at 200ms cadence | port W |
| aa86efe | Event-details crash when laneMap entry missing | port R (check ORNL `event-details/page.tsx` guards) |
| b753636 | Per-lane statistics on National View | port W (needs modules bcfde772) |
| 7563348 | Filter popover + adjudication columns in alarm table | port W; reconcile with ORNL Adjudication Code filter/column |
| 07e366e | Translate hardcoded strings, add Turkmen | port W; merge keys into ORNL en/es/fr/el, keep `tk.json` with English fallback |
| 8b8867a 948f293 e324277 cca3f75 9bf4cd0 4f554e4 995a68e | Widget framework, LaneStreamRegistry, widgets, seeded pages, specs | port W (re-host: widgets wrap ORNL components) |
| 364ffeb f60162c 38fa698 9d75567 | Column visibility persistence, responsive chips, 16px/v2 layout, chart remount | port W |
| 95c6685 | Disable hls.js worker transmuxer | port R if ORNL `HLSVideoComponent` still uses the inline worker (it has no `enableWorker: false`) |
| a6be9b5 | Remove dead pre-widget chart wrappers | port W (only if the wrappers are still dead after the re-host) |
| e6320ea | Dashboard video freeze: muted autoplay, live window, 404 recovery | superseded partly (ORNL already `muted`, has `liveSyncDurationCount`, HLS leases); port the 404 recovery only if the e2e spec fails |
| 94f4255 | e2e spec: HLS cold start + teardown recovery | port R (spec) |
| 1c4272e | Lane status death + map world zoom | port R (stream part); map zoom superseded by ORNL tight lane-extent fit |
| 88abacc 1092ba1 005fff8 b135e23 db61750 | Mobile detector map/alarms/specs | port M |
| bf914b1 | Vehicle OCR adjudication UI | upstream (ORNL `VehicleIdOcr.tsx`, f740185) |
| 33cbf9f | "Adjudicate All" bulk action | port W |
| a7aae57 | Persist lane alarm/fault status across refresh | port R (check ORNL's shared alarm read-state endpoint, modules 0e00cc16, first) |
| 4fd78ba efe02d0 | New logo; title/edit controls in app bar | port W |
| b352b39 113233f | Alarm Statistics widget + deflake | port W |
| 372d7b2 | Bounded adjudication fetch, stop disconnecting its stream | port R |
| 3a71c54 | Time profile from count queries | port W (check ORNL count push-down) |
| 71fbdf8 492d6ac | Comms-loss detection; liveness from device data | port R (note ORNL Status of Health and fault indicators; integrate, don't duplicate) |
| ba9c93c c47e4ad | serve-proxy fixes | port (dev/verification tooling only) |
| a4603b1 | AdminModuleRestart spec | port R (spec) |
| d65ff31 7652f07 33835eb | OCR chip reliability, Vehicle ID column live | check→port delta (ORNL has a Vehicle ID column and its own `useVehicleOcrMap`) |
| 6882586 | WebID analysis results reliable | port R (check against ORNL WebIdAnalysis rewrite) |
| f9edcf2 5f01429 1a34422 bdecbb0 c0fc922 76139cd 629e59a a12a327 | Event-table column merge/persist/reorder/wrap/widths + specs | port W (onto ORNL EventTable, which has had a large rewrite) |
| 8fde724 | Ignore Claude Code local state | port |
| 720959e f2638f9 | Runtime node pointing; version 3.6.0-rc.1 | drop (packaging) |
| 0a61f74 | Route node file/bucket URLs through one resolver | port R if ORNL still builds bucket URLs ad hoc; otherwise superseded |
| 26e5cac | Stop dashboard re-render on every realtime message | port R |
| 2a5b5d6 4b3bc58 | Node port/scheme/credential handling; persist node config not instance | port R (ORNL `Node.ts` still has an `isSecure`/port path; check the `Number(location.port)` and `Basic undefined` traps) |
| — | `patches/osh-js+3.1.5.patch` (MQTT resubscribe one-way door) | superseded: ORNL/osh-js@0d3716dc has both halves (recreate BroadcastChannel, de-dupe topics on unsubscribe). Drop patch-package |

## oscar (parent) own commits
| commit | subject | verdict |
|---|---|---|
| 4d70b600 acc29162 | Electron app, electron version | drop (packaging) |
| aa837923 | App icon (electron) | drop (the viewer logo comes with 4fd78ba) |
| b42a50ee | Ignore .vscode/ | port |
| cb3868c8 | Mobile detector sim spec + mocks | port M (exclude the committed `__pycache__`) |
| 89010e4b | MobileDetectorConfigForm in config template | port M (`dist/config/standard/config.json`) |
| ba17e39a | Wire vehicle OCR into build + models | upstream (ORNL ships `dist/models/ocr`) |
| 4c6cac74 | Point submodules at my forks | redo against the new ORNL forks |
| a64df5d3 4160fefa 1ad47aec 76c0a38c 543cf397 5770b894 e3758928 bec7e540 e850b270 | Packaging, Linux without Docker, Windows installer, same-origin proxy, 3.6.0-rc.1 | drop (packaging; ORNL Docker release replaces it) |

## Port status (2026-11-17)

| repo | branch (on the mjd948 fork) | state |
|---|---|---|
| osh-core | `ornl-3.11-rollin` | 2 restart fixes + a deflaked rollback test. `TestSystemDriverRegistry` passes 8/8 (it failed 2–4 in 5 on both the old pin and the rebase before the test fix) |
| osh-oakridge-modules | `ornl-3.11-rollin` = merge of `rollin/reliability` + `rollin/mobile-detectors` | system-lane 44 tests pass (4 hardware tests skipped), OCR 47 pass, ffmpeg 150/151 (the only failure, `FileTestH264.testStreamProcessingDecodeVideo`, needs an X11 display) |
| osh-addons | ORNL `OSCAR` e6891b02 | unchanged |
| oscar-viewer | ORNL `main` 867a204 (not yet ported) | see below |
| oscar | `ornl-3.11-rollin` | ORNL main + `.gitmodules` pointing at the forks, mobile config form, mocks and sim spec |

### New findings made while porting
- **Mobile lanes vs. extended occupancy (new commit 854164de):** ORNL auto-adjudicates gamma-only occupancies longer than the lane threshold (default 1 min) as Code 9998. On a mobile lane that would silently close long walker alarms. `MobileDetectorSystem` now opts out through `LaneSystem.isExtendedOccupancyMonitoringEnabled()`.
- **RS-350 self-recovery** was re-applied on ORNL's journal-aware stop. A rebuild stops the old `MessageHandler` with the staged API and keeps the lane's daily-file journal open.
- **Duplicate-clip fix** also routes ORNL's bulk `setFFmpegSensors` through the UID dedupe.

### Open items
- **GPS `location` datastreams are not in the PARQUET_PRIMARY allowlist.** The list lives in osh-addons `TieredArchiveConfig.DEFAULT_OUTPUT_NAMES` and is mirrored in `dist/config/standard/config.json`. A persisted list that differs from a known default stops ORNL's automatic list upgrades, so adding `location` belongs upstream in osh-addons (we have no fork) rather than in our config. Until then mobile GPS fixes stay in hot PostGIS `obs`.
- **Viewer: fixes and mobile ported, widget dashboard not yet.** See the viewer section below.

## Viewer port, phase 1: fixes and mobile on ORNL's own dashboard (branch `rollin/reliability`)

| old commit(s) | verdict | what happened |
|---|---|---|
| 71fbdf8 492d6ac (comms loss, device-data liveness) | **re-implemented** (1743858, 4609991) | ORNL's `useLaneHealth` trusted the latest `connectionStatus` however old, so a stopped module stayed green and D5 lanes stayed "unknown". Silence of ~1 Hz device streams now overrides it (30 s, node timestamps; failed batches are not judged). The map sweep uses browser arrival time (15 s). |
| 1c4272e (lane-status stream death) | superseded | ORNL replaced per-stream lane status with a polled health snapshot and ref-counted `acquireSharedConnection` leases |
| 88abacc 005fff8 1092ba1 db61750 (mobile map) | **re-implemented** (4609991) | walker markers on live GPS, normal/alarm/offline; unadjudicated alarm markers from the server's `adjudicatedIdsCount=0` filter; first-fix-only extent fit. Also fixes ORNL's map reading the nonexistent `data.connection`, and `toLaneMapLocation` dropping `{sensorLocation}` GPS records. The 1092ba1/db61750 e2e specs depend on the widget page; replaced for now by unit specs |
| b135e23 (mobile alarm audio) | **re-implemented** (99ea91a) | mobile occupancies trigger the dashboard alarm; auto-adjudicated ones stay silent |
| 6882586 (WebID reliable) | **half re-implemented** (193b916) | ORNL fixed accumulation, deps and subscribe. The fetch still scanned the stream oldest-first, capped at 2,500. It now filters by `occupancyObsId`, falling back to the old scan |
| 95c6685 (hls.js worker) | ported (29492c6) | `enableWorker: false` |
| 26e5cac (re-render storm) | partly ported (a805646) | gate map status updates; the BroadcastChannel leak does not exist with ORNL's plain Leaflet markers |
| e6320ea (video freeze) | superseded, **plus a new gap fixed** (9621bc8) | ORNL: muted autoplay, deliberate low-latency live window, HLS viewer leases. The scratch run showed ORNL stops at a manual Retry after a camera drop; the player now retries on its own (see the scratch-verification section) |
| aa86efe (event-details crash) | superseded | ORNL guards every `laneMapRef.current.get` deref |
| 372d7b2 (bounded adjudication fetch) | superseded | it fixed our own widget-era `useAdjudicationMap`; ORNL filters with `adjudicatedIdsCount` server-side |
| 2a5b5d6 4b3bc58 0a61f74 (node port/scheme/creds/persistence) | superseded | ORNL defaults the port to 443/80, builds empty `connectorOpts` without credentials, defaults `auth` to empty strings, has `serializeNode`, and moved to session auth |
| d65ff31 7652f07 33835eb (OCR chips, Vehicle ID column) | upstream | ORNL `VehicleIdOcr`, `useVehicleOcrMap`, Vehicle ID column |
| ba9c93c c47e4ad (serve-proxy) | **dropped** | not needed on 3.11: ORNL's gateway already serves the viewer same-origin with session login, which is what the proxy faked |
| a4603b1 94f4255 (e2e specs) | replaced for now | the scratch run used Playwright scripts against the gateway (see the scratch-verification section); cypress e2e specs return with the widget dashboard |
| widget dashboard stack | phase 3 | not started |

## Scratch verification (2026-11-17)

The `ornl-3.11-rollin` build ran as ORNL's own Docker Compose deployment at
`/opt/oscar-scratch` (gateway on 443), beside the untouched live 3.5 node. It used four
lanes: two Rapiscan portals on `rapiscan_mock.py`, each with a live RTSP camera from the sim
box, an RS-350 walker and a D5 walker. Scripts and how-to are in `tools/scratch-verification/`.

| check | result |
|---|---|
| ORNL live-deployment checks (Step 3 of `test-live-deployment-regression.sh`): TLS gateway, anonymous 401, ConSys systems/datastreams, all 8 viewer routes render, admin UI | **pass** (one assertion relaxed, see ORNL issues) |
| `oscar.sh archive status` / `archive verify` | pass (empty archive) |
| RS-350 walker: simulator stopped, lane chip | offline after 40 s; back online 32 s after the simulator returned, **no module restart** |
| Rapiscan portal: simulator stopped, lane chip | offline after 30 s; back 25 s after return |
| Rapiscan portal: 4-minute outage, past the lane's 11 connection attempts | ORNL gave up for good (RPM module left in ERROR). **Fixed** (modules 3fe11ea8, `RpmRecoverySupervisor`): data back 19 s after the simulator returned. Booting the node with the RPM unreachable for 5 min: node healthy, RPM initialised and started 3 s after the simulator came up |
| D5 walker: simulator stopped | **failed, fixed** (9f696271): the driver never reconnected and logged 2 ERRORs/s. Now 1→30 s backoff, one ERROR line, back without a restart |
| D5 lane occupancy state | **failed, fixed** (a563bf30): every D5 dailyFile event threw `Unknown item 'isOccupied'` on 3.11 |
| Mobile lane chips | **failed, fixed** (0bf55f0): false Extended Occupancy fault on walkers in long alarm episodes, plus four portal-only indicators stuck on "?" |
| Map: walker markers present and moving, map does not re-centre | pass |
| Map: unadjudicated walker alarm marker, popup → VIEW EVENT, Code 9 adjudication clears it | pass (cleared 30 s after the command, i.e. next refresh) |
| WebID `occupancyObsId` filter | node applies `filter=` server-side (`gammaAlarm=true` → 12 of 49; unknown field → 0, which triggers the viewer's fallback scan). No WebID results exist on the scratch node, so the match itself is not exercised |
| Live HLS: plays within 1 s of opening lane view | pass |
| Live HLS: 45 s RTSP cut on one camera (container netns only) | node: MediaMTX/FFmpeg reconnect in place and resume segments 3 s after the feed returns (pass). Viewer: **failed, fixed** (9621bc8): it stopped at a manual Retry; now it retries itself and resumed 40 s after the feed returned |
| Viewer component suite (electron) | **299/299 pass**, including the new mobile-lane and auto-retry tests |
| Mobile alarm triggers the dashboard alarm sound | **not run** at runtime (portal alarms from the mocks would confound it); covered by code review only |

### 3.11 configuration changes that matter for the live-node upgrade
- **Camera URLs:** a `CustomCameraConfig` now needs the RTSP port in `remoteHost` (`10.235.20.94:9001`) and a leading `/` in `streamPath` (`/cam1`). The live node's 3.5 form (`remoteHost: 10.235.20.94`, `streamPath: ":9001/cam1"`) builds `rtsp://10.235.20.94/:9001/cam1` and never connects. All four live cameras use the old form.
- **Lane names:** 12 characters at most, otherwise the lane fails to initialize.
- The D5 dailyFile schema change creates a second `dailyFile` datastream for existing D5 lanes. Only our forks have D5 lanes.

### ORNL upstream issues found (not ours, not fixed here)
- **Gateway `Host` header drops the port.** `docker/gateway/default.conf` forwards `Host $host`, so with `--port` other than 443 the backend's trailing-slash redirects (`/event-log` → `https://host/event-log/`) lose the port and every viewer route but `/` fails. The port-80 → HTTPS redirect drops it too. Fix: `$http_host`.
- **10 s hard wait for the Bucket Service.** `OSCARServiceModule.doInit` waits 10 s for the bucket service; on a loaded host it took 11 s. The OSCAR service then failed for good and the container stayed unhealthy (no readiness marker) until restarted. Seen once in about six boots.
- **RS-350 WebID attach race.** `RS350Sensor.doStart` can run before the OSCAR service has its WebID handler: `Could not attach WebID Analysis to RS350` (NPE). That walker then runs without WebID until restarted.
- **Portal RPMs give up after ~2 minutes.** `LaneSystem` sets `commSettings.connection.reconnectAttempts = 10` for every RPM type it builds (Rapiscan, Aspect, RS-350, D5 config paths). `RobustConnection` then throws "Maximum number of connection attempts reached" and the RPM module stays in ERROR until restarted by hand. A switch reboot or a cable pull longer than ~2 min takes a portal lane down for good. The live 3.5 node likely has the same default; not yet compared. **Fixed on our branch:** a per-lane `RpmRecoverySupervisor` restarts an auto-start RPM member that is LOADED/STOPPED *with an error* (30 s → 5 min backoff); an operator-stopped member has no error and is left alone.


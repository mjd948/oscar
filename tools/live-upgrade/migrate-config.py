#!/usr/bin/env python3
"""
Carry an OSCAR 3.5 node's lanes and site settings into a fresh OSCAR 3.11 config.json.

    python3 -I migrate-config.py --live 3.5/config.json --fresh 3.11/config.json --out new.json \
        [--video-retention-days 7|ornl] [--ocr-alarms-only|--ocr-all-occupancies] \
        [--rpm-host OLD=NEW ...] [--camera-host OLD=NEW ...]

Only lanes and the OSCAR service's site settings are taken from the 3.5 file. Everything else in
the fresh 3.11 file (database, journal, bucket, MQTT, security modules) is kept as 3.11 wrote it:
the 3.5 module list is not compatible with 3.11's storage profile.

Per lane (LaneConfig and MobileDetectorConfig):
  * kept: name, uniqueID (so system UIDs are unchanged), module id, autoStart, autoDelete,
    location, operationalViewKeys, extendedOccupancyThresholdMinutes, laneOptionsConfig (RPM
    endpoint, EML settings), detectorConfig (mobile), ocrConfig (known 3.11 fields only);
  * subsystems are left empty: LaneSystem rebuilds its RPM/camera members from laneOptionsConfig;
  * cameras: the 3.5 form remoteHost "h" + streamPath ":9001/cam1" becomes remoteHost "h:9001" +
    streamPath "/cam1". 3.11 joins them with a "/", so the old form never connects;
  * names longer than 12 characters are refused (3.11 will not initialize such a lane).

--rpm-host / --camera-host rewrite endpoints (a rehearsal points the RPMs at local simulators
instead of the site simulator the live node is attached to). The script prints a report and exits
non-zero on anything it cannot carry over safely.
"""
import argparse
import copy
import json
import sys

LANE = "com.botts.impl.system.lane"
LANE_CLASSES = {f"{LANE}.config.LaneConfig", f"{LANE}.mobile.config.MobileDetectorConfig"}
OSCAR_SERVICE = "com.botts.impl.service.oscar.OSCARServiceConfig"
CUSTOM_CAMERA = f"{LANE}.config.CustomCameraConfig"
MAX_LANE_NAME = 12

LANE_KEYS = ["objClass", "id", "name", "uniqueID", "autoStart", "autoDelete", "moduleClass",
             "location", "operationalViewKeys", "extendedOccupancyThresholdMinutes",
             "laneOptionsConfig", "detectorConfig"]
# OcrConfig fields in 3.11 (sensorhub-system-lane .../config/OcrConfig.java)
OCR_KEYS = ["objClass", "enabled", "alarmsOnly", "modelDir", "readContainerIds", "readPlates",
            "cameraUids", "framesPerVideo", "containerMinConfidence", "plateMinConfidence",
            "ignoreTopFraction", "ignoreBottomFraction"]
SERVICE_KEYS = ["nodeId", "webIdApiRoot", "statsFrequencyMinutes"]


class MigrationError(Exception):
    pass


def parse_map(pairs):
    out = {}
    for pair in pairs or []:
        if "=" not in pair:
            raise MigrationError(f"expected OLD=NEW, got {pair!r}")
        old, new = pair.split("=", 1)
        out[old] = new
    return out


def convert_camera(cam, camera_hosts, notes, lane):
    cam = copy.deepcopy(cam)
    host = cam.get("remoteHost") or ""
    path = cam.get("streamPath") or ""
    if cam.get("objClass") == CUSTOM_CAMERA and path.startswith(":"):
        port, _, rest = path[1:].partition("/")
        if not port.isdigit():
            raise MigrationError(f"{lane}: cannot parse camera streamPath {path!r}")
        cam["remoteHost"] = f"{host}:{port}"
        cam["streamPath"] = "/" + rest
        notes.append(f"{lane}: camera {host} {path!r} -> {cam['remoteHost']} {cam['streamPath']!r}")
    bare = cam["remoteHost"].split(":")[0]
    if bare in camera_hosts:
        cam["remoteHost"] = camera_hosts[bare] + cam["remoteHost"][len(bare):]
        notes.append(f"{lane}: camera host {bare} -> {camera_hosts[bare]} (rewrite)")
    return cam


def rewrite_rpm(rpm, rpm_hosts, notes, lane, label):
    if rpm and rpm.get("remoteHost") in rpm_hosts:
        old = rpm["remoteHost"]
        rpm["remoteHost"] = rpm_hosts[old]
        notes.append(f"{lane}: {label} host {old} -> {rpm['remoteHost']} (rewrite)")


def migrate_lane(module, args, rpm_hosts, camera_hosts, notes):
    name = module.get("name") or ""
    if len(name) > MAX_LANE_NAME:
        raise MigrationError(f"lane {name!r} is longer than {MAX_LANE_NAME} characters; rename it first")
    lane = {k: copy.deepcopy(module[k]) for k in LANE_KEYS if k in module}
    lane["subsystems"] = []

    options = lane.get("laneOptionsConfig") or {}
    rewrite_rpm(options.get("rpmConfig"), rpm_hosts, notes, name, "RPM")
    rewrite_rpm(lane.get("detectorConfig"), rpm_hosts, notes, name, "detector")
    if options.get("ffmpegConfig"):
        options["ffmpegConfig"] = [convert_camera(c, camera_hosts, notes, name) for c in options["ffmpegConfig"]]

    ocr = module.get("ocrConfig")
    if ocr:
        dropped = sorted(k for k in ocr if k not in OCR_KEYS)
        lane["ocrConfig"] = {k: copy.deepcopy(ocr[k]) for k in OCR_KEYS if k in ocr}
        if args.ocr_alarms_only is not None:
            lane["ocrConfig"]["alarmsOnly"] = args.ocr_alarms_only
        if dropped:
            notes.append(f"{name}: OCR fields not in 3.11 dropped: {', '.join(dropped)}")
    return lane


def migrate(live, fresh, args):
    rpm_hosts = parse_map(args.rpm_host)
    camera_hosts = parse_map(args.camera_host)
    notes = []

    lanes = [migrate_lane(m, args, rpm_hosts, camera_hosts, notes)
             for m in live if m.get("objClass") in LANE_CLASSES]
    if not lanes:
        raise MigrationError("no lanes found in the 3.5 config")
    ids = [lane["uniqueID"] for lane in lanes]
    if len(set(ids)) != len(ids):
        raise MigrationError(f"duplicate lane uniqueIDs: {ids}")

    out = [m for m in copy.deepcopy(fresh) if m.get("objClass") not in LANE_CLASSES]
    fresh_service = next((m for m in out if m.get("objClass") == OSCAR_SERVICE), None)
    live_service = next((m for m in live if m.get("objClass") == OSCAR_SERVICE), None)
    if fresh_service is None:
        raise MigrationError("the fresh 3.11 config has no OSCAR Service module")
    if live_service:
        for key in SERVICE_KEYS:
            if key in live_service:
                fresh_service[key] = live_service[key]
        notes.append("OSCAR service: copied " + ", ".join(k for k in SERVICE_KEYS if k in live_service))
    if args.video_retention_days != "ornl":
        days = int(args.video_retention_days)
        fresh_service.setdefault("videoRetentionConfig", {})["timeToRetention"] = days
        notes.append(f"OSCAR service: video retention timeToRetention = {days} days")
    else:
        notes.append("OSCAR service: video retention left at ORNL's 3.11 default")

    taken = {m.get("id") for m in out}
    for lane in lanes:
        if lane.get("id") in taken:
            raise MigrationError(f"module id {lane['id']} of lane {lane['name']} collides with a 3.11 module")
    out.extend(lanes)
    return out, notes, lanes


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", required=True, help="3.5 config.json")
    ap.add_argument("--fresh", required=True, help="config.json written by a fresh 3.11 init")
    ap.add_argument("--out", required=True)
    ap.add_argument("--video-retention-days", default="7",
                    help="days before clips are decimated, or 'ornl' to keep the 3.11 default (default 7, as on 3.5)")
    ocr = ap.add_mutually_exclusive_group()
    ocr.add_argument("--ocr-alarms-only", dest="ocr_alarms_only", action="store_const", const=True)
    ocr.add_argument("--ocr-all-occupancies", dest="ocr_alarms_only", action="store_const", const=False,
                     help="keep reading every occupancy, as 3.5 did (default)")
    ap.set_defaults(ocr_alarms_only=False)
    ap.add_argument("--rpm-host", action="append", metavar="OLD=NEW")
    ap.add_argument("--camera-host", action="append", metavar="OLD=NEW")
    args = ap.parse_args(argv)

    try:
        live = json.load(open(args.live))
        fresh = json.load(open(args.fresh))
        out, notes, lanes = migrate(live, fresh, args)
    except (MigrationError, OSError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)
    print(f"{len(lanes)} lanes carried over: " + ", ".join(f"{l['name']} ({l['uniqueID']})" for l in lanes))
    for note in notes:
        print("  " + note)
    return 0


if __name__ == "__main__":
    sys.exit(main())

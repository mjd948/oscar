#!/usr/bin/env python3
"""
Add the scratch-verification lanes to an OSCAR 3.11 config.json.

  python3 -I seed-scratch-lanes.py config.json config.new.json

Two Rapiscan portals (rapiscan_mock.py on 10100/10101, each with one RTSP camera) and two
mobile detector lanes (rs350_mock.py on 10110, d5_mock.py on 10111). Lanes already present by
name are left alone. Members are not written: LaneSystem builds them from laneOptionsConfig.

3.11 gotchas this encodes:
  * lane names must be 12 characters or fewer (LaneSystem refuses to initialize otherwise);
  * a CustomCameraConfig takes the RTSP port in remoteHost ("host:9001") and a leading "/" in
    streamPath. The 3.5 form (remoteHost "host", streamPath ":9001/cam1") now builds
    rtsp://host/:9001/cam1 and the camera never connects.

Environment: MOCK_HOST (default 172.18.0.1, the docker bridge gateway seen from the oscar
container), CAM_HOST (default 10.235.20.94, the RTSP sim box).
"""
import json
import os
import sys
import uuid

MOCK_HOST = os.environ.get("MOCK_HOST", "172.18.0.1")
CAM_HOST = os.environ.get("CAM_HOST", "10.235.20.94")
LANE = "com.botts.impl.system.lane"


def camera(port, path):
    return {"objClass": f"{LANE}.config.CustomCameraConfig", "remoteHost": f"{CAM_HOST}:{port}",
            "streamPath": path, "username": "", "password": "", "bufferSize": 0}


def portal(name, uid, rpm_port, lat, lon, cam_port, cam_path):
    return {
        "objClass": f"{LANE}.config.LaneConfig",
        "laneOptionsConfig": {
            "objClass": f"{LANE}.config.LaneOptionsConfig",
            "rpmConfig": {
                "objClass": f"{LANE}.config.RapiscanRPMConfig",
                "emlConfig": {"objClass": f"{LANE}.config.RapiscanRPMConfig$EMLConfig",
                              "emlEnabled": False, "isCollimated": False, "laneWidth": 4.6},
                "remoteHost": MOCK_HOST, "remotePort": rpm_port},
            "ffmpegConfig": [camera(cam_port, cam_path)]},
        "operationalViewKeys": ["scratch"],
        "uniqueID": uid, "autoDelete": True,
        "location": {"objClass": "org.sensorhub.api.sensor.PositionConfig$LLALocation",
                     "lat": lat, "lon": lon, "alt": 0.0},
        "subsystems": [], "id": str(uuid.uuid4()), "autoStart": True,
        "moduleClass": f"{LANE}.LaneSystem", "name": name}


def mobile(name, uid, rpm_class, port):
    rpm = {"objClass": f"{LANE}.config.{rpm_class}", "remoteHost": MOCK_HOST, "remotePort": port}
    return {
        "objClass": f"{LANE}.mobile.config.MobileDetectorConfig",
        "detectorConfig": dict(rpm),
        "laneOptionsConfig": {"objClass": f"{LANE}.config.LaneOptionsConfig", "rpmConfig": dict(rpm)},
        "operationalViewKeys": ["scratch"],
        "uniqueID": uid, "autoDelete": True, "subsystems": [], "id": str(uuid.uuid4()),
        "autoStart": True, "moduleClass": f"{LANE}.mobile.MobileDetectorSystem", "name": name}


def main(src, dst):
    cfg = json.load(open(src))
    names = {m.get("name") for m in cfg}
    lanes = [
        portal("Marshall", "SCR1", 10100, 38.88772704574456, -77.06768486467479, 9001, "/cam1"),
        portal("Selfridge", "SCR2", 10101, 38.8731, -77.0652, 9002, "/cam2"),
        mobile("Patrol 1", "PATROL1", "RS350RPMConfig", 10110),
        mobile("D5 Walker", "D5W1", "D5RPMConfig", 10111),
    ]
    for lane in lanes:
        assert len(lane["name"]) <= 12, lane["name"]
        if lane["name"] not in names:
            cfg.append(lane)
    for module in cfg:
        if module.get("objClass") == "org.sensorhub.ui.AdminUIConfig":
            forms = module.get("customForms", [])
            if not any(str(f.get("configClass", "")).endswith("MobileDetectorConfig") for f in forms):
                print("NOTE: Admin UI has no MobileDetectorConfig form; the walker lanes will use the generic form")
    json.dump(cfg, open(dst, "w"), indent=2)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

#!/usr/bin/env python3
"""python3 -I -m unittest discover -s tools/live-upgrade"""
import importlib.util
import json
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("migrate_config", os.path.join(HERE, "migrate-config.py"))
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)

LANE = "com.botts.impl.system.lane"
LIVE = [
    {"objClass": "org.sensorhub.impl.service.HttpServerConfig", "id": "http-35", "name": "HTTP Server"},
    {"objClass": mc.OSCAR_SERVICE, "id": "svc-35", "name": "OSCAR Service Module", "nodeId": "default",
     "webIdApiRoot": "https://webid.example/api", "statsFrequencyMinutes": 60,
     "videoRetentionConfig": {"timeToRetention": 7}},
    {"objClass": f"{LANE}.config.LaneConfig", "id": "lane-1", "name": "AFM Gate", "uniqueID": "NSDD1",
     "autoStart": True, "autoDelete": True, "moduleClass": f"{LANE}.LaneSystem",
     "location": {"lat": 38.8, "lon": -77.0, "alt": 0.0},
     "laneOptionsConfig": {
         "rpmConfig": {"objClass": f"{LANE}.config.RapiscanRPMConfig", "remoteHost": "10.0.0.94", "remotePort": 10101},
         "ffmpegConfig": [{"objClass": mc.CUSTOM_CAMERA, "remoteHost": "10.0.0.94", "streamPath": ":9004/cam4"}]},
     "ocrConfig": {"enabled": True, "framesPerVideo": 8, "plateAutofillConfidence": 0.85},
     "lastUpdated": "2026-05-08", "subsystems": [{"config": {"name": "AFM Gate - RPM"}}]},
    {"objClass": f"{LANE}.mobile.config.MobileDetectorConfig", "id": "lane-5", "name": "Patrol 1",
     "uniqueID": "PATROL1", "moduleClass": f"{LANE}.mobile.MobileDetectorSystem",
     "detectorConfig": {"remoteHost": "10.0.0.94", "remotePort": 10110},
     "laneOptionsConfig": {"rpmConfig": {"remoteHost": "10.0.0.94", "remotePort": 10110}}},
]
FRESH = [
    {"objClass": "org.sensorhub.impl.service.HttpServerConfig", "id": "http-311", "name": "HTTP Server"},
    {"objClass": mc.OSCAR_SERVICE, "id": "svc-311", "name": "OSCAR Service Module", "nodeId": "default",
     "videoRetentionConfig": {"timeToRetention": 0, "frameRetentionCount": 5}},
]


def run(*extra, live=LIVE, fresh=FRESH):
    with tempfile.TemporaryDirectory() as d:
        paths = {k: os.path.join(d, f"{k}.json") for k in ("live", "fresh", "out")}
        json.dump(live, open(paths["live"], "w"))
        json.dump(fresh, open(paths["fresh"], "w"))
        rc = mc.main(["--live", paths["live"], "--fresh", paths["fresh"], "--out", paths["out"], *extra])
        return rc, (json.load(open(paths["out"])) if rc == 0 else None)


class MigrateConfigTest(unittest.TestCase):
    def test_keeps_3_11_modules_and_carries_lanes(self):
        rc, out = run()
        self.assertEqual(rc, 0)
        ids = [m["id"] for m in out]
        self.assertIn("http-311", ids)
        self.assertNotIn("http-35", ids)
        lane = next(m for m in out if m["name"] == "AFM Gate")
        self.assertEqual(lane["uniqueID"], "NSDD1")
        self.assertEqual(lane["subsystems"], [])
        self.assertNotIn("lastUpdated", lane)

    def test_converts_3_5_camera_form(self):
        _, out = run()
        cam = next(m for m in out if m["name"] == "AFM Gate")["laneOptionsConfig"]["ffmpegConfig"][0]
        self.assertEqual((cam["remoteHost"], cam["streamPath"]), ("10.0.0.94:9004", "/cam4"))

    def test_ocr_and_service_settings(self):
        _, out = run()
        ocr = next(m for m in out if m["name"] == "AFM Gate")["ocrConfig"]
        self.assertNotIn("plateAutofillConfidence", ocr)
        self.assertIs(ocr["alarmsOnly"], False)
        svc = next(m for m in out if m["objClass"] == mc.OSCAR_SERVICE)
        self.assertEqual(svc["id"], "svc-311")
        self.assertEqual(svc["webIdApiRoot"], "https://webid.example/api")
        self.assertEqual(svc["videoRetentionConfig"], {"timeToRetention": 7, "frameRetentionCount": 5})
        _, out = run("--ocr-alarms-only", "--video-retention-days", "ornl")
        self.assertIs(next(m for m in out if m["name"] == "AFM Gate")["ocrConfig"]["alarmsOnly"], True)
        self.assertEqual(next(m for m in out if m["objClass"] == mc.OSCAR_SERVICE)["videoRetentionConfig"]["timeToRetention"], 0)

    def test_rehearsal_host_rewrites_touch_only_their_kind(self):
        _, out = run("--rpm-host", "10.0.0.94=172.18.0.1")
        afm = next(m for m in out if m["name"] == "AFM Gate")
        patrol = next(m for m in out if m["name"] == "Patrol 1")
        self.assertEqual(afm["laneOptionsConfig"]["rpmConfig"]["remoteHost"], "172.18.0.1")
        self.assertEqual(afm["laneOptionsConfig"]["ffmpegConfig"][0]["remoteHost"], "10.0.0.94:9004")
        self.assertEqual(patrol["detectorConfig"]["remoteHost"], "172.18.0.1")
        self.assertEqual(patrol["laneOptionsConfig"]["rpmConfig"]["remoteHost"], "172.18.0.1")

    def test_refuses_long_names_and_collisions(self):
        long_name = [dict(LIVE[2], name="Memorial Avenue")]
        self.assertEqual(run(live=long_name)[0], 1)
        clash = [dict(LIVE[2], id="svc-311")]
        self.assertEqual(run(live=clash)[0], 1)


if __name__ == "__main__":
    unittest.main()

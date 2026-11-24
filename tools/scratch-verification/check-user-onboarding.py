#!/usr/bin/env python3
"""Check that a newly created user can actually get in (safe on live: it cleans up after itself).

Creates a throwaway account, then checks every credential the Users page shows an admin:
  - the QR invite from account creation opens the enrollment page;
  - the row's "QR & Invite" returns an invite that opens it (and the earlier one is revoked);
  - the temporary password from "Reset password" signs in, and so does its invite;
  - sign-in ignores letter case, and a case-only duplicate account is refused.
It never consumes an invite. The account is deleted at the end, even when a check fails.

  OSCAR_BASE=https://<host> PW_FILE=<admin password file> python3 -I check-user-onboarding.py

Before the 2026-11-24 fix every /sensorhub/session call ran twice, so the row's invite and the
reset password were already dead when shown (enrollment page 410, sign-in 401).
"""
import base64
import http.cookiejar
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("OSCAR_BASE", "https://localhost").rstrip("/")
PASSWORD = open(os.environ["PW_FILE"]).read().strip()
PROBE = os.environ.get("PROBE_USER", "zzprobe")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def client():
    return urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=CTX),
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        _NoRedirect())


def call(op, method, path, body=None, form=None, headers=None):
    h = {"Accept": "application/json"}
    data = None
    if body is not None or method in ("POST", "PUT", "DELETE"):
        data = json.dumps(body if body is not None else {}).encode()
        h["Content-Type"] = "application/json"
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        h.update({"Content-Type": "application/x-www-form-urlencoded", "Accept": "text/html"})
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        r = op.open(req, timeout=60)
        return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


failures = []


def check(ok, msg):
    print("PASS" if ok else "FAIL", msg)
    if not ok:
        failures.append(msg)


def enroll_status(token):
    st, _, _ = call(client(), "GET", "/login/enroll?token=" + urllib.parse.quote(token), headers={"Accept": "text/html"})
    return st


def sign_in(username, password):
    st, _, h = call(client(), "POST", "/login", form={"username": username, "password": password})
    return st, h.get("Location") or ""


basic = "Basic " + base64.b64encode(f"admin:{PASSWORD}".encode()).decode()
admin = client()
st, _, _ = call(admin, "GET", "/sensorhub/api/systems?limit=1", headers={"Authorization": basic})
check(st == 200, f"admin Basic sign-in to the API ({st})")
st, b, _ = call(admin, "GET", "/sensorhub/session/admin/overview")
if st != 200:
    sys.exit(f"cannot read the admin overview ({st})")
if any(u["username"].lower() == PROBE.lower() for u in json.loads(b)["users"]):
    sys.exit(f"an account named {PROBE} already exists; refusing to touch it")

try:
    st, b, _ = call(admin, "POST", "/sensorhub/session/admin/users",
                    {"username": PROBE, "displayName": "Onboarding probe", "role": "viewer", "mustChangePassword": True})
    check(st == 201, f"create {PROBE} ({st})")
    created = json.loads(b)
    check(enroll_status(created["inviteToken"]) == 200, "invite from account creation opens the enrollment page")

    st, b, _ = call(admin, "POST", f"/sensorhub/session/admin/users/{PROBE}/invite", {"inviteExpiresInHours": 168})
    row_invite = json.loads(b)["inviteToken"]
    check(enroll_status(row_invite) == 200, "the row's QR & Invite opens the enrollment page")
    check(enroll_status(created["inviteToken"]) == 410, "the earlier invite is revoked by the newer one")

    st, b, _ = call(admin, "POST", f"/sensorhub/session/admin/users/{PROBE}/reset-password", {"mustChangePassword": True})
    reset = json.loads(b)
    check(enroll_status(reset["inviteToken"]) == 200, "the invite from Reset password opens the enrollment page")
    for typed in (PROBE, PROBE.upper(), PROBE.capitalize()):
        st, loc = sign_in(typed, reset["temporaryPassword"])
        check(st == 302 and "/login/password-change" in loc,
              f"sign in as '{typed}' with the reset temporary password ({st} {loc[:40]})")
    st, _ = sign_in(PROBE, reset["temporaryPassword"] + "x")
    check(st == 401, f"a wrong password is still refused ({st})")

    st, b, _ = call(admin, "POST", "/sensorhub/session/admin/users", {"username": PROBE.upper(), "role": "viewer"})
    check(st == 400 and b"already exists" in b, f"a case-only duplicate account is refused ({st})")
    if st == 201:
        call(admin, "DELETE", f"/sensorhub/session/admin/users/{PROBE.upper()}")
finally:
    st, _, _ = call(admin, "DELETE", f"/sensorhub/session/admin/users/{PROBE}")
    check(st == 200, f"delete {PROBE} ({st})")
    st, b, _ = call(admin, "GET", "/sensorhub/session/admin/overview")
    left = [u["username"] for u in json.loads(b)["users"]] if st == 200 else []
    check(st == 200 and all(u.lower() != PROBE.lower() for u in left), f"no probe account left ({left})")
    call(admin, "GET", "/logout")

print(f"{len(failures)} failure(s)")
sys.exit(1 if failures else 0)

#!/usr/bin/env python3
"""Prepare a new release dir's .env (copied from the live dir) before any build or upgrade.

    python3 -I merge-env.py <new-dir>/.env <new-dir>/.env.example

- Sets OSCAR_VERSION to the new release's version (from .env.example). With the copied old
  version, a pre-build would overwrite the running release's image tags.
- OSCAR_JAVA_OPTS is a carried key, so ORNL's flag changes never arrive on their own: every
  flag in the new .env.example's OSCAR_JAVA_OPTS that ours lacks is added. Our -Xms/-Xmx and
  any flag we already set (by name) are kept.
- Prints keys that are in .env.example but missing from .env; carry those over by hand with
  ORNL's defaults.
"""
import re
import sys


def read(path):
    with open(path) as f:
        return f.read().split("\n")


def value(lines, key):
    for line in lines:
        if line.startswith(key + "="):
            return line[len(key) + 1:]
    return None


def flag_name(flag):
    if flag.startswith(("-Xms", "-Xmx", "-Xss")):
        return flag[:4]
    return re.sub(r"^-XX:[+-]?", "-XX:", flag).split("=", 1)[0]


def main(env_path, example_path):
    env, example = read(env_path), read(example_path)
    version = value(example, "OSCAR_VERSION")
    if not version:
        sys.exit("no OSCAR_VERSION in " + example_path)
    ours = (value(env, "OSCAR_JAVA_OPTS") or "").split()
    theirs = (value(example, "OSCAR_JAVA_OPTS") or "").split()
    have = {flag_name(f) for f in ours}
    added = [f for f in theirs if flag_name(f) not in have]
    if ours and ours[-1].startswith("-XX:+HeapDump"):
        merged = ours[:-1] + added + ours[-1:]
    else:
        merged = ours + added
    out = []
    for line in env:
        if line.startswith("OSCAR_VERSION="):
            line = "OSCAR_VERSION=" + version
        elif line.startswith("OSCAR_JAVA_OPTS=") and added:
            line = "OSCAR_JAVA_OPTS=" + " ".join(merged)
        out.append(line)
    with open(env_path, "w") as f:
        f.write("\n".join(out))
    keys = lambda lines: {l.split("=", 1)[0] for l in lines if re.match(r"^[A-Z_]+=", l)}
    print("OSCAR_VERSION=" + version)
    print("added Java flags:", " ".join(added) or "(none)")
    missing = sorted(keys(example) - keys(env))
    print("keys in .env.example missing from .env:", " ".join(missing) or "(none)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])

#!/usr/bin/env bash
# Install (or update) the nightly job from this directory. Safe to re-run.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
install -d -m 755 /usr/local/lib/oscar-nightly /var/lib/oscar-nightly /var/log/oscar-nightly
install -d -m 700 /etc/oscar-nightly
install -m 755 "$here/nightly-upstream.sh" /usr/local/sbin/oscar-nightly-upstream
install -m 644 "$here/RUNBOOK.md" /usr/local/lib/oscar-nightly/RUNBOOK.md
install -m 644 "$here/oscar-nightly-upstream.service" "$here/oscar-nightly-upstream.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now oscar-nightly-upstream.timer
systemctl list-timers oscar-nightly-upstream.timer --no-pager

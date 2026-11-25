#!/usr/bin/env bash
# One-time: create a long-lived Claude sign-in token for the unattended job.
# Step 1 prints a link; open it, approve, and the token is printed. Step 2 asks you to paste it.
set -euo pipefail
claude setup-token
echo
read -rsp "Paste the token it printed (starts with sk-ant-oat), then Enter: " tok; echo
case $tok in sk-ant-*) ;; *) echo "That does not look like a token; nothing saved."; exit 1;; esac
install -d -m 700 /etc/oscar-nightly
umask 077; printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$tok" >/etc/oscar-nightly/claude.env
env -i HOME=/root PATH=/usr/bin:/bin CLAUDE_CODE_OAUTH_TOKEN="$tok" claude -p "Reply with exactly: ok" --max-turns 1
echo "Saved. (If it printed ok, the nightly job can sign in.)"

# Nightly ORNL catch-up

Every night at 3:00 am US Eastern, a systemd timer (`oscar-nightly-upstream.timer`) checks
whether ORNL has published an OSCAR release that `ornl-3.11-rollin` doesn't contain yet.
- **Nothing new:** it exits in about a second. No Claude, no email.
- **A new release:** it runs Claude Code headless with [RUNBOOK.md](RUNBOOK.md): merge, test,
  build, rehearse in dind, deploy, then roll back automatically if live isn't healthy. It then
  emails the summary.
- **A merge conflict or failed tests:** it stops with live untouched and emails.

The work happens in a dedicated checkout, `/root/oscar-nightly`, so a run never disturbs
`/root/osh-oakridge-buildnode`. After a successful night, pull this checkout and update its
submodules.

## One-time setup
```bash
bash setup-claude-token.sh   # long-lived Claude sign-in for unattended runs
bash setup-email.sh          # Gmail app password → postfix relay, sends a test email
bash install.sh              # installs/updates the script, runbook and timer (re-run after edits)
```

## Day to day
| what | how |
|---|---|
| next run | `systemctl list-timers oscar-nightly-upstream.timer` |
| skip tonight | `touch /run/oscar-maintenance.lock` (cleared by a reboot) |
| turn off | `systemctl disable --now oscar-nightly-upstream.timer` |
| dry run (no deploy, no push) | `oscar-nightly-upstream --no-deploy --force-tag v3.11.15` |
| retry a release that failed | `oscar-nightly-upstream --force-tag vX.Y.Z` |
| logs | `/var/log/oscar-nightly/<run>/` (`wrapper.log`, `claude.jsonl`, `summary.md`) |
| releases already tried | `/var/lib/oscar-nightly/attempted` (each tag is tried once) |

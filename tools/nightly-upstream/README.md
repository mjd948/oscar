# Nightly ORNL catch-up

Every night at 3:00 am US Eastern, a systemd timer (`oscar-nightly-upstream.timer`) checks
whether ORNL has published an OSCAR release that `ornl-3.11-rollin` doesn't contain yet.
- **Nothing new:** it exits in about a second. No Claude, no email.
- **A new release:** it runs Claude Code headless with [RUNBOOK.md](RUNBOOK.md): merge, test,
  build, rehearse in dind, deploy, then roll back automatically if live isn't healthy. It then
  emails the summary.
- **A merge conflict or failed tests:** it stops with live untouched and emails.
- **Rollback** after a 3.12+ upgrade means restoring the cold snapshot taken just before it
  (`tools/live-upgrade/state-snapshot.sh`, under `/opt/oscar/snapshots/`). Starting the old
  release dir on upgraded volumes stops all ingest.

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
| dry run (no deploy, no push) | `oscar-nightly-upstream --no-deploy --force-tag v3.12.2` |
| retry a release that failed | `oscar-nightly-upstream --force-tag vX.Y.Z` |
| logs | `/var/log/oscar-nightly/<run>/` (`wrapper.log`, `claude.jsonl`, `summary.md`) |
| releases already tried | `/var/lib/oscar-nightly/attempted` (each tag is tried once) |

## Fork-first changes (our own fixes and features)
On 2026-11-28 the `ornl-3.11-rollin` branches were re-synced to ORNL 3.12.2. They now equal ORNL
plus our tools and a short list of our own changes. The user tests those on live before
offering them to ORNL. The branch name stayed, to keep this job, `.gitmodules` and old tags
working.

1. **Start from ORNL.** Create the change on its own branch in the submodule it belongs to,
   started from ORNL's latest `main` (`OSCAR` in osh-core): `fix/<topic>` or `feat/<topic>`.
   Push it to `my-fork`. Starting from ORNL keeps a later PR clean.
2. **Test it on live.** Merge the branch into `ornl-3.11-rollin` with `--no-ff`, bump the
   submodule pin in the parent, then build, rehearse and deploy it as `v<ver>-mjd948.N`. The
   user tests it there.
3. **Offer it to ORNL** only when the user says so: open the PR from the same branch, rebased
   onto ORNL's newest `main` if needed.
4. **When ORNL ships it,** the nightly merge takes it in by itself. If ORNL changed it, the
   merge conflicts and the job stops and emails. Then take ORNL's version, and re-apply only
   what is still missing.

| Fork-first branch | Repo | What it does | Upstream |
|---|---|---|---|
| `fix/rs350-summary-card-counts` | oscar-viewer | RS-350 gamma/neutron counts on the mobile summary card | not yet offered |

Also carried, test-only: `SharedReceiveDataTest.java` (modules, D5 EOF handling), and the
mobile-lane case in `DashboardLaneHealth.cy.tsx` (viewer).

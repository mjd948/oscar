#!/usr/bin/env bash
# Cold snapshot / restore of an OSCAR Compose deployment's persistent state:
# the oscar_oscar_state and oscar_postgres_data volumes plus the archive bind mount.
#
# Why: from 3.12.0 on, an upgrade rewrites storage routing in PostgreSQL (the RS-350 / D5
# "alarm" and "location" streams become archive-only), and an older release started on those
# volumes fails every write batch. Rolling back therefore means restoring this snapshot, not
# just starting the previous release directory again (ORNL docs/ARCHIVE_FORMAT.md: "In-place
# storage-schema downgrade is unsupported").
#
# The stack must be stopped (no running oscar-* container) for both commands, so the copy is
# consistent. Run as root on the host, or inside a rehearsal dind container.
#
#   state-snapshot.sh take    <dest-dir> --archive-dir <dir> [--docker-root /var/lib/docker]
#   state-snapshot.sh restore <dest-dir> --archive-dir <dir> [--docker-root /var/lib/docker]
#   state-snapshot.sh verify  <dest-dir>
#
# restore moves the current data aside (<path>.pre-restore-<UTC time>) instead of deleting it.
set -Eeuo pipefail

VOLUMES=(oscar_oscar_state oscar_postgres_data)
die() { printf 'state-snapshot: %s\n' "$*" >&2; exit 1; }
log() { printf '%s state-snapshot: %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

cmd=${1:-}; dest=${2:-}
[[ $cmd =~ ^(take|restore|verify)$ && -n $dest ]] || die "usage: $0 take|restore|verify <dest-dir> --archive-dir <dir> [--docker-root <dir>]"
shift 2
archive_dir=""; docker_root=/var/lib/docker
while (($#)); do
  case $1 in
    --archive-dir) archive_dir=${2:?}; shift 2 ;;
    --docker-root) docker_root=${2:?}; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
[[ $(id -u) = 0 ]] || die "run as root (the volumes are owned by container users)"

verify() {
  [[ -f $dest/SHA256SUMS ]] || die "$dest/SHA256SUMS missing"
  (cd "$dest" && sha256sum --quiet -c SHA256SUMS) || die "checksum mismatch in $dest"
  for f in "$dest"/*.tar; do tar -tf "$f" >/dev/null || die "unreadable $f"; done
  log "verified $dest"
}
[[ $cmd = verify ]] && { verify; exit 0; }

[[ -n $archive_dir ]] || die "--archive-dir is required"
archive_dir=$(realpath -m "$archive_dir")
case $archive_dir in /|/opt|/var|/root|/srv) die "refusing archive dir $archive_dir" ;; esac
running=$(docker ps --format '{{.Names}}' | grep -E '^oscar-(oscar|postgres|gateway)-[0-9]+$' || true)
[[ -z $running ]] || die "stop the stack first; still running: $(echo $running)"
vol_path() { echo "$docker_root/volumes/$1/_data"; }

if [[ $cmd = take ]]; then
  [[ ! -e $dest ]] || die "$dest already exists; pick a new name"
  for v in "${VOLUMES[@]}"; do [[ -d $(vol_path "$v") ]] || die "volume $v not found under $docker_root"; done
  [[ -d $archive_dir ]] || die "archive dir $archive_dir missing"
  mkdir -p -m 700 "$dest"
  for v in "${VOLUMES[@]}"; do
    log "copying volume $v"
    tar --numeric-owner -cpf "$dest/$v.tar" -C "$(vol_path "$v")" .
  done
  log "copying archive dir $archive_dir"
  tar --numeric-owner -cpf "$dest/archive.tar" -C "$archive_dir" .
  printf 'taken_utc=%s\narchive_dir=%s\ndocker_root=%s\n' "$(date -u +%FT%TZ)" "$archive_dir" "$docker_root" >"$dest/SNAPSHOT_INFO"
  (cd "$dest" && sha256sum ./*.tar SNAPSHOT_INFO >SHA256SUMS)
  verify
  du -sh "$dest" | awk '{print "state-snapshot: size " $1}'
  exit 0
fi

# restore
verify
ts=$(date -u +%Y%m%dT%H%M%SZ)
restore_into() { # tarball target-dir
  local tarball=$1 target=$2 mode owner
  mode=$(stat -c %a "$target"); owner=$(stat -c %u:%g "$target")
  mv "$target" "$target.pre-restore-$ts"
  mkdir "$target"; chmod "$mode" "$target"; chown "$owner" "$target"
  tar --numeric-owner -xpf "$tarball" -C "$target"
  log "restored $target (previous contents kept in $target.pre-restore-$ts)"
}
for v in "${VOLUMES[@]}"; do restore_into "$dest/$v.tar" "$(vol_path "$v")"; done
restore_into "$dest/archive.tar" "$archive_dir"
log "restore complete; start the previous release dir with: bash oscar.sh start"

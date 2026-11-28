#!/usr/bin/env bash
# mockctl.sh start|stop <name>   (names: rs350 d5 rapiscan10100..rapiscan10103)
D=${MOCK_STATE_DIR:-/tmp/oscar-mocks}; mkdir -p "$D"
M=$(cd "$(dirname "${BASH_SOURCE[0]}")/../mobile-detector-mocks" && pwd)
case $2 in
  # Our site's loop (near the portal lanes), so walker movement shows on a map fitted to the lanes.
  rs350) cmd=(python3 -I $M/rs350_mock.py --port 10110 --config $M/site-loop.json) ;;
  d5) cmd=(python3 -I $M/d5_mock.py --port 10111) ;;
  rapiscan10100) cmd=(python3 -I $M/rapiscan_mock.py --port 10100 --occ-every 45) ;;
  rapiscan10101) cmd=(python3 -I $M/rapiscan_mock.py --port 10101 --occ-every 60 --first-occ 30) ;;
  rapiscan10102) cmd=(python3 -I $M/rapiscan_mock.py --port 10102 --occ-every 50 --first-occ 20) ;;
  rapiscan10103) cmd=(python3 -I $M/rapiscan_mock.py --port 10103 --occ-every 70 --first-occ 40) ;;
  *) echo "unknown mock $2" >&2; exit 2 ;;
esac
pidf=$D/$2.pid
case $1 in
  start) if [[ -f $pidf ]] && kill -0 "$(cat $pidf)" 2>/dev/null; then echo "$2 already running $(cat $pidf)"; exit 0; fi
         ( cd $D && exec nohup "${cmd[@]}" >> $D/$2.log 2>&1 ) & echo $! > $pidf; echo "$2 started $(cat $pidf)" ;;
  stop)  [[ -f $pidf ]] && kill "$(cat $pidf)" 2>/dev/null; rm -f $pidf; echo "$2 stopped" ;;
esac

#!/usr/bin/env python3
"""
Rapiscan portal monitor (RPM) simulator for scratch/verification nodes.

Emulates the device side of sensorhub-driver-rapiscan: a TCP *server* that pushes
newline-terminated CSV lines once a client connects (the driver never writes).

  idle:       GB,<g1..g4> and NB,<n1..n4> once per second (background)
  occupancy:  GS (or GA when alarming) at 5 Hz plus NS (or NA) at 1 Hz,
              closed by GX,<occupancyCount>,<neutronBackground*1000>
  tamper:     TC on connect

Every --occ-every seconds a vehicle passes for --occ-len seconds; every
--alarm-every'th occupancy is a gamma alarm (every 2*alarm-every'th also neutron).
Each connected client gets its own independent stream, so several nodes can share
one mock without stealing data from each other.

Stdlib only. Usage:
    python3 rapiscan_mock.py --port 10100 [--occ-every 45] [--occ-len 8] [--alarm-every 3]
"""
import argparse
import random
import socket
import threading
import time


def poisson(lam):
    # Knuth for small lambda, normal approximation for large.
    if lam > 50:
        return max(0, int(random.gauss(lam, lam ** 0.5)))
    limit, k, p = pow(2.718281828, -lam), 0, 1.0
    while True:
        p *= random.random()
        if p <= limit:
            return k
        k += 1


def line(tag, values):
    return (tag + "," + ",".join("%06d" % v for v in values) + "\r\n").encode()


def serve(conn, addr, args):
    print(f"[{args.port}] client {addr} connected", flush=True)
    occ_count = 0
    try:
        conn.sendall(b"TC,000000,000000,000000,000000\r\n")
        next_occ = time.monotonic() + args.first_occ
        while True:
            now = time.monotonic()
            if now >= next_occ:
                occ_count += 1
                gamma_alarm = args.alarm_every > 0 and occ_count % args.alarm_every == 0
                neutron_alarm = args.alarm_every > 0 and occ_count % (2 * args.alarm_every) == 0
                ticks = int(args.occ_len * 5)
                for i in range(ticks):
                    rate = args.bg_gamma / 5.0 * (args.alarm_factor if gamma_alarm else 1.05)
                    conn.sendall(line("GA" if gamma_alarm else "GS", [poisson(rate) for _ in range(4)]))
                    if i % 5 == 0:
                        nrate = args.bg_neutron * (12 if neutron_alarm else 1)
                        conn.sendall(line("NA" if neutron_alarm else "NS", [poisson(nrate) for _ in range(4)]))
                    time.sleep(0.2)
                conn.sendall(f"GX,{occ_count:06d},{int(args.bg_neutron * 4000):06d}\r\n".encode())
                print(f"[{args.port}] occupancy {occ_count} gammaAlarm={gamma_alarm} neutronAlarm={neutron_alarm}",
                      flush=True)
                next_occ = time.monotonic() + args.occ_every
                continue
            conn.sendall(line("GB", [poisson(args.bg_gamma) for _ in range(4)]))
            conn.sendall(line("NB", [poisson(args.bg_neutron) for _ in range(4)]))
            time.sleep(1.0)
    except (BrokenPipeError, ConnectionResetError, OSError) as e:
        print(f"[{args.port}] client {addr} gone: {e}", flush=True)
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=10100)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--bg-gamma", type=float, default=300.0, help="per-detector gamma cps")
    ap.add_argument("--bg-neutron", type=float, default=1.0, help="per-detector neutron cps")
    ap.add_argument("--alarm-factor", type=float, default=4.0)
    ap.add_argument("--first-occ", type=float, default=15.0)
    ap.add_argument("--occ-every", type=float, default=45.0)
    ap.add_argument("--occ-len", type=float, default=8.0)
    ap.add_argument("--alarm-every", type=int, default=3)
    args = ap.parse_args()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.bind, args.port))
    srv.listen(8)
    print(f"Rapiscan mock listening on {args.bind}:{args.port}", flush=True)
    while True:
        conn, addr = srv.accept()
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        threading.Thread(target=serve, args=(conn, addr, args), daemon=True).start()


if __name__ == "__main__":
    main()

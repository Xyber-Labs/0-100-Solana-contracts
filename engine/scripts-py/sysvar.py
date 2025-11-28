#!/usr/bin/env python3

import base64
import os
import struct
import sys
from time import sleep
import requests

RPC_URL = os.environ.get("RPC_URL", "http://127.0.0.1:8899/")
SLOT_HASHES_PUBKEY = "SysvarS1otHashes111111111111111111111111111"
COMMITMENT = "processed"  # can be: processed | confirmed | finalized
LIMIT = 32  # how many entries to show from the beginning (newest first)

def rpc(method, params):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    r = requests.post(RPC_URL, json=payload, timeout=5)
    r.raise_for_status()
    j = r.json()
    if "error" in j:
        raise RuntimeError(j["error"])
    return j["result"]

def get_account_binary(pubkey, commitment="processed"):
    res = rpc("getAccountInfo", [pubkey, {"encoding": "base64", "commitment": commitment}])
    val = res.get("value")
    if not val or not val.get("data"):
        raise RuntimeError("empty account data")
    data_field = val["data"]
    # data can be ["<base64>", "base64"] or just "<base64>"
    if isinstance(data_field, list):
        b64 = data_field[0]
    else:
        b64 = data_field
    return base64.b64decode(b64)

def parse_slot_hashes(data: bytes):
    if len(data) < 8:
        raise ValueError("short data (<8 bytes)")
    (n,) = struct.unpack_from("<Q", data, 0)  # u64 LE
    expected = 8 + n * 40
    if len(data) < expected:
        raise ValueError(f"truncated: have={len(data)} need={expected}")
    entries = []
    off = 8
    for _ in range(n):
        slot, = struct.unpack_from("<Q", data, off); off += 8
        h = data[off:off+32]; off += 32
        entries.append((slot, h))
    return entries  # order: newest first

def main():
    try:
        raw = get_account_binary(SLOT_HASHES_PUBKEY, COMMITMENT)
    except Exception as e:
        print(f"RPC error: {e}", file=sys.stderr)
        sys.exit(1)

    entries = parse_slot_hashes(raw)
    total = len(entries)
    print(f"num_hashes={total}")
    if total == 0:
        return

    first_slot = entries[0][0]
    last_slot  = entries[-1][0]
    print(f"freshest_slot={first_slot}, oldest_slot={last_slot}")

    lim = min(LIMIT, total)
    print(f"\nFirst {lim} entries (freshest first):")
    for i in range(lim):
        slot, h = entries[i]
        print(f"{i:3d}: slot={slot} hash=0x{h.hex()}")

if __name__ == "__main__":
    for _ in range(10):
        main()
        sleep(1)
#!/usr/bin/env python3
"""Extract a compact "sparse" SD image for the web build.

The shipped SD card image (emulator/Data/sd.zip) decompresses to a 2 GB raw
image (sd.001) that is almost entirely zeros. We cannot fetch 2 GB in a browser
or allocate it in WASM, so this tool streams the image straight out of the zip
and emits only the non-zero 512-byte sectors in a compact container the web
bridge can load into a lazily-allocated sector map.

Output format (little-endian), web/data/sd.sparse:
    magic    : 4 bytes  "SDSP"
    secSize  : uint32   bytes per sector (512)
    secCount : uint32   total logical sectors (image size / secSize)
    entries  : uint32   number of non-zero sectors that follow
    then `entries` records of:
        index : uint32  sector index
        data  : secSize bytes

Usage:
    python make_sd_sparse.py [path-to-sd.zip] [output-path]
Defaults match the repo layout when run from web/.
"""
import os
import struct
import sys
import time
import zipfile

SEC = 512
ZERO = b"\x00" * SEC
CHUNK = 8 * 1024 * 1024  # 8 MB read window (multiple of SEC)

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ZIP = os.path.normpath(os.path.join(HERE, "..", "emulator", "Data", "sd.zip"))
DEFAULT_OUT = os.path.join(HERE, "data", "sd.sparse")


def main():
    zip_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ZIP
    out_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT

    if not os.path.isfile(zip_path):
        print(f"error: SD zip not found: {zip_path}", file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    t0 = time.time()
    with zipfile.ZipFile(zip_path) as z:
        # The image is the single (largest) entry in the archive.
        name = max(z.infolist(), key=lambda i: i.file_size).filename
        total_sectors = 0
        entries = []  # (index, bytes)
        carry = b""
        with z.open(name) as f:
            idx = 0
            while True:
                buf = f.read(CHUNK)
                if not buf:
                    break
                if carry:
                    buf = carry + buf
                    carry = b""
                n = len(buf) // SEC
                rem = len(buf) - n * SEC
                if rem:
                    carry = buf[n * SEC:]
                for i in range(n):
                    s = buf[i * SEC:(i + 1) * SEC]
                    if s != ZERO:
                        entries.append((idx, s))
                    idx += 1
                total_sectors = idx

    logical = total_sectors * SEC
    with open(out_path, "wb") as g:
        g.write(b"SDSP")
        g.write(struct.pack("<III", SEC, total_sectors, len(entries)))
        for idx, s in entries:
            g.write(struct.pack("<I", idx))
            g.write(s)

    out_size = 16 + len(entries) * (4 + SEC)
    dt = time.time() - t0
    print(f"image: {name}  logical={logical} bytes ({logical/1024/1024:.0f} MB), "
          f"{total_sectors} sectors")
    print(f"non-zero sectors: {len(entries)}")
    print(f"wrote {out_path}  ({out_size} bytes, {out_size/1024/1024:.2f} MB) in {dt:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())

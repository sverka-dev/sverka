// tar.ts — ustar pack/unpack round-trip.

import { describe, it, expect } from "vitest";
import { packTar, unpackTar } from "../internal/tar.js";
import type { TarEntry } from "../internal/tar.js";

describe("tar pack/unpack", () => {
  it("round-trips files, dirs, and symlinks", () => {
    const entries: TarEntry[] = [
      { name: "dir", type: "dir" },
      {
        name: "dir/file.txt",
        type: "file",
        data: new TextEncoder().encode("hello"),
        mtime: 1_700_000_000,
      },
      { name: "dir/link", type: "symlink", linkname: "file.txt" },
      { name: "empty.txt", type: "file", data: new Uint8Array(0) },
    ];
    const unpacked = unpackTar(packTar(entries));
    expect(unpacked).toHaveLength(4);
    expect(unpacked[0]).toMatchObject({ name: "dir", type: "dir" });
    expect(unpacked[1]).toMatchObject({ name: "dir/file.txt", type: "file" });
    expect(new TextDecoder().decode(unpacked[1]!.data)).toBe("hello");
    expect(unpacked[2]).toMatchObject({
      name: "dir/link",
      type: "symlink",
      linkname: "file.txt",
    });
    expect(unpacked[3]).toMatchObject({ name: "empty.txt", type: "file" });
    expect(unpacked[3]!.data).toHaveLength(0);
  });

  it("splits names longer than 100 chars across the prefix field", () => {
    const long = `a/${"segment/".repeat(20)}file.txt`;
    const entries: TarEntry[] = [
      { name: long, type: "file", data: new TextEncoder().encode("x") },
    ];
    const unpacked = unpackTar(packTar(entries));
    expect(unpacked[0]!.name).toBe(long);
    expect(new TextDecoder().decode(unpacked[0]!.data)).toBe("x");
  });

  it("throws on names that cannot be split", () => {
    const tooLong = "x".repeat(200); // no '/' to split at
    expect(() =>
      packTar([{ name: tooLong, type: "file", data: new Uint8Array(0) }]),
    ).toThrow(/too long/);
  });

  it("rejects corrupt archives (checksum mismatch)", () => {
    const blob = packTar([
      { name: "f", type: "file", data: new TextEncoder().encode("y") },
    ]);
    blob[50] = 0x7f; // corrupt the header
    expect(() => unpackTar(blob)).toThrow(/checksum|corrupt/i);
  });

  it("stops at the end-of-archive marker", () => {
    const blob = packTar([
      { name: "f", type: "file", data: new Uint8Array([1]) },
    ]);
    // Trailing garbage after the two zero blocks must not produce entries.
    const padded = new Uint8Array(blob.length + 512);
    padded.set(blob);
    expect(unpackTar(padded)).toHaveLength(1);
  });

  it("rejects an entry whose size field is not a usable number", () => {
    const blob = packTar([
      { name: "f", type: "file", data: new Uint8Array([1]) },
    ]);
    // Overwrite the size field with non-octal digits ("9…"), then repair
    // the checksum so only the size validation trips.
    blob.fill(0x39, 124, 136);
    blob.fill(0x20, 148, 156);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += blob[i]!;
    const chk = sum.toString(8).padStart(6, "0");
    for (let i = 0; i < 6; i++) blob[148 + i] = chk.charCodeAt(i);
    blob[154] = 0;
    blob[155] = 0x20;
    expect(() => unpackTar(blob)).toThrow(/invalid size/i);
  });

  it("round-trips file and dir modes", () => {
    const entries: TarEntry[] = [
      { name: "d", type: "dir", mode: 0o700 },
      { name: "d/x.sh", type: "file", data: new Uint8Array([1]), mode: 0o755 },
      { name: "d/y.txt", type: "file", data: new Uint8Array([2]) },
    ];
    const unpacked = unpackTar(packTar(entries));
    expect(unpacked[0]!.mode).toBe(0o700);
    expect(unpacked[1]!.mode).toBe(0o755);
    // Missing mode falls back to the type default and still round-trips.
    expect(unpacked[2]!.mode).toBe(0o644);
  });
});

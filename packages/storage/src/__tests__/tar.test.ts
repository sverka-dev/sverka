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
});

// Minimal POSIX ustar archive pack/unpack for remote cache blobs.
// Internal — not exported from the package index.
// Supports regular files, directories, and symlinks; long names split
// across the ustar prefix field. No pax extensions, no sparse files.

import { StorageError } from "../errors.js";

export interface TarEntry {
  /** Relative path, forward slashes, no leading/trailing slash. */
  readonly name: string;
  readonly type: "file" | "dir" | "symlink";
  readonly data?: Uint8Array;
  /** Symlink target (type === "symlink"). */
  readonly linkname?: string;
  readonly mode?: number;
  /** Epoch seconds. */
  readonly mtime?: number;
}

const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;
const LINKNAME_MAX = 100;

function writeString(
  buf: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  const encoded = new TextEncoder().encode(value);
  buf.set(encoded.subarray(0, Math.min(encoded.length, length)), offset);
}

function writeOctal(
  buf: Uint8Array,
  offset: number,
  length: number,
  value: number,
): void {
  // length-1 octal digits, NUL-terminated.
  const text = value.toString(8).padStart(length - 1, "0");
  writeString(buf, offset, length - 1, text);
  buf[offset + length - 1] = 0;
}

function readString(buf: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(offset, end));
}

function readOctal(buf: Uint8Array, offset: number, length: number): number {
  const text = readString(buf, offset, length).trim();
  if (text === "") return 0;
  return Number.parseInt(text, 8);
}

/** Split `name` into ustar (prefix, name) fields, or null when unsplittable. */
function splitName(name: string): { prefix: string; name: string } | null {
  const encoded = new TextEncoder();
  if (encoded.encode(name).length <= NAME_MAX) return { prefix: "", name };
  // Split at a '/' so prefix ≤155 and name ≤100 bytes.
  let idx = name.lastIndexOf("/", name.length);
  while (idx > 0) {
    const prefix = name.slice(0, idx);
    const rest = name.slice(idx + 1);
    if (
      encoded.encode(prefix).length <= PREFIX_MAX &&
      encoded.encode(rest).length <= NAME_MAX &&
      rest.length > 0
    ) {
      return { prefix, name: rest };
    }
    idx = name.lastIndexOf("/", idx - 1);
  }
  return null;
}

function header(entry: TarEntry): Uint8Array {
  const buf = new Uint8Array(BLOCK);
  const split = splitName(entry.name);
  if (split === null) {
    throw new StorageError(
      "STORE_IO_FAILED",
      `tar entry name too long: ${entry.name.slice(0, 80)}…`,
    );
  }
  const size = entry.type === "file" ? (entry.data?.length ?? 0) : 0;
  writeString(buf, 0, NAME_MAX, split.name);
  writeOctal(buf, 100, 8, entry.mode ?? (entry.type === "dir" ? 0o755 : 0o644));
  writeOctal(buf, 108, 8, 0); // uid
  writeOctal(buf, 116, 8, 0); // gid
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, entry.mtime ?? 0);
  // Checksum field is spaces while summing.
  buf.fill(0x20, 148, 156);
  buf[156] =
    entry.type === "dir" ? 0x35 : entry.type === "symlink" ? 0x32 : 0x30;
  if (entry.type === "symlink") {
    const link = entry.linkname ?? "";
    if (new TextEncoder().encode(link).length > LINKNAME_MAX) {
      throw new StorageError(
        "STORE_IO_FAILED",
        `symlink target too long: ${entry.name}`,
      );
    }
    writeString(buf, 157, LINKNAME_MAX, link);
  }
  writeString(buf, 257, 8, "ustar\0");
  writeString(buf, 263, 2, "00");
  writeString(buf, 265, 32, "sverka");
  writeString(buf, 297, 32, "sverka");
  writeString(buf, 345, PREFIX_MAX, split.prefix);
  let sum = 0;
  for (const byte of buf) sum += byte;
  // 6 octal digits + NUL + space.
  writeString(buf, 148, 6, sum.toString(8).padStart(6, "0"));
  buf[154] = 0;
  buf[155] = 0x20;
  return buf;
}

/** Pack entries into a ustar archive. */
export function packTar(entries: readonly TarEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    chunks.push(header(entry));
    if (entry.type === "file" && entry.data !== undefined) {
      chunks.push(entry.data);
      const pad = (BLOCK - (entry.data.length % BLOCK)) % BLOCK;
      if (pad > 0) chunks.push(new Uint8Array(pad));
    }
  }
  chunks.push(new Uint8Array(BLOCK * 2)); // end-of-archive marker
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function isZeroBlock(buf: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + BLOCK; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

function verifyChecksum(buf: Uint8Array, offset: number): boolean {
  let sum = 0;
  for (let i = offset; i < offset + BLOCK; i++) {
    sum += i >= offset + 148 && i < offset + 156 ? 0x20 : buf[i]!;
  }
  return sum === readOctal(buf, offset + 148, 8);
}

interface ParsedHeader {
  readonly name: string;
  readonly size: number;
  readonly typeflag: number;
  readonly mtime: number;
  readonly mode?: number;
  readonly linkname?: string;
}

function parseHeader(archive: Uint8Array, offset: number): ParsedHeader {
  const prefix = readString(archive, offset + 345, PREFIX_MAX);
  const namePart = readString(archive, offset, NAME_MAX);
  const name = prefix === "" ? namePart : `${prefix}/${namePart}`;
  const size = readOctal(archive, offset + 124, 12);
  // A non-octal size parses to NaN — unchecked, it would silently end
  // the loop (NaN comparisons are false), reporting a truncated archive
  // as a valid restore. Reject anything that isn't a usable length.
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new StorageError(
      "CORRUPT_SNAPSHOT",
      "tar entry has an invalid size field",
    );
  }
  const typeflag = archive[offset + 156]!;
  const mtime = readOctal(archive, offset + 136, 12);
  const rawMode = readOctal(archive, offset + 100, 8);
  const mode = Number.isSafeInteger(rawMode) ? rawMode & 0o777 : undefined;
  const linkname =
    typeflag === 0x32
      ? readString(archive, offset + 157, LINKNAME_MAX)
      : undefined;
  return {
    name,
    size,
    typeflag,
    mtime,
    ...(mode !== undefined ? { mode } : {}),
    ...(linkname !== undefined ? { linkname } : {}),
  };
}

/** Map a parsed header (+file data) to an entry — unsupported typeflags
 *  return undefined (their data blocks are still consumed by the loop). */
function entryFor(h: ParsedHeader, data: Uint8Array): TarEntry | undefined {
  const shared = {
    ...(h.mode !== undefined ? { mode: h.mode } : {}),
    mtime: h.mtime,
  };
  if (h.typeflag === 0x30 || h.typeflag === 0x00) {
    return { name: h.name, type: "file", data, ...shared };
  }
  if (h.typeflag === 0x35) {
    return { name: h.name.replace(/\/$/, ""), type: "dir", ...shared };
  }
  if (h.typeflag === 0x32) {
    return {
      name: h.name,
      type: "symlink",
      ...(h.linkname !== undefined ? { linkname: h.linkname } : {}),
      ...shared,
    };
  }
  return undefined;
}

/** Unpack a ustar archive into entries. */
export function unpackTar(archive: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    if (isZeroBlock(archive, offset)) break;
    if (!verifyChecksum(archive, offset)) {
      throw new StorageError(
        "CORRUPT_SNAPSHOT",
        "tar archive checksum mismatch (corrupt blob)",
      );
    }
    const h = parseHeader(archive, offset);
    offset += BLOCK;
    if (offset + h.size > archive.length) {
      throw new StorageError(
        "CORRUPT_SNAPSHOT",
        "tar archive truncated mid-entry",
      );
    }
    const entry = entryFor(h, archive.slice(offset, offset + h.size));
    if (entry !== undefined) entries.push(entry);
    offset += Math.ceil(h.size / BLOCK) * BLOCK;
  }
  return entries;
}

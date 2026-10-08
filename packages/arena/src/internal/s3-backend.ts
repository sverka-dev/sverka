/**
 * S3 registry backend — put-object/get-object via an injectable client
 * (no AWS SDK dependency in tests), behind the TreeStore contract.
 * Not exported from the package index.
 */
import { ArenaError } from "../config.js";
import { stripTrailingSlashes, type TreeStore } from "./tree-store.js";

/** Minimal structural subset of the AWS SDK S3 client we depend on. */
export interface S3ClientLike {
  putObject(input: {
    Bucket: string;
    Key: string;
    Body: string | Uint8Array;
  }): Promise<unknown>;
  getObject?(input: { Bucket: string; Key: string }): Promise<{
    Body?: unknown;
  }>;
  listObjectsV2?(input: {
    Bucket: string;
    Prefix?: string;
    ContinuationToken?: string;
  }): Promise<{
    Contents?: { Key?: string }[];
    IsTruncated?: boolean;
    NextContinuationToken?: string;
  }>;
}

export interface S3RegistryConfig {
  bucket: string;
  /** Key prefix for the whole registry tree (default: ""). */
  prefix?: string;
  /** Client — injectable so tests need no AWS SDK. When omitted, the
   * optional `@aws-sdk/client-s3` peer is imported lazily. */
  client?: S3ClientLike;
}

type AwsS3Ctor = new (cfg: Record<string, never>) => S3ClientLike;

/** Computed specifier — keeps the optional AWS peer out of the dep graph. */
const S3_SDK_MODULE = "@aws-sdk/client-s3";

async function defaultS3Client(): Promise<S3ClientLike> {
  try {
    const mod = (await import(S3_SDK_MODULE)) as {
      S3Client: AwsS3Ctor;
    };
    return new mod.S3Client({});
  } catch (err) {
    throw new ArenaError(
      `s3 registry requires a client — install @aws-sdk/client-s3 or pass { client }`, // nosemgrep: missing-template-string-indicator
      "REGISTRY_UNAVAILABLE",
      err,
    );
  }
}

async function s3BodyToString(body: unknown): Promise<string> {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (
    typeof (body as { transformToString?: unknown }).transformToString ===
    "function"
  ) {
    return (
      body as { transformToString(): Promise<string> }
    ).transformToString();
  }
  if (
    typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] ===
    "function"
  ) {
    const chunks: Uint8Array[] = [];
    for await (const c of body as AsyncIterable<Uint8Array>) chunks.push(c);
    return new TextDecoder().decode(concatChunks(chunks));
  }
  throw new ArenaError(
    "s3 registry: unsupported getObject Body type",
    "REGISTRY_UNAVAILABLE",
  );
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function createS3Tree(cfg: S3RegistryConfig): TreeStore {
  const stripped =
    cfg.prefix === undefined ? "" : stripTrailingSlashes(cfg.prefix);
  const prefix = stripped === "" ? "" : `${stripped}/`;
  let clientP: Promise<S3ClientLike> | undefined;
  const client = (): Promise<S3ClientLike> => {
    clientP ??=
      cfg.client !== undefined
        ? Promise.resolve(cfg.client)
        : defaultS3Client();
    return clientP;
  };
  const unavailable = (what: string, cause: unknown): ArenaError =>
    new ArenaError(
      `s3 registry unavailable — ${what}`,
      "REGISTRY_UNAVAILABLE",
      cause,
    );

  return {
    async readFile(rel) {
      const c = await client();
      if (c.getObject === undefined) {
        throw unavailable(`client has no getObject`, undefined);
      }
      try {
        const res = await c.getObject({
          Bucket: cfg.bucket,
          Key: prefix + rel,
        });
        return await s3BodyToString(res?.Body);
      } catch (err) {
        const name = (err as { name?: string }).name ?? "";
        if (name === "NoSuchKey" || name === "NotFound") return null;
        if (err instanceof ArenaError) throw err;
        throw unavailable(`getObject ${rel} failed`, err);
      }
    },
    async writeFile(rel, data) {
      const c = await client();
      try {
        await c.putObject({
          Bucket: cfg.bucket,
          Key: prefix + rel,
          Body: data,
        });
      } catch (err) {
        throw unavailable(`putObject ${rel} failed`, err);
      }
    },
    async listFiles(relPrefix) {
      const c = await client();
      if (c.listObjectsV2 === undefined) {
        throw unavailable(`client has no listObjectsV2`, undefined);
      }
      const listObjectsV2 = c.listObjectsV2.bind(c);
      const out: string[] = [];
      // Pagination is sequential by definition — each page's
      // ContinuationToken comes from the previous response. Recursion
      // (async frames, not stack frames) keeps that shape without an
      // await inside a loop.
      const listPage = async (token: string | undefined): Promise<void> => {
        const page = await listObjectsV2({
          Bucket: cfg.bucket,
          Prefix: prefix + relPrefix,
          ...(token !== undefined ? { ContinuationToken: token } : {}),
        });
        for (const obj of page.Contents ?? []) {
          if (obj.Key !== undefined) out.push(obj.Key.slice(prefix.length));
        }
        if (
          page.IsTruncated === true &&
          page.NextContinuationToken !== undefined
        ) {
          await listPage(page.NextContinuationToken);
        }
      };
      try {
        await listPage(undefined);
      } catch (err) {
        throw unavailable(`listObjectsV2 failed`, err);
      }
      return out;
    },
    async finalize() {},
  };
}

// Image value helpers — typed OCI image references.
// Spec 03 — §14.2. Architecture spec §14.2.

import { SdkError } from "./errors.js";

export interface ImageRef {
  readonly ref: string;
}

/** Create an ImageRef from a raw OCI reference string. */
export function image(ref: string): ImageRef {
  if (typeof ref !== "string") {
    throw new SdkError("image reference must be a string", "INVALID_IMAGE");
  }
  if (ref.length === 0) {
    throw new SdkError("image reference must be a non-empty string", "INVALID_IMAGE");
  }
  return { ref };
}

const PROTECTED_IMAGE_PROPS = new Set<string | symbol>([
  "then",
  "toJSON",
  "inspect",
  "constructor",
  "valueOf",
  Symbol.toPrimitive,
  Symbol.iterator,
  Symbol.toStringTag,
]);

/** Node image proxy — images.node[22] → { ref: "node:22" }, images.node.latest → { ref: "node:latest" }. */
const nodeImages = new Proxy({} as Record<string, ImageRef> & { readonly latest: ImageRef; readonly [version: number]: ImageRef }, {
  get(target, prop: string | symbol): ImageRef | unknown {
    if (typeof prop === "symbol" || PROTECTED_IMAGE_PROPS.has(prop)) {
      return Reflect.get(target, prop);
    }
    if (prop === "latest") return image("node:latest");
    if (/^\d+$/.test(prop)) return image(`node:${prop}`);
    return image(`node:${prop}`);
  },
});

/** Ubuntu image proxy — images.ubuntu.latest → { ref: "ubuntu:latest" }. */
const ubuntuImages = new Proxy({} as { readonly latest: ImageRef; readonly [version: string]: ImageRef }, {
  get(target, prop: string | symbol): ImageRef | unknown {
    if (typeof prop === "symbol" || PROTECTED_IMAGE_PROPS.has(prop)) {
      return Reflect.get(target, prop);
    }
    return image(`ubuntu:${prop}`);
  },
});

export const images = {
  node: nodeImages,
  ubuntu: ubuntuImages,
};

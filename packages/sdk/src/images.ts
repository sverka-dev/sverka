// Image value helpers — typed OCI image references.
// Spec 03 — §14.2. Architecture spec §14.2.

import { SdkError } from "./errors.js";
import { createDynamicProxy } from "./internal/proxy-props.js";

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

/** Create a Proxy that maps property access to `image(prefix:prop)`. */
function createImageProxy(prefix: string): Record<string, ImageRef> & { readonly latest: ImageRef } {
  return createDynamicProxy((prop) => image(`${prefix}:${prop}`)) as Record<string, ImageRef> & { readonly latest: ImageRef };
}

/** Node image proxy — images.node[22] → { ref: "node:22" }, images.node.latest → { ref: "node:latest" }. */
const nodeImages = createImageProxy("node") as Record<string, ImageRef> & { readonly latest: ImageRef; readonly [version: number]: ImageRef };

/** Ubuntu image proxy — images.ubuntu.latest → { ref: "ubuntu:latest" }. */
const ubuntuImages = createImageProxy("ubuntu");

export const images = {
  node: nodeImages,
  ubuntu: ubuntuImages,
};

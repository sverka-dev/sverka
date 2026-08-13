// Image value helpers — typed OCI image references.
// Spec 03 — §14.2. Architecture spec §14.2.

import { SdkError } from "./errors.js";
import { PROTECTED_PROXY_PROPS } from "./internal/proxy-props.js";

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
  return new Proxy({} as Record<string, ImageRef> & { readonly latest: ImageRef }, {
    get(target, prop: string | symbol): ImageRef | unknown {
      if (typeof prop === "symbol" || PROTECTED_PROXY_PROPS.has(prop)) {
        return Reflect.get(target, prop);
      }
      return image(`${prefix}:${prop}`);
    },
  });
}

/** Node image proxy — images.node[22] → { ref: "node:22" }, images.node.latest → { ref: "node:latest" }. */
const nodeImages = createImageProxy("node") as Record<string, ImageRef> & { readonly latest: ImageRef; readonly [version: number]: ImageRef };

/** Ubuntu image proxy — images.ubuntu.latest → { ref: "ubuntu:latest" }. */
const ubuntuImages = createImageProxy("ubuntu");

export const images = {
  node: nodeImages,
  ubuntu: ubuntuImages,
};

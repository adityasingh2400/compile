import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { IConvexClientLike } from "./convex.js";

/**
 * Real ConvexHttpClient adapter behind the IConvexClientLike seam.
 *
 * The seam takes mutation names as `"file:export"` strings (e.g.
 * `"phase:advance"`) — Convex's typed client wants a FunctionReference.
 * We translate via `anyApi[file][export]`, which is the documented escape
 * hatch when call sites are dynamic. Type safety is preserved at the
 * Convex schema layer; this module is the only place untyped strings
 * cross the line.
 */
export interface ConvexAdapterOptions {
  /** Convex deployment URL, e.g. `https://watchful-oriole-309.convex.cloud`. */
  url: string;
}

export function createConvexAdapter(opts: ConvexAdapterOptions): IConvexClientLike {
  const client = new ConvexHttpClient(opts.url);
  return {
    async mutation(name, args) {
      const [file, fn] = name.split(":");
      if (!file || !fn) {
        throw new Error(`invalid mutation name "${name}" — expected "file:export"`);
      }
      const fileApi = (anyApi as Record<string, Record<string, unknown>>)[file];
      if (!fileApi) {
        throw new Error(`unknown convex module "${file}" in mutation "${name}"`);
      }
      const ref = fileApi[fn];
      return client.mutation(ref as never, args as never);
    },
  };
}

/**
 * Convenience factory: read CONVEX_URL from the environment and build the
 * adapter. Throws if the env var is missing — fail loud, don't silently
 * fall back to the in-memory stream in production.
 */
export function convexAdapterFromEnv(): IConvexClientLike {
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error(
      "CONVEX_URL not set — run `npx convex dev` to provision a deployment, or export CONVEX_URL for production.",
    );
  }
  return createConvexAdapter({ url });
}

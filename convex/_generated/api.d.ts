/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cells from "../cells.js";
import type * as clusters from "../clusters.js";
import type * as metrics from "../metrics.js";
import type * as phase from "../phase.js";
import type * as result from "../result.js";
import type * as runs from "../runs.js";
import type * as scan from "../scan.js";
import type * as synthesis from "../synthesis.js";
import type * as vault from "../vault.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  cells: typeof cells;
  clusters: typeof clusters;
  metrics: typeof metrics;
  phase: typeof phase;
  result: typeof result;
  runs: typeof runs;
  scan: typeof scan;
  synthesis: typeof synthesis;
  vault: typeof vault;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

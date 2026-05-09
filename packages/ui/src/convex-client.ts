/**
 * Singleton Convex client for the UI. Reads VITE_CONVEX_URL from the
 * monorepo `.env.local` (vite is configured with `envDir: "../.."`).
 *
 * Wired into <ConvexProvider> in main.tsx. When VITE_CONVEX_URL is unset
 * the client is null and the demo falls back to fixture mode (no
 * subscriptions fire — same UX as before Convex was wired in).
 */
import { ConvexReactClient } from "convex/react";

const url = (import.meta as unknown as { env?: Record<string, string> }).env
  ?.VITE_CONVEX_URL;

export const convexClient: ConvexReactClient | null = url
  ? new ConvexReactClient(url)
  : null;

export const CONVEX_URL = url ?? null;
export const CONVEX_RUN_ID = "demo-fake-daemon";

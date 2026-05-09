import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Bundle internal @compile/* siblings; keep every npm dep external so
  // CJS modules with dynamic requires (undici via tensorlake/convex/etc.)
  // are loaded at runtime instead of being mangled into the ESM bundle.
  noExternal: [/^@compile\//],
  external: [/^[a-z0-9]/i, /^@(?!compile\/)/],
});

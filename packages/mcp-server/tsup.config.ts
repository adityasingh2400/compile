import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Bundle internal @compile/* workspaces into the published artifact so
  // the published package is a single self-contained tarball. External deps
  // (MCP SDK, zod, esbuild, etc.) stay as runtime dependencies in package.json.
  noExternal: [/^@compile\//],
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Bundle internal @compile/* workspaces into the published artifact;
  // keep @compile/daemon external so the customer install resolves it as
  // a separate package (the auto-fork resolves its bin via require.resolve).
  // Every npm dep stays external — many are CJS modules whose dynamic
  // requires (undici via tensorlake/convex/etc.) do not survive ESM bundling.
  noExternal: [/^@compile\/(?!daemon$)/],
  external: [/^[a-z0-9]/i, /^@(?!compile\/(?!daemon$))/],
});

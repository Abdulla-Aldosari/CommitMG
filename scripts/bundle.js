// CommitMG bundle script (CommonJS, runs on Node via `node scripts/bundle.js`).
//
// Why a bundler at all:
//   The Estimate Cost feature depends on gpt-tokenizer. The extension ships
//   as a single out/ folder with node_modules fully excluded from the vsix
//   (.vscodeignore), so a plain tsc emit cannot ship that dependency. This
//   script inlines gpt-tokenizer into out/extension.js instead. esbuild
//   resolves the library's own ESM import graph, so only the o200k_base BPE
//   table (the single encoding we import) lands in the bundle; the unused
//   cl100k/p50k/r50k tables stay out.
//
// Why "vscode" is the only external:
//   The vscode module is provided by the VS Code host itself at runtime; it
//   must never be bundled. Everything else (including gpt-tokenizer) is
//   inlined so the packaged extension has zero runtime dependencies.
//
// Why the out/ folder is wiped first:
//   Older builds emitted a full tree (out/ai/..., out/settings/...) via
//   tsc. Without cleaning, those stale files would still be picked up by
//   vsce packaging and bloat the vsix next to the bundle.

const fs = require("fs");
const esbuild = require("esbuild");

const watchMode = process.argv.includes("--watch");

// Stale files from previous tsc-emit builds must never reach the package.
fs.rmSync("out", { recursive: true, force: true });

const options = {
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20", // VS Code 1.90+ ships Node 20 (Electron 29).
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

if (watchMode) {
  esbuild
    .context(options)
    .then((ctx) => {
      console.log("Watching for changes...");
      return ctx.watch();
    })
    .catch(() => process.exit(1));
} else {
  esbuild
    .build(options)
    .then(() => {
      console.log("Bundle written to out/extension.js");
    })
    .catch(() => process.exit(1));
}

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { versionDefine } from "./build-metadata.mjs";

const require = createRequire(import.meta.url);

const options = {
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  define: versionDefine,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr"
  ],
  sourcemap: false,
  logLevel: "info",
  treeShaking: true,
  minify: process.argv.includes("--production")
};

mkdirSync("dist", { recursive: true });
copyFileSync("manifest.json", "dist/manifest.json");
await build(options);
const viewStyles = readFileSync(require.resolve("@cogitatum/view/style.css"), "utf8");
const pluginStyles = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");
writeFileSync("dist/styles.css", `${viewStyles}\n${pluginStyles}`);
process.stdout.write("Built Obsidian plugin files in dist/.\n");

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FORMAT_VERSION } from "@cogitatum/core";
import { verifyPin } from "./pin.mjs";

const root = new URL("./", import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
export const manifest = json("package.json");
export const plugin = json("manifest.json");
if (manifest.version !== plugin.version || plugin.id !== "cogitatum") {
  throw new Error("Plugin and package identity must agree.");
}
const { packages } = verifyPin();

let revision = "source archive";
try {
  // Do not borrow the identity of a parent repository when this is an extracted archive.
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (top === fileURLToPath(root).replace(/\/$/, "")) {
    revision = execFileSync("git", ["describe", "--always", "--dirty"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  }
} catch { /* Source archives need no Git checkout to build. */ }

export const logo = "data:image/svg+xml," + encodeURIComponent(readFileSync(new URL("assets/cog-mark.svg", root), "utf8"));
export const version = {
  label: `Core ${packages.core.version}`,
  detail: `Core ${packages.core.version}\nView ${packages.view.version}\nFormat ${FORMAT_VERSION}\nObsidian plugin ${plugin.version}\nPublic source ${manifest.cogitatumSource.ref}\nHost build ${revision}`
};
export const versionDefine = {
  __COGITATUM_VERSION__: JSON.stringify(version),
  __COGITATUM_LOGO__: JSON.stringify(logo)
};

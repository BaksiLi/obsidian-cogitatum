import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMAT_VERSION } from "@cogitatum/core";

const root = new URL("./", import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
export const manifest = json("package.json");
export const plugin = json("manifest.json");
if (manifest.version !== plugin.version || plugin.id !== "cogitatum") {
  throw new Error("Plugin and package identity must agree.");
}
if (!/^[a-f0-9]{40}$/.test(manifest.cogitatumSource?.ref ?? "")) {
  throw new Error("Pin the full public Core/View source commit in cogitatumSource.ref.");
}

const require = createRequire(import.meta.url);
const installed = name => JSON.parse(readFileSync(join(dirname(require.resolve(name)), "../package.json"), "utf8"));
const packages = {};
for (const name of ["core", "view"]) {
  const dependency = manifest.dependencies[`@cogitatum/${name}`];
  if (!/^file:vendor\/[^/]+\.tgz$/.test(dependency ?? "")) {
    throw new Error(`@cogitatum/${name} must use a portable vendor tarball.`);
  }
  const archive = readFileSync(new URL(dependency.slice(5), root));
  const digest = createHash("sha256").update(archive).digest("hex");
  if (manifest.cogitatumSource.sha256?.[name] !== digest) {
    throw new Error(`@cogitatum/${name} tarball does not match its pinned SHA-256.`);
  }
  packages[name] = installed(`@cogitatum/${name}`);
  if (`file:vendor/cogitatum-${name}-${packages[name].version}.tgz` !== dependency) {
    throw new Error(`Installed @cogitatum/${name} version differs from its pinned tarball. Run npm ci.`);
  }
  const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  for (const lockPath of ["package-lock.json", "node_modules/.package-lock.json"]) {
    if (json(lockPath).packages?.[`node_modules/@cogitatum/${name}`]?.integrity !== integrity) {
      throw new Error(`${lockPath} does not match the pinned @cogitatum/${name} tarball. Run npm ci.`);
    }
  }
}

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

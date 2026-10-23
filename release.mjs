import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { plugin } from "./build-metadata.mjs";

const root = new URL("./", import.meta.url);
const output = new URL(`releases/cogitatum-${plugin.version}.zip`, root);
const stage = mkdtempSync(join(tmpdir(), "cogitatum-obsidian-release-"));
const files = ["main.js", "styles.css", "manifest.json", "LICENSE"];
try {
  mkdirSync(new URL("releases/", root), { recursive: true });
  for (const file of files) {
    copyFileSync(new URL(file === "LICENSE" ? file : `dist/${file}`, root), join(stage, file));
    // ZIP entries have fixed timestamps so identical bundles produce identical archives.
    const timestamp = new Date("1980-01-01T00:00:00Z");
    utimesSync(join(stage, file), timestamp, timestamp);
  }
  rmSync(output, { force: true });
  execFileSync("zip", ["-q", "-X", fileURLToPath(output), ...files], { cwd: stage, env: { ...process.env, TZ: "UTC" } });
  const digest = createHash("sha256").update(readFileSync(output)).digest("hex");
  process.stdout.write(`Created ${fileURLToPath(output)}\nSHA-256 ${digest}\n`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}

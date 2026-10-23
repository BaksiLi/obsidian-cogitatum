import type { MarkdownSectionInformation } from "obsidian";
import { extractCogitatumSourceUnits } from "@cogitatum/core";

/** Reading dedents its callback; Live Preview passes the original fenced lines. */
export function renderSource(callback: string, section: MarkdownSectionInformation | null): string {
  // Embedded renders may have no host location. Do not guess their indentation.
  if (!section) return callback;
  const unit = extractCogitatumSourceUnits(section.text, "host")
    .find(unit => unit.startLine === section.lineStart + 2 && unit.endLine === section.lineEnd);
  if (unit) {
    const raw = section.text.split(/\r\n|\r|\n/).slice(unit.startLine - 1, unit.endLine).join("\n");
    const received = callback.replace(/\r\n|\r/g, "\n");
    // A newer section must not silently replace an older callback revision.
    if (received === unit.source || received === raw) return unit.source;
  }
  throw new Error("The preview no longer matches its source fence. Refresh the preview and try again.");
}

import { RangeSetBuilder, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { tokenizeHostSource, type SourceTokenKind } from "@cogitatum/core";

/** Core owns the lexical classes; the host theme owns their colors through its own syntax classes. */
const HOST_CLASSES: Record<SourceTokenKind, string> = {
  bullet: "cm-punctuation", mark: "cm-keyword", role: "cm-tag", name: "cm-property", operator: "cm-operator",
  relation: "cm-operator", punct: "cm-punctuation", code: "cm-string", note: "cm-comment", retired: "cm-error"
};
// Notes without a Cogitatum fence skip Markdown parsing on every keystroke.
const FENCE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*cog(?:itatum)?(?:[ \t]|$)/m;

/** A fence's first and last content lines, and its content as Core dedents it. */
type Fence = { startLine: number; endLine: number; lines: string[] };
type Highlights = { fences: Fence[]; decorations: DecorationSet };

const marks = new Map<string, Decoration>();
function mark(kind: SourceTokenKind, role?: string): Decoration {
  const key = `${kind}:${role ?? ""}`;
  if (!marks.has(key)) {
    const letter = kind === "role" ? role?.[0] : undefined;
    marks.set(key, Decoration.mark({ class: `cog-token cog-token-${kind} ${HOST_CLASSES[kind]}${letter ? ` cog-role-${letter}` : ""}` }));
  }
  return marks.get(key)!;
}

function highlight(doc: Text): Highlights {
  const text = doc.toString();
  if (!FENCE.test(text)) return { fences: [], decorations: Decoration.none };
  const builder = new RangeSetBuilder<Decoration>(), fences: Fence[] = [];
  for (const line of tokenizeHostSource(text, "host")) {
    // Fence delimiters always separate two units, so a unit is a run of consecutive placed lines.
    const fence = fences.at(-1);
    const text = doc.line(line.line).text.slice(line.column - 1);
    if (fence && fence.endLine === line.line - 1) { fence.endLine = line.line; fence.lines.push(text); }
    else fences.push({ startLine: line.line, endLine: line.line, lines: [text] });
    let at = doc.line(line.line).from + line.column - 1;
    for (const token of line.tokens) {
      const end = at + token.text.length;
      if (token.kind && end > at) builder.add(at, end, mark(token.kind, token.kind === "role" ? token.text : undefined));
      at = end;
    }
  }
  return { fences, decorations: builder.finish() };
}

const highlights = StateField.define<Highlights>({
  create: state => highlight(state.doc),
  update: (value, transaction) => transaction.docChanged ? highlight(transaction.state.doc) : value,
  provide: field => EditorView.decorations.from(field, value => value.decorations)
});

/** A cursor inside a fence names the note, the fence's first content line, the line within it, and the fence's current source. */
export type FenceCursor = { path: string; startLine: number; line: number; source: string };

function fenceCursor(state: EditorState): FenceCursor | undefined {
  const path = state.field(editorInfoField, false)?.file?.path;
  if (!path) return;
  const line = state.doc.lineAt(state.selection.main.head).number;
  const fence = state.field(highlights).fences.find(fence => line >= fence.startLine && line <= fence.endLine);
  return fence && { path, startLine: fence.startLine, line: line - fence.startLine + 1, source: fence.lines.join("\n") };
}

/**
 * Highlight cog fences in every source editor and let previews follow their cursors.
 * A moved cursor is reported as it moves; a preview built later asks `cursors()` for the editors already inside its fence.
 */
export function cogitatumEditor(onCursor: (cursor: FenceCursor, view: EditorView) => void) {
  const views = new Set<EditorView>();
  const tracker = ViewPlugin.define(view => {
    views.add(view);
    return {
      update(update) {
        const cursor = update.selectionSet ? fenceCursor(update.state) : undefined;
        if (cursor) onCursor(cursor, update.view);
      },
      destroy() { views.delete(view); }
    };
  });
  return {
    extension: [highlights, tracker] as Extension,
    *cursors(): Iterable<[FenceCursor, EditorView]> {
      for (const view of views) {
        const cursor = fenceCursor(view.state);
        if (cursor) yield [cursor, view];
      }
    }
  };
}

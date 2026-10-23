import { MarkdownView, type App, type MarkdownPostProcessorContext, type WorkspaceLeaf } from "obsidian";
import { extractCogitatumSourceUnits, type SourceSpan } from "@cogitatum/core";
import type { BlockEditRequest } from "@cogitatum/view/block";

/** Validate the live fence before mapping a compiler span into the host editor. */
export function sourceRange(text: string, source: string, lineStart: number, span?: SourceSpan) {
  const unit = extractCogitatumSourceUnits(text, "host").find(unit => unit.startLine === lineStart + 2);
  if (!unit || unit.source !== source.replace(/\r\n/g, "\n")) {
    throw new Error("The source changed. Refresh the preview and try again.");
  }
  const lines = text.split(/\r\n|\r|\n/), content = unit.source.split("\n");
  const position = (line: number, column: number) => {
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || line > content.length
      || column < 1 || column > content[line - 1].length + 1) {
      throw new Error("The selected passage no longer has a valid source location.");
    }
    const hostLine = unit.startLine + line - 2;
    // Core owns fence selection and dedenting. Restore only the exact prefix it removed.
    const raw = lines[hostLine], local = content[line - 1];
    const removed = unit.endLine < unit.startLine ? 0 : raw.length - local.length;
    if (removed < 0 || (unit.endLine >= unit.startLine && (!raw.endsWith(local) || !/^ *$/.test(raw.slice(0, removed))))) {
      throw new Error("The selected passage no longer matches its source line.");
    }
    return { line: hostLine, ch: removed + column - 1 };
  };
  const from = position(span?.startLine ?? 1, span?.startColumn ?? 1);
  const to = span ? position(span.endLine, span.endColumn) : from;
  if (to.line < from.line || (to.line === from.line && to.ch < from.ch)) {
    throw new Error("The selected passage no longer has a valid source range.");
  }
  return { from, to, firstLine: unit.startLine - 1, lastLine: unit.endLine - 1 };
}

export function ownerLeaf(app: App, container: HTMLElement): WorkspaceLeaf | undefined {
  return app.workspace.getLeavesOfType("markdown").find(leaf => leaf.view.containerEl.contains(container));
}

/** Reuse one native source pane: Obsidian owns the buffer, IME, undo and persistence. */
export async function editSource(app: App, container: HTMLElement, context: MarkdownPostProcessorContext, request: BlockEditRequest): Promise<void> {
  if (request.signal.aborted || !container.isConnected) return;
  const { source, sourceSpan: span, signal } = request;
  const section = context.getSectionInfo(container);
  if (!section) throw new Error("This preview has no editable source location. Open its original note to edit it.");
  const file = app.vault.getFileByPath(context.sourcePath);
  if (!file) throw new Error("The source note is no longer available.");
  const path = file.path;
  const owner = ownerLeaf(app, container);
  let editorLeaf = app.workspace.getLeavesOfType("markdown").find(leaf => leaf !== owner &&
    leaf.view.containerEl.ownerDocument === container.ownerDocument &&
    leaf.view instanceof MarkdownView && leaf.view.file?.path === path && leaf.view.getMode() === "source");
  const reused = !!editorLeaf;
  if (!editorLeaf) {
    const direction = container.ownerDocument.defaultView!.innerWidth < 800 ? "horizontal" : "vertical";
    editorLeaf = owner ? app.workspace.createLeafBySplit(owner, direction) : app.workspace.getLeaf("split", direction);
    if (signal.aborted || !container.isConnected) return;
    await editorLeaf.setViewState({ type: "markdown", state: { file: path, mode: "source", source: true }, active: false });
  }
  if (signal.aborted) return;
  const view = editorLeaf.view;
  const nativeEditor = view instanceof MarkdownView ? view.editor : undefined;
  const validateTarget = () => {
    if (signal.aborted || !container.isConnected) return;
    if (!(view instanceof MarkdownView) || !nativeEditor || view.editor !== nativeEditor
      || !app.workspace.getLeavesOfType("markdown").includes(editorLeaf)
      || editorLeaf.view !== view || view.file?.path !== path || view.getMode() !== "source") {
      throw new Error("Obsidian could not keep the requested note open in the source editor.");
    }
    return { editor: nativeEditor, range: sourceRange(nativeEditor.getValue(), source, section.lineStart, span) };
  };
  if (!validateTarget()) return;
  app.workspace.setActiveLeaf(editorLeaf, { focus: true });
  // Each native callback can unload the preview, replace its editor, or change the source.
  const active = validateTarget();
  if (!active) return;
  const cursor = active.editor.getCursor();
  const current = validateTarget();
  if (!current) return;
  const { editor, range } = current;
  // Re-entering an existing editor preserves work in this fence, including its selection.
  if (span || !reused || cursor.line < range.firstLine || cursor.line > range.lastLine) {
    editor.setSelection(range.from, range.to);
    const selected = validateTarget();
    if (!selected) return;
    editor.scrollIntoView(selected.range, true);
  }
  if (!validateTarget()) return;
  editor.focus();
}

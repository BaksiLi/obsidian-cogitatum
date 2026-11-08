import { Component, MarkdownRenderChild, MarkdownRenderer, Plugin, type WorkspaceLeaf } from "obsidian";
import { createBlockView, type BlockView, type BlockViewOptions, type BlockMode } from "@cogitatum/view/block";
import { editSource, ownerLeaf } from "./edit";
import type { EditorView } from "@codemirror/view";
import { cogitatumEditor, type FenceCursor } from "./editor";
import { renderSource } from "./source";

declare const __COGITATUM_LOGO__: string;

declare const __COGITATUM_VERSION__: { label: string; detail: string };

export default class CogitatumPlugin extends Plugin {
  private readonly blocks = new Set<InquiryRenderChild>();
  private readonly modes = new WeakMap<WorkspaceLeaf, Map<string, BlockMode>>();
  private opening: Promise<void> = Promise.resolve();
  // A source editor beside a preview moves its selection as the author's cursor moves.
  private readonly editors = cogitatumEditor((cursor, view) => {
    for (const block of this.blocks) block.follow(cursor, view);
  });

  onload(): void {
    this.registerEditorExtension(this.editors.extension);
    for (const language of ["cog", "cogitatum"]) {
      this.registerMarkdownCodeBlockProcessor(language, (source, container, context) => {
        const preference = () => {
          const owner = ownerLeaf(this.app, container), section = context.getSectionInfo(container);
          if (!owner || !section) return;
          if (!this.modes.has(owner)) this.modes.set(owner, new Map());
          return { modes: this.modes.get(owner)!, key: `${context.sourcePath}:${section.lineStart}` };
        };
        const child = new InquiryRenderChild(container, context.sourcePath, () => renderSource(source, context.getSectionInfo(container)), {
          version: __COGITATUM_VERSION__,
          logo: __COGITATUM_LOGO__,
          renderProse: async ({ text, container, signal }) => {
            if (signal.aborted) return;
            const component = new ProseRenderComponent(signal);
            component.load();
            await MarkdownRenderer.render(this.app, text, container, context.sourcePath, component);
          },
          initialMode: () => { const p = preference(); return p?.modes.get(p.key); },
          onMode: mode => { const p = preference(); p?.modes.set(p.key, mode); },
          onEdit: request => {
            // Serialize pane creation without dropping a request from another block.
            const opening = this.opening.then(() => editSource(this.app, container, context, request));
            this.opening = opening.catch(() => {});
            return opening;
          }
        }, () => this.blocks.delete(child), this.editors, () => {
          const section = context.getSectionInfo(container);
          return section ? section.lineStart + 2 : undefined;
        });
        this.blocks.add(child);
        context.addChild(child);
      });
    }
  }

  onunload(): void {
    // An open note need not rerender when the plugin is disabled.
    for (const block of this.blocks) block.unload();
    this.blocks.clear();
  }
}

/**
 * The view aborts every render it replaces, fails or destroys, so the signal is this component's whole lifetime.
 * Native postprocessors may continue acquiring resources after that, and receive them already released.
 */
class ProseRenderComponent extends Component {
  constructor(private readonly signal: AbortSignal) {
    super();
    signal.addEventListener("abort", () => this.unload(), { once: true });
  }

  override register(callback: () => unknown): void {
    if (this.signal.aborted) callback();
    else super.register(callback);
  }

  override addChild<T extends Component>(child: T): T {
    if (this.signal.aborted) { child.unload(); return child; }
    return super.addChild(child);
  }
}

class InquiryRenderChild extends MarkdownRenderChild {
  private block?: BlockView;
  private current?: string;
  private failure?: HTMLElement;

  constructor(container: HTMLElement, private readonly sourcePath: string, private readonly source: () => string, private readonly options: BlockViewOptions,
    private readonly released: () => void, private readonly editors: { cursors(): Iterable<[FenceCursor, EditorView]> },
    private readonly fenceStartLine: () => number | undefined) {
    super(container);
  }

  /** Reveal a cursor's line if it sits in this block's own fence, in another editor, over this very source. */
  follow(cursor: FenceCursor, view: EditorView): void {
    if (this.block && cursor.path === this.sourcePath && cursor.source === this.current
      && cursor.startLine === this.fenceStartLine() && !view.dom.contains(this.containerEl)) this.block.reveal(cursor.line);
  }

  onload(): void {
    let source: string;
    try { source = this.source(); }
    catch (error) {
      this.failure = this.containerEl.ownerDocument.createElement("p");
      this.failure.setAttribute("role", "status");
      this.failure.textContent = error instanceof Error ? error.message : String(error);
      this.containerEl.append(this.failure);
      return;
    }
    this.block = createBlockView(this.containerEl, this.options);
    this.block.element.classList.add("cog-obsidian");
    this.block.update(this.current = source);
    // A preview rebuilt by an edit starts where the author's cursor already is.
    for (const [cursor, view] of this.editors.cursors()) this.follow(cursor, view);
  }

  onunload(): void {
    this.block?.destroy();
    this.block = undefined;
    this.current = undefined;
    this.failure?.remove();
    this.failure = undefined;
    this.released();
  }
}

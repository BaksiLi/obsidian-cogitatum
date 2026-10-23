import { Component, MarkdownRenderChild, MarkdownRenderer, Plugin, type WorkspaceLeaf } from "obsidian";
import { createBlockView, type BlockView, type BlockViewOptions, type BlockMode } from "@cogitatum/view/block";
import { editSource, ownerLeaf } from "./edit";
import { renderSource } from "./source";

declare const __COGITATUM_LOGO__: string;

declare const __COGITATUM_VERSION__: { label: string; detail: string };

export default class CogitatumPlugin extends Plugin {
  private readonly blocks = new Set<InquiryRenderChild>();
  private readonly modes = new WeakMap<WorkspaceLeaf, Map<string, BlockMode>>();
  private opening: Promise<void> = Promise.resolve();

  onload(): void {
    for (const language of ["cog", "cogitatum"]) {
      this.registerMarkdownCodeBlockProcessor(language, (source, container, context) => {
        const preference = () => {
          const owner = ownerLeaf(this.app, container), section = context.getSectionInfo(container);
          if (!owner || !section) return;
          if (!this.modes.has(owner)) this.modes.set(owner, new Map());
          return { modes: this.modes.get(owner)!, key: `${context.sourcePath}:${section.lineStart}` };
        };
        const child = new InquiryRenderChild(container, () => renderSource(source, context.getSectionInfo(container)), {
          version: __COGITATUM_VERSION__,
          logo: __COGITATUM_LOGO__,
          renderProse: async ({ text, container, signal }) => {
            if (signal.aborted) return;
            const component = new ProseRenderComponent(signal);
            const dispose = () => {
              signal.removeEventListener("abort", dispose);
              component.dispose();
            };
            signal.addEventListener("abort", dispose, { once: true });
            try {
              component.load();
              await MarkdownRenderer.render(this.app, text, container, context.sourcePath, component);
              return dispose;
            } catch (error) {
              dispose(); throw error;
            }
          },
          initialMode: () => { const p = preference(); return p?.modes.get(p.key); },
          onMode: mode => { const p = preference(); p?.modes.set(p.key, mode); },
          onEdit: request => {
            // Serialize pane creation without dropping a request from another block.
            const opening = this.opening.then(() => editSource(this.app, container, context, request));
            this.opening = opening.catch(() => {});
            return opening;
          }
        }, () => this.blocks.delete(child));
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

/** Native postprocessors may continue acquiring resources after their render is cancelled. */
class ProseRenderComponent extends Component {
  private disposed = false;

  constructor(private readonly signal: AbortSignal) { super(); }

  override register(callback: () => unknown): void {
    if (this.disposed || this.signal.aborted) callback();
    else super.register(callback);
  }

  override addChild<T extends Component>(child: T): T {
    if (this.disposed || this.signal.aborted) { child.unload(); return child; }
    return super.addChild(child);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unload();
  }
}

class InquiryRenderChild extends MarkdownRenderChild {
  private block?: BlockView;
  private failure?: HTMLElement;

  constructor(container: HTMLElement, private readonly source: () => string, private readonly options: BlockViewOptions, private readonly released: () => void) {
    super(container);
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
    this.block.update(source);
  }

  onunload(): void {
    this.block?.destroy();
    this.block = undefined;
    this.failure?.remove();
    this.failure = undefined;
    this.released();
  }
}

// Production bundle, real Core/View, and a small stand-in for Obsidian's documented lifecycle.
// This proves browser behavior; it does not substitute for an installed Obsidian check.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { explainSource } from '@cogitatum/core';
import { projectReading } from '@cogitatum/view';
import { version as expectedVersion, logo } from '../build-metadata.mjs';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const pluginVersion = json('../manifest.json').version;
assert.ok(expectedVersion.detail.includes(`Obsidian plugin ${pluginVersion}`));
assert.equal(json('../dist/manifest.json').version, pluginVersion);
const bundle = readFileSync(new URL('../dist/main.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../dist/styles.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('./fixtures/reading-view.cog.md', import.meta.url), 'utf8');
const cjk = '- [C] 9 不是素數。\n  - [linked]\n    - [G] 素數是大於 1，且正因數只有 1 和自身的自然數。\n    - [G] 9 可以被 3 整除，而 3 既不是 1，也不是 9。\n';
const shots = process.env.COGITATUM_SCREENSHOT_DIR;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<!doctype html><style>
    :root { --background-primary:#faf9f5; --background-secondary:#f1efe8; --text-normal:#292822;
      --text-muted:#69675e; --text-faint:#8c897f; --background-modifier-border:#d8d5cb;
      --background-modifier-hover:#e8e5dc; --interactive-accent:#927337; --text-warning:#94651a;
      --text-error:#a03937; --color-red:#a03937; --color-green:#42745b; }
    .theme-dark { --background-primary:#242421; --background-secondary:#2c2c27; --text-normal:#e6e3d8;
      --text-muted:#aaa79b; --text-faint:#8a887d; --background-modifier-border:#46453c; --background-modifier-hover:#3c3b33; }
    body { margin:20px; font:16px/1.5 Georgia,serif; background:var(--background-primary); }
    main { max-width:780px; margin:auto; } svg { pointer-events:none; }
    button { font:inherit; } * { box-sizing:border-box; }
    .markdown-rendered ol { padding-inline-start:0; margin-block:1rem; }
    .markdown-rendered ol > li { margin-inline-start:3ch; padding-block:2px; position:relative; }
    </style><main class="markdown-rendered"><p id="ordinary">Ordinary Markdown remains host-owned.</p></main>`);
  await page.addStyleTag({ content: styles });
  await page.evaluate(() => {
    window.observers = new Set();
    const NativeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      observe(...args) { window.observers.add(this); return super.observe(...args); }
      disconnect() { window.observers.delete(this); return super.disconnect(); }
    };
    class Component {
      children = new Set(); cleanups = []; loads = 0; unloads = 0; unloadCalls = 0;
      load() { if (!this.loaded) { this.loaded = true; this.loads++; this.onload?.(); for (const child of this.children) child.load(); } }
      unload() {
        this.unloadCalls++;
        if (this.loaded) {
          this.loaded = false; this.unloads++;
          for (const child of this.children) { this.children.delete(child); child.unload(); }
          for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
          this.onunload?.();
        }
      }
      addChild(child) { this.children.add(child); if (this.loaded) child.load(); return child; }
      register(cleanup) { this.cleanups.push(cleanup); }
      // The installed Obsidian runtime delegates these registrations through this.register.
      registerEvent(ref) { this.register(() => ref.e.offref(ref)); }
      registerInterval(id) { this.register(() => window.clearInterval(id)); return id; }
    }
    class Events {
      listeners = new Set();
      on(name, callback) { const ref = { e: this, name, callback }; this.listeners.add(ref); return ref; }
      offref(ref) { this.listeners.delete(ref); }
      trigger(name) { for (const ref of this.listeners) if (ref.name === name) ref.callback(); }
    }
    class MarkdownRenderChild extends Component { constructor(container) { super(); this.containerEl = container; } }
    window.markdownRenders = [];
    class MarkdownRenderer {
      static async render(app, text, container, sourcePath, component) {
        const record = { app, text, container, sourcePath, component, loadedAtRender: component.loaded, detachedAtRender: !container.isConnected, cleanups: 0 };
        window.markdownRenders.push(record);
        component.register(() => { record.cleanups++; });
        if (window.renderMarkdown) return window.renderMarkdown(record);
        // Stand-in output proves native delegation and block markup, not Markdown parser fidelity.
        const paragraph = container.ownerDocument.createElement('p');
        const tokens = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
        let from = 0;
        for (const match of text.matchAll(tokens)) {
          paragraph.append(text.slice(from, match.index));
          const node = container.ownerDocument.createElement(match[1] ? 'strong' : 'a');
          node.textContent = match[1] ?? match[2];
          if (!match[1]) { node.setAttribute('href', match[3]); node.dataset.sourcePath = sourcePath; }
          paragraph.append(node); from = match.index + match[0].length;
        }
        paragraph.append(text.slice(from)); container.append(paragraph);
      }
    }
    window.notes = new Map(); window.leaves = []; window.editorEvents = []; window.editorActions = []; window.contexts = new Map(); window.viewStates = 0; window.activeLeaves = [];
    class MarkdownView {
      constructor(container, path, mode = 'preview') { this.containerEl = container; this.file = { path }; this.mode = mode;
        this.editor = {
          getValue: () => window.notes.get(this.file.path),
          getCursor: () => { window.onEditorAction?.('cursor', this); return this.cursor ?? { line: 0, ch: 0 }; },
          setSelection: (from, to) => {
            this.cursor = from; window.editorEvents.push({ path: this.file.path, from, to });
            window.onEditorAction?.('selection', this);
          },
          scrollIntoView: () => { window.editorActions.push('scroll'); window.onEditorAction?.('scroll', this); },
          focus: () => window.editorActions.push('focus')
        };
      }
      getMode() { return this.mode; }
    }
    const split = () => {
      const leaf = { view: new MarkdownView(document.createElement('div'), ''), async setViewState({ state }) {
        window.viewStates++;
        if (window.holdOpen) await new Promise(resolve => { window.releaseOpen = resolve; });
        this.view.file = { path: state.file }; this.view.mode = state.mode;
        window.afterOpen?.(this);
      } };
      window.leaves.push(leaf); return leaf;
    };
    window.app = {
      workspace: { getLeavesOfType: () => window.leaves, createLeafBySplit: split, getLeaf: split, setActiveLeaf(leaf) { window.activeLeaves.push(leaf.view.file.path); window.onActivate?.(leaf); } },
      vault: { getFileByPath: path => window.notes.has(path) ? { path } : null }
    };
    class Plugin extends Component {
      app = window.app;
      processors = new Map();
      registerMarkdownCodeBlockProcessor(language, callback) { this.processors.set(language, callback); }
    }
    window.require = name => { if (name !== 'obsidian') throw Error(`Unexpected runtime dependency: ${name}`); return { Component, Events, Plugin, MarkdownRenderChild, MarkdownRenderer, MarkdownView }; };
    window.module = { exports: {} };
    window.children = new Map();
    window.mount = (id, source, language = 'cog', parent = document.querySelector('main'), options = {}) => {
      const element = parent.ownerDocument.createElement('div');
      element.id = id;
      parent.append(element);
      const path = `${id}.md`;
      // The callback excludes the closing separator, but retains authored trailing blank lines.
      window.notes.set(path, options.note ?? '# Title\n\n```' + language + '\n' + source + '\n```\n\nAfter.');
      window.leaves.push({ view: new MarkdownView(element, path) });
      const context = {
        sourcePath: path, docId: id,
        getSectionInfo: () => options.sectionAvailable === false ? null : ({
          text: window.notes.get(path), lineStart: options.lineStart ?? 2,
          lineEnd: options.lineEnd ?? source.split(/\r\n|\r|\n/).length + 3
        }),
        addChild(child) { window.children.set(id, child); child.load(); }
      };
      window.contexts.set(id, context);
      window.plugin.processors.get(language)(source, element, context);
    };
    window.rerender = (id, source) => {
      window.children.get(id).unload();
      const element = document.getElementById(id);
      const next = document.createElement('div'); next.id = id;
      const leaf = window.leaves.find(l => l.view.containerEl === element);
      // Obsidian constructs the new render child before attaching it to its pane.
      window.plugin.processors.get('cog')(source, next, window.contexts.get(id));
      element.replaceWith(next); leaf.view.containerEl = next;
    };
    window.unmount = id => { window.children.get(id).unload(); window.children.delete(id); document.getElementById(id)?.remove(); };
  });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => { window.plugin = new window.module.exports.default(); window.plugin.load(); });
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => [...window.plugin.processors.keys()]), ['cog', 'cogitatum']);

  // Native Markdown is scoped to compiler-selected prose. Literal note children stay outside the graph.
  const nativeSource = '- [C @native] **Native** [relative](linked.md).\n'
    + '  - [note] **Note** text.\n    - [G @inert] **Literal** inside note.\n'
    + '- Ordinary **Body**.\n- [G +>] **Invalid** stays inspectable.';
  await page.evaluate(source => window.mount('native-prose', source), nativeSource);
  await frames();
  const native = page.locator('#native-prose');
  const nativeRow = native.locator('.cog-reading-row[data-line="1"]');
  assert.equal(await nativeRow.locator('.cog-reading-text strong').textContent(), 'Native');
  assert.equal(await native.locator('.cog-reading-row[data-line="2"] .cog-reading-text strong').textContent(), 'Note');
  assert.equal(await native.locator('.cog-reading-row[data-line="3"] .cog-reading-text strong').textContent(), 'Literal');
  assert.equal(await native.locator('.cog-reading-row[data-line="5"] strong').count(), 0, 'Invalid annotations remain plain text');
  assert.equal(await native.locator('p p, span > div, button .cog-reading-text').count(), 0, 'Native block output has a div container outside controls');
  const nativeCalls = await page.evaluate(() => window.markdownRenders.filter(record => record.sourcePath === 'native-prose.md').map(record => ({
    app: record.app === window.app, loaded: record.loadedAtRender, detached: record.detachedAtRender,
    text: record.text, loads: record.component.loads
  })));
  assert.ok(nativeCalls.length >= 4);
  assert.ok(nativeCalls.every(record => record.app && record.loaded && record.detached && record.loads === 1));
  assert.ok(nativeCalls.every(record => !record.text.includes('Invalid')), 'Diagnostics and invalid/raw syntax never reach the native renderer');
  const link = nativeRow.locator('.cog-reading-text a');
  assert.equal(await link.getAttribute('href'), 'linked.md');
  assert.equal(await link.getAttribute('data-source-path'), 'native-prose.md');
  await link.evaluate(node => node.addEventListener('click', event => event.preventDefault()));
  const editsBeforeLink = await page.evaluate(() => window.editorEvents.length);
  await link.click();
  assert.notEqual(await nativeRow.getAttribute('data-selected'), 'true', 'Native links retain their own interaction');
  await link.focus(); await link.press('Enter');
  assert.notEqual(await nativeRow.getAttribute('data-selected'), 'true', 'Keyboard links do not select Cogitatum occurrences');
  assert.equal(await page.evaluate(() => window.editorEvents.length), editsBeforeLink, 'Links do not navigate the native source editor');
  await nativeRow.focus(); await nativeRow.press('Space');
  await native.getByRole('button', { name: 'Map', exact: true }).click(); await frames();
  assert.equal(await native.locator('.cog-graph .point').count(), 2, 'Only the real Claim and partial invalid Ground exist; the note constructs no Point');
  assert.equal(await native.locator('.cog-block-detail-heading').textContent(), 'Claim @native');
  assert.equal(await native.locator('.cog-block-detail-text strong').textContent(), 'Native');
  assert.equal(await native.locator('.cog-graph strong, .cog-graph a').count(), 0, 'SVG compact labels retain their own renderer');
  const detailRender = await page.evaluate(() => window.markdownRenders.length - 1);
  await native.locator('.cog-graph .point').first().focus(); await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(index => {
    const record = window.markdownRenders[index];
    return { loaded: record.component.loaded, unloads: record.component.unloads, cleanups: record.cleanups };
  }, detailRender), { loaded: false, unloads: 1, cleanups: 1 }, 'Clearing Map unloads its native render component');
  const beforeInvalidMap = await page.evaluate(() => window.markdownRenders.length);
  await native.locator('.cog-graph .point').nth(1).dispatchEvent('click', { detail: 0 });
  assert.equal(await native.locator('.cog-block-detail-text').textContent(), '**Invalid** stays inspectable.');
  assert.equal(await page.evaluate(() => window.markdownRenders.length), beforeInvalidMap, 'A partial Graph IR Point with a failed source occurrence stays plain in Map detail');
  await page.evaluate(() => window.unmount('native-prose'));
  assert.equal(await page.evaluate(() => window.markdownRenders.filter(record => record.sourcePath === 'native-prose.md')
    .every(record => !record.component.loaded && record.component.unloads === 1 && record.cleanups === 1)), true);

  // Abort unloads components immediately, including a renderer whose promise has not settled.
  const deferredStart = await page.evaluate(source => {
    window.renderMarkdown = record => new Promise(resolve => { record.resolve = resolve; });
    const index = window.markdownRenders.length;
    window.mount('native-pending', source); return index;
  }, '- [C] Old **pending** prose.');
  assert.equal(await page.locator('#native-pending .cog-reading-text').textContent(), 'Old **pending** prose.');
  await page.evaluate(() => {
    window.notes.set('native-pending.md', window.notes.get('native-pending.md').replace('Old', 'New'));
    window.rerender('native-pending', '- [C] New **pending** prose.');
  });
  assert.equal(await page.evaluate(index => window.markdownRenders[index].component.loaded, deferredStart), false);
  assert.equal(await page.evaluate(() => window.markdownRenders.at(-1).component.loaded), true);
  await page.evaluate(async index => {
    const record = window.markdownRenders[index];
    record.container.textContent = 'Late native output'; record.resolve();
    await Promise.resolve(); await Promise.resolve();
  }, deferredStart);
  assert.equal(await page.locator('#native-pending .cog-reading-text').textContent(), 'New **pending** prose.');
  assert.equal(await page.locator('#native-pending').getByText('Late native output').count(), 0);
  await page.evaluate(async () => {
    window.unmount('native-pending');
    const record = window.markdownRenders.at(-1);
    record.container.textContent = 'After unload'; record.resolve();
    await Promise.resolve(); await Promise.resolve();
    window.renderMarkdown = undefined;
  });
  assert.equal(await page.evaluate(index => window.markdownRenders.slice(index)
    .every(record => !record.container.isConnected && !record.component.loaded && record.component.unloads === 1 && record.cleanups === 1), deferredStart), true);

  // Postprocessors may acquire resources after abort and keep rendering indefinitely.
  const lateIndex = await page.evaluate(() => {
    const { Component, Events } = window.require('obsidian');
    window.renderMarkdown = async record => {
      const acquire = (alreadyLoaded = false) => {
        const resource = { releases: 0, childReleases: 0, events: new Events(), calls: 0, ticks: 0 };
        record.component.register(() => { resource.releases++; });
        record.component.registerEvent(resource.events.on('test', () => { resource.calls++; }));
        resource.interval = window.setInterval(() => { resource.ticks++; }, 1);
        resource.intervalReturned = record.component.registerInterval(resource.interval);
        resource.child = new Component();
        resource.child.register(() => { resource.childReleases++; });
        if (alreadyLoaded) resource.child.load();
        resource.childReturned = record.component.addChild(resource.child) === resource.child;
        return resource;
      };
      record.beforeAwait = acquire();
      await new Promise(resolve => { record.resume = resolve; });
      record.afterAwait = acquire(true);
      await new Promise(resolve => { record.finish = resolve; });
    };
    const index = window.markdownRenders.length;
    window.mount('native-late-resources', '- [C] Pending postprocessor.');
    return index;
  });
  assert.deepEqual(await page.evaluate(index => {
    const { component, beforeAwait: resource } = window.markdownRenders[index];
    resource.events.trigger('test');
    return { loaded: component.loaded, childLoaded: resource.child.loaded, calls: resource.calls,
      releases: resource.releases, childReturned: resource.childReturned, intervalReturned: resource.intervalReturned === resource.interval };
  }, lateIndex), { loaded: true, childLoaded: true, calls: 1, releases: 0, childReturned: true, intervalReturned: true }, 'Normal registration and child adoption retain native behavior');
  const ticksAtAbort = await page.evaluate(index => {
    window.unmount('native-late-resources');
    return window.markdownRenders[index].beforeAwait.ticks;
  }, lateIndex);
  assert.deepEqual(await page.evaluate(index => {
    const { component, beforeAwait: resource } = window.markdownRenders[index];
    resource.events.trigger('test');
    return { loaded: component.loaded, unloadCalls: component.unloadCalls, childLoaded: resource.child.loaded,
      releases: resource.releases, childReleases: resource.childReleases, listeners: resource.events.listeners.size, calls: resource.calls };
  }, lateIndex), { loaded: false, unloadCalls: 1, childLoaded: false, releases: 1, childReleases: 1, listeners: 0, calls: 1 }, 'Abort releases existing resources before the pending postprocessor resumes');
  await page.evaluate(index => window.markdownRenders[index].resume(), lateIndex);
  await page.waitForFunction(index => !!window.markdownRenders[index].finish, lateIndex);
  await frames();
  const lateResources = () => page.evaluate(index => {
    const record = window.markdownRenders[index], resource = record.afterAwait;
    resource.events.trigger('test');
    return { parentUnloads: record.component.unloadCalls, releases: resource.releases,
      childReleases: resource.childReleases, childLoaded: resource.child.loaded, childLoads: resource.child.loads,
      childUnloads: resource.child.unloadCalls, childReturned: resource.childReturned,
      adopted: record.component.children.has(resource.child), registrations: record.component.cleanups.length,
      listeners: resource.events.listeners.size, calls: resource.calls, ticks: resource.ticks,
      intervalReturned: resource.intervalReturned === resource.interval, previousTicks: record.beforeAwait.ticks };
  }, lateIndex);
  const expectedLateResources = { parentUnloads: 1, releases: 1, childReleases: 1, childLoaded: false,
    childLoads: 1, childUnloads: 1, childReturned: true, adopted: false, registrations: 0,
    listeners: 0, calls: 0, ticks: 0, intervalReturned: true, previousTicks: ticksAtAbort };
  assert.deepEqual(await lateResources(), expectedLateResources, 'Late callback, event, interval and loaded child are released while render is still pending');
  await page.evaluate(async index => {
    window.markdownRenders[index].finish();
    await Promise.resolve(); await Promise.resolve();
    window.renderMarkdown = undefined;
  }, lateIndex);
  await frames();
  assert.deepEqual(await lateResources(), expectedLateResources, 'Late promise completion neither repeats unload nor revives resources');

  await page.evaluate(() => {
    window.renderMarkdown = () => { throw Error('Native Markdown failed'); };
    window.mount('native-failure', '- [C] **Fallback** <img src=x>');
  });
  await frames();
  assert.equal(await page.locator('#native-failure .cog-reading-text').textContent(), '**Fallback** <img src=x>');
  assert.equal(await page.locator('#native-failure strong, #native-failure img').count(), 0);
  assert.equal(await page.evaluate(() => window.markdownRenders.filter(record => record.sourcePath === 'native-failure.md')
    .every(record => !record.component.loaded && record.component.unloads === 1)), true);
  await page.evaluate(() => { window.unmount('native-failure'); window.renderMarkdown = undefined; });

  await page.evaluate(source => window.mount('first', source), source);
  const first = page.locator('#first');
  const mark = first.locator('.cog-block-logo');
  assert.equal(await mark.getAttribute('aria-hidden'), 'true', 'The host mark is decorative');
  assert.equal(await mark.evaluate(element => element.style.maskImage), `url("${logo}")`, 'Build embeds the exact local SVG snapshot');
  assert.equal(await mark.evaluate(element => getComputedStyle(element).backgroundColor === getComputedStyle(element).color), true, 'The mark inherits host ink');
  const version = first.locator('.cog-block-version');
  assert.equal(await version.count(), 1);
  assert.equal(await version.evaluate(el => el.parentElement.lastElementChild === el), true);
  assert.equal(await version.locator('summary').textContent(), expectedVersion.label);
  assert.equal(await version.getAttribute('open'), null, 'Version details start collapsed');
  await version.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.notEqual(await version.getAttribute('open'), null);
  assert.equal(await version.locator('p').innerText(), expectedVersion.detail, 'Production bundle must match current build metadata');
  await page.keyboard.press('Space');
  assert.equal(await version.getAttribute('open'), null);
  assert.equal(await first.locator('.cog-graph').count(), 0, 'Reading should not construct a hidden Map');
  assert.equal(await first.locator('.cog-reading-row[data-occurrence]').count(), 12);
  await frames();
  assert.equal(await first.locator('.cog-reading-lines').evaluate(el =>
    parseFloat(getComputedStyle(el).paddingLeft) === parseFloat(getComputedStyle(el).getPropertyValue('--cog-reading-rail'))
  ), true, 'Host list padding must preserve the reading rail');
  assert.equal(await first.locator('.cog-reading-row').first().evaluate(el => getComputedStyle(el).marginInlineStart), '0px');

  // A local use survives a Map round trip, including its exact source location.
  const localUse = first.locator('.cog-reading-row[data-line="9"]');
  await localUse.click();
  await first.getByRole('button', { name: 'Map', exact: true }).click();
  await frames();
  assert.equal(await first.locator('.cog-graph').evaluate(el => getComputedStyle(el).pointerEvents), 'auto');
  assert.match(await first.locator('.cog-block-detail-text').textContent(), /Responsibility requires/);
  await first.getByRole('button', { name: 'Read passage' }).click();
  assert.equal(await localUse.getAttribute('data-selected'), 'true');
  await localUse.press('Enter');
  await page.waitForFunction(() => window.editorEvents.length === 1);
  assert.equal(await page.evaluate(() => window.editorEvents.at(-1).from.line), 11);
  await first.getByRole('button', { name: 'Edit' }).click();
  assert.equal(await page.evaluate(() => window.leaves.filter(l => l.view.getMode() === 'source').length), 1, 'Editing must reuse the native pane');
  assert.equal(await page.evaluate(() => window.viewStates), 1, 'Reuse must not reset native view state');
  await localUse.focus(); await localUse.press('Escape');
  const caretEdits = await page.evaluate(() => {
    window.leaves.find(l => l.view.getMode() === 'source').view.cursor = { line: 6, ch: 4 };
    return window.editorEvents.length;
  });
  await first.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.evaluate(() => window.editorEvents.length), caretEdits, 'Edit without a selected passage preserves a cursor inside this fence');
  await first.getByRole('button', { name: 'Map', exact: true }).click();
  await page.evaluate(source => window.rerender('first', source), source);
  await frames();
  assert.equal(await first.getByRole('button', { name: 'Map', exact: true }).getAttribute('aria-pressed'), 'true', 'Host rerender must keep the preview in Map');

  // Expansion moves the same view; editing returns it before source lookup and focus.
  const graphElement = await first.locator('.cog-graph').elementHandle();
  await first.getByRole('button', { name: 'Expand', exact: true }).click();
  assert.equal(await page.locator('dialog[open] .cog-graph').count(), 1);
  await page.getByRole('dialog').getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.locator('dialog').count(), 0);
  assert.equal(await graphElement.evaluate(el => el.isConnected && !el.closest('dialog')), true);
  assert.equal(await first.getByRole('button', { name: 'Map', exact: true }).getAttribute('aria-pressed'), 'true');

  // Distinct code blocks may reuse the same names; IDs and selection remain independent.
  await page.evaluate(source => window.mount('second', source, 'cogitatum'), source);
  const second = page.locator('#second');
  await second.getByRole('button', { name: 'Map', exact: true }).click();
  await first.getByRole('button', { name: 'Map', exact: true }).click();
  await frames();
  assert.equal(await page.evaluate(() => {
    const ids = [...document.querySelectorAll('.cog-graph [id]')].map(el => el.id);
    return new Set(ids).size === ids.length;
  }), true);
  assert.equal(await second.locator('.cog-graph [aria-pressed="true"]').count(), 0);
  await page.evaluate(() => window.unmount('first'));
  assert.equal(await second.locator('.cog-graph').count(), 1);
  await page.evaluate(() => window.unmount('second'));
  assert.equal(await page.evaluate(() => window.observers.size), 0);

  // Native navigation must map a local Reading occurrence through the host fence unchanged.
  const localSource = [
    '- [C @shared] Shared \u{1f600} wording.',
    '- [C @claim] Claim.',
    '  - [G use @shared; @route] Local \u{1f600} \u2028 qualification.'
  ].join('\n');
  for (const { id, callbackSource, info, indent = '', fence = '```', eol = '\n', rawCallback = false } of [
    { id: 'metadata', callbackSource: localSource, info: 'cog title="example"' },
    { id: 'indented', callbackSource: localSource, info: 'cog', indent: '  ' },
    { id: 'reading-indented-blank', callbackSource: localSource + '\n', info: 'cog', indent: '  ' },
    { id: 'lp-indented', callbackSource: localSource + '\n', info: 'cog', indent: '  ', rawCallback: true },
    { id: 'trailing-blank', callbackSource: localSource + '\n', info: 'cog' },
    { id: 'trailing-blanks', callbackSource: localSource + '\n\n', info: 'cog' },
    { id: 'crlf-unicode', callbackSource: localSource.replace(/\n/g, '\r\n') + '\r\n',
      info: 'cogitatum title="example"', indent: '  ', fence: '~~~~', eol: '\r\n' },
    { id: 'lp-crlf-unicode', callbackSource: localSource.replace(/\n/g, '\r\n') + '\r\n',
      info: 'cogitatum title="example"', indent: '  ', fence: '~~~~', eol: '\r\n', rawCallback: true }
  ]) {
    const noteText = content => '# Title' + eol + eol + indent + fence + info + eol
      + content.split(/\r\n|\n/).map(line => indent + line).join(eol) + eol + indent + fence + eol + eol + 'After.';
    const note = noteText(callbackSource);
    const reading = projectReading(callbackSource, explainSource(callbackSource, 'document'));
    const occurrence = reading.units[0].occurrences.find(occurrence => occurrence.line === 3);
    const span = occurrence.sourceSpan;
    assert.equal(occurrence.references[0].kind, 'uses');
    assert.notDeepEqual(span, reading.units[0].occurrences[0].sourceSpan, 'Use the local reuse, not its declaration');
    const received = rawCallback ? callbackSource.split(/\r\n|\n/).map(line => indent + line).join(eol) : callbackSource;
    await page.evaluate(({ id, received, language, note }) => {
      window.mount(id, received, language, undefined, { note });
    }, { id, received, language: info.split(' ')[0], note });
    const block = page.locator(`#${id}`);
    assert.equal(await block.locator('.cog-block-issues').isVisible(), false, `${id}: host indentation must not become Cogitatum structure`);
    await block.locator('.cog-reading-row[data-line="3"]').click();
    assert.equal(await block.locator('.cog-reading-row[data-line="3"]').getAttribute('data-selected'), 'true');
    const editsBefore = await page.evaluate(() => window.editorEvents.length);
    await block.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.waitForFunction(count => window.editorEvents.length > count
      || [...document.querySelectorAll('[role="status"]')].some(status => !status.hidden), editsBefore);
    assert.equal(await block.getByRole('status').isVisible(), false, `${id}: unchanged source must remain editable`);
    assert.equal(await page.evaluate(() => window.editorEvents.length), editsBefore + 1);
    const selection = await page.evaluate(() => window.editorEvents.at(-1));
    assert.deepEqual(selection, {
      path: `${id}.md`,
      from: { line: span.startLine + 2, ch: indent.length + span.startColumn - 1 },
      to: { line: span.endLine + 2, ch: indent.length + span.endColumn - 1 }
    }, `${id}: exact local Reading span, with host indentation restored`);
    const selectedText = note.split(/\r\n|\n/)[selection.from.line].slice(selection.from.ch, selection.to.ch);
    assert.equal(selectedText, callbackSource.split(/\r\n|\n/)[span.startLine - 1].slice(span.startColumn - 1, span.endColumn - 1));
    assert.match(selectedText, /Local \u{1f600} \u2028 qualification\./u, 'UTF-16 columns must retain the complete authored prose');
    if (callbackSource.endsWith(eol)) {
      await page.evaluate(({ id, note }) => window.notes.set(`${id}.md`, note), {
        id, note: noteText(callbackSource.slice(0, -eol.length))
      });
      await block.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.waitForFunction(id => !document.getElementById(id).querySelector('[role="status"]').hidden, id);
      assert.match(await block.getByRole('status').textContent(), /source changed/i, `${id}: removing an authored blank line invalidates the preview`);
      assert.equal(await page.evaluate(() => window.editorEvents.length), editsBefore + 1, 'Stale navigation must not move the native selection');
    }
    await page.evaluate(id => window.unmount(id), id);
  }
  assert.equal(await page.evaluate(() => window.observers.size), 0);

  // The section is a revision check, not permission to replace an unrelated callback.
  const guardedNote = '# Title\n\n  ```cog\n'
    + (localSource + '\n').split('\n').map(line => '  ' + line).join('\n') + '\n  ```\n';
  for (const { id, callback, options = {} } of [
    { id: 'old-callback', callback: localSource.replace('Claim.', 'Earlier claim.') + '\n' },
    { id: 'lost-callback-blank', callback: localSource },
    { id: 'wrong-section-start', callback: localSource + '\n', options: { lineStart: 0 } },
    { id: 'wrong-section-end', callback: localSource + '\n', options: { lineEnd: 99 } }
  ]) {
    await page.evaluate(({ id, callback, options, note }) => {
      window.mount(id, callback, 'cog', undefined, { note, ...options });
    }, { id, callback, options, note: guardedNote });
    const block = page.locator(`#${id}`);
    assert.match(await block.getByRole('status').textContent(), /preview no longer matches its source fence/i);
    assert.equal(await block.locator('.cog-block').count(), 0, `${id}: mismatched host source must not be compiled`);
    const failure = await block.getByRole('status').elementHandle();
    await page.evaluate(id => window.unmount(id), id);
    assert.equal(await failure.evaluate(element => element.isConnected), false, 'Unload removes adapter failure UI');
  }
  await page.evaluate(source => window.mount('unlocated', source, 'cog', undefined, { sectionAvailable: false }), localSource);
  const unlocated = page.locator('#unlocated');
  assert.equal(await unlocated.locator('.cog-reading-row[data-occurrence]').count(), 3, 'Unlocated embeds still render their callback');
  const editsBeforeUnlocated = await page.evaluate(() => window.editorEvents.length);
  await unlocated.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.match(await unlocated.getByRole('status').textContent(), /no editable source location/i);
  assert.equal(await page.evaluate(() => window.editorEvents.length), editsBeforeUnlocated);
  await page.evaluate(() => window.unmount('unlocated'));

  // A genuinely empty native fence has no content line between its delimiters.
  await page.evaluate(() => window.mount('native-empty', '', 'cog', undefined, {
    note: '# Title\n\n```cog\n```\n', lineEnd: 3
  }));
  const nativeEmpty = page.locator('#native-empty');
  assert.equal(await nativeEmpty.getByRole('button', { name: 'Map', exact: true }).isDisabled(), true);
  await nativeEmpty.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await nativeEmpty.getByRole('status').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.editorEvents.at(-1)), {
    path: 'native-empty.md', from: { line: 3, ch: 0 }, to: { line: 3, ch: 0 }
  });
  await page.evaluate(() => window.unmount('native-empty'));

  // Delayed editor creation cannot steal focus after its source revision is replaced.
  await page.evaluate(source => { window.mount('pending', source); window.holdOpen = true; }, cjk);
  await page.locator('#pending').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.waitForFunction(() => !!window.releaseOpen);
  const activeBefore = await page.evaluate(() => window.activeLeaves.length);
  await page.evaluate(source => { window.rerender('pending', source); window.holdOpen = false; window.releaseOpen(); }, cjk);
  await frames();
  assert.equal(await page.evaluate(() => window.activeLeaves.length), activeBefore, 'A stale edit request must not steal focus');
  assert.equal(await page.locator('#pending').getByRole('status').isHidden(), true);
  await page.evaluate(() => window.unmount('pending'));

  // Native focus callbacks can unload the preview or replace the opened note.
  // Identical fence text in another note does not authorize navigation to it.
  for (const scenario of ['unload-on-focus', 'wrong-open', 'wrong-on-focus', 'changed-on-focus']) {
    const before = await page.evaluate(({ scenario, source }) => {
      window.mount(scenario, source);
      window.notes.set('other.md', window.notes.get(`${scenario}.md`));
      const replaceFile = leaf => { leaf.view.file = { path: 'other.md' }; };
      if (scenario === 'wrong-open') window.afterOpen = replaceFile;
      if (scenario === 'wrong-on-focus') window.onActivate = replaceFile;
      if (scenario === 'unload-on-focus') window.onActivate = () => window.children.get(scenario).unload();
      if (scenario === 'changed-on-focus') window.onActivate = () => window.notes.set(`${scenario}.md`, 'Changed note.');
      return { selections: window.editorEvents.length, actions: window.editorActions.length, activations: window.activeLeaves.length };
    }, { scenario, source: cjk });
    const block = page.locator(`#${scenario}`);
    await block.getByRole('button', { name: 'Edit', exact: true }).click();
    if (scenario === 'unload-on-focus') {
      await page.waitForFunction(id => !window.children.get(id).loaded, scenario);
      await frames();
    } else {
      await block.getByRole('status').waitFor({ state: 'visible' });
      assert.match(await block.getByRole('status').textContent(), scenario === 'changed-on-focus' ? /source changed/i : /source editor/i);
    }
    assert.equal(await page.evaluate(() => window.editorEvents.length), before.selections, `${scenario}: native selection must remain untouched`);
    assert.equal(await page.evaluate(() => window.editorActions.length), before.actions, `${scenario}: no scrolling or editor focus after invalidation`);
    if (scenario === 'wrong-open') assert.equal(await page.evaluate(() => window.activeLeaves.length), before.activations, 'Do not activate an unexpected note');
    await page.evaluate(id => { window.afterOpen = undefined; window.onActivate = undefined; window.unmount(id); }, scenario);
  }

  // Simulated synchronous native callbacks must stop subsequent editor mutations.
  for (const boundary of ['selection', 'scroll', 'cursor']) {
    for (const invalidation of ['unload', 'source', 'file', 'editor', 'view', 'closed-leaf']) {
      const id = `${boundary}-${invalidation}`;
      const before = await page.evaluate(({ id, boundary, invalidation, source }) => {
        window.mount(id, source);
        window.notes.set('other.md', window.notes.get(`${id}.md`));
        window.editorBoundaryCalls = 0;
        window.onEditorAction = (action, view) => {
          if (action !== boundary) return;
          window.editorBoundaryCalls++;
          window.onEditorAction = undefined;
          if (invalidation === 'unload') window.children.get(id).unload();
          if (invalidation === 'source') window.notes.set(`${id}.md`, 'Changed note.');
          if (invalidation === 'file') view.file = { path: 'other.md' };
          if (invalidation === 'editor') view.editor = { ...view.editor };
          const leaf = window.leaves.find(leaf => leaf.view === view);
          if (invalidation === 'view') leaf.view = { ...view };
          if (invalidation === 'closed-leaf') window.leaves = window.leaves.filter(candidate => candidate !== leaf);
        };
        return { selections: window.editorEvents.length, actions: window.editorActions.length };
      }, { id, boundary, invalidation, source: cjk });
      const block = page.locator(`#${id}`);
      await block.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.waitForFunction(() => window.editorBoundaryCalls === 1);
      if (invalidation === 'unload') {
        assert.equal(await page.evaluate(id => window.children.get(id).loaded, id), false);
      } else {
        await block.getByRole('status').waitFor({ state: 'visible' });
        assert.match(await block.getByRole('status').textContent(), invalidation === 'source' ? /source changed/i : /source editor/i);
      }
      await frames();
      assert.equal(await page.evaluate(() => window.editorEvents.length), before.selections + (boundary === 'cursor' ? 0 : 1), `${id}: do not select after invalidation`);
      assert.deepEqual(await page.evaluate(start => window.editorActions.slice(start), before.actions), boundary === 'scroll' ? ['scroll'] : [], `${id}: no later scroll or focus after a native callback invalidates the request`);
      await page.evaluate(id => { window.onEditorAction = undefined; window.unmount(id); }, id);
    }
  }

  // Requests in separate blocks serialize creation without silently dropping the later edit.
  await page.evaluate(source => { window.mount('queue-a', source); window.mount('queue-b', source); window.holdOpen = true; window.releaseOpen = undefined; }, cjk);
  await page.locator('#queue-a').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.waitForFunction(() => !!window.releaseOpen);
  await page.locator('#queue-b').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.evaluate(() => { window.holdOpen = false; window.releaseOpen(); });
  await page.waitForFunction(() => window.activeLeaves.at(-1) === 'queue-b.md');
  assert.deepEqual(await page.evaluate(() => window.activeLeaves.slice(-2)), ['queue-a.md', 'queue-b.md']);
  await page.evaluate(() => { window.unmount('queue-a'); window.unmount('queue-b'); });

  // Actual pointer gestures on a long Chinese label, not synthetic node clicks.
  await page.evaluate(source => window.mount('chinese', source), cjk);
  const chinese = page.locator('#chinese');
  await chinese.evaluate(el => { el.style.width = '340px'; });
  assert.equal(await chinese.locator('.cog-block-title').isVisible(), false, 'A narrow native pane should adapt even in a wide window');
  assert.equal(await chinese.locator('.cog-block-logo').isVisible(), true, 'The mark remains visible in a narrow pane');
  assert.equal(await chinese.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await chinese.evaluate(el => { el.style.width = ''; });
  await chinese.evaluate(async element => {
    await Promise.allSettled(element.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  if (shots) await page.screenshot({ path: `${shots}/obsidian-reading.png` });
  await chinese.getByRole('button', { name: 'Map', exact: true }).click();
  await frames();
  const ground = chinese.locator('.cog-graph .point').nth(1);
  const label = await ground.locator('.cog-text').boundingBox();
  const at = { x: label.x + label.width / 2, y: label.y + label.height / 2 };
  await page.mouse.click(at.x, at.y);
  assert.equal(await ground.getAttribute('aria-pressed'), 'true');
  const before = await ground.getAttribute('transform');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y - 25, { steps: 8 });
  assert.equal(await chinese.locator('.cog-graph').getAttribute('data-dragging'), 'node');
  await page.mouse.up();
  assert.notEqual(await ground.getAttribute('transform'), before);
  const heldPosition = await ground.getAttribute('transform');
  const claim = chinese.locator('.cog-graph .point').first();
  const settling = await claim.evaluate(node => new Promise(resolve => {
    const values = []; const start = performance.now();
    function sample() { values.push(node.getAttribute('transform')); if (performance.now() - start < 1100) requestAnimationFrame(sample); else resolve(values); }
    requestAnimationFrame(sample);
  }));
  assert.ok(new Set(settling).size > 3, 'Attraction should continue through the joint after release');
  assert.equal(new Set(settling.slice(-5)).size, 1, 'Settling must stop');
  assert.equal(await ground.getAttribute('transform'), heldPosition, 'The released mark stays where it was placed');
  await chinese.getByRole('button', { name: 'Arrange', exact: true }).click();
  const samples = await ground.evaluate(node => new Promise(resolve => {
    const values = []; const start = performance.now();
    function sample() { values.push(node.getAttribute('transform')); if (performance.now() - start < 500) requestAnimationFrame(sample); else resolve(values); }
    requestAnimationFrame(sample);
  }));
  assert.ok(new Set(samples).size > 2, 'Arrange should interpolate after dragging');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ground.focus();
  await ground.press('Alt+ArrowRight');
  await chinese.getByRole('button', { name: 'Arrange', exact: true }).click();
  await frames();
  assert.equal(await ground.getAttribute('transform'), samples.at(-1), 'Reduced motion should reach the same final layout');
  await page.evaluate(() => document.body.classList.add('theme-dark'));
  assert.equal(await chinese.locator('.cog-graph').evaluate(el => getComputedStyle(el).getPropertyValue('--cog-ink').trim()), '#e6e3d8');
  assert.equal(await chinese.locator('.cog-block-logo').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(230, 227, 216)', 'The filled Cog mark follows dark host ink');
  if (shots) await page.screenshot({ path: `${shots}/obsidian-map-dark.png` });
  await page.setViewportSize({ width: 360, height: 800 });
  await frames();
  assert.equal(await chinese.locator('.cog-block-logo').isVisible(), true, 'The Cog mark remains visible on a narrow dark viewport');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await chinese.getByRole('button', { name: 'Reading', exact: true }).click();
  if (shots) await page.screenshot({ path: `${shots}/obsidian-mobile.png` });
  await page.evaluate(() => window.unmount('chinese'));

  // Diagnostics and text remain inspectable; authored markup never becomes HTML.
  const broken = '- [C] <img src=x onerror=alert(1)>\n- [Z] Broken mark.\n- [. use @nowhere] Dangling.\n';
  await page.evaluate(source => window.mount('broken', source), broken);
  const brokenBlock = page.locator('#broken');
  assert.equal(await brokenBlock.locator('img').count(), 0);
  await brokenBlock.locator('.cog-block-issues').click();
  assert.equal(await brokenBlock.locator('.cog-reading-diagnostics').getAttribute('open'), '');
  const diagnostic = projectReading(broken, explainSource(broken, 'document')).diagnostics.find(item => item.sourceSpan);
  const diagnosticSource = brokenBlock.locator('.cog-reading-diagnostic-source').first();
  await diagnosticSource.click();
  assert.deepEqual(await page.evaluate(() => window.editorEvents.at(-1)), {
    path: 'broken.md',
    from: { line: diagnostic.sourceSpan.startLine + 2, ch: diagnostic.sourceSpan.startColumn - 1 },
    to: { line: diagnostic.sourceSpan.endLine + 2, ch: diagnostic.sourceSpan.endColumn - 1 }
  }, 'Shared diagnostic Source uses the same exact guarded native navigation');
  await brokenBlock.getByRole('button', { name: 'Edit' }).click();
  assert.equal(await page.evaluate(() => window.editorEvents.at(-1).path), 'broken.md');
  await page.evaluate(() => window.notes.set('broken.md', 'Externally changed.'));
  const editsBefore = await page.evaluate(() => window.editorEvents.length);
  await brokenBlock.getByRole('button', { name: 'Edit' }).click();
  assert.match(await brokenBlock.getByRole('status').textContent(), /changed/);
  assert.equal(await page.evaluate(() => window.editorEvents.length), editsBefore, 'Do not navigate a stale source range');
  await diagnosticSource.click();
  assert.match(await brokenBlock.getByRole('status').textContent(), /changed/);
  assert.equal(await page.evaluate(() => window.editorEvents.length), editsBefore, 'Diagnostic Source also rejects a stale native fence');
  await page.evaluate(() => window.unmount('broken'));
  await page.evaluate(() => window.mount('empty', ''));
  assert.equal(await page.locator('#empty').getByRole('button', { name: 'Map', exact: true }).isDisabled(), true);

  // A second document models a popout's DOM realm. Disabling the plugin must clean it too.
  await page.evaluate(({ source, styles }) => {
    const frame = document.createElement('iframe'); document.body.append(frame);
    const doc = frame.contentDocument;
    const style = doc.createElement('style'); style.textContent = styles; doc.head.append(style);
    window.mount('popout', source, 'cog', doc.body);
  }, { source: cjk, styles });
  const popout = page.frameLocator('iframe');
  await popout.getByRole('button', { name: 'Map', exact: true }).click();
  assert.equal(await popout.locator('.cog-graph').count(), 1);
  await page.evaluate(() => window.plugin.unload());
  assert.equal(await page.locator('.cog-block').count(), 0);
  assert.equal(await popout.locator('.cog-block').count(), 0);
  assert.equal(await page.evaluate(() => window.observers.size), 0);
  assert.equal(await page.locator('#ordinary').textContent(), 'Ordinary Markdown remains host-owned.');
  assert.deepEqual(errors, []);
  process.stdout.write('Obsidian browser checks passed: native Markdown delegation, note boundaries, links, component load/unload, abort/late completion, failure fallback, Reading/Map, native editing and focus cancellation, 18 simulated cursor/selection/scroll invalidation cases, note identity, local occurrences, raw Live Preview/dedented Reading parity, stale callback rejection, fence metadata/indentation, exact trailing blanks, CRLF/Unicode columns, pointer/settling, diagnostics, themes, narrow width, multiple blocks, second document, and unload.\n');
} finally { await browser.close(); }

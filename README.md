# Cogitatum for Obsidian

This standalone alpha renders explicit `cog` and `cogitatum` code blocks in Obsidian.
Reading presents the original occurrences through the shared `@cogitatum/view` renderer.
Compiler-selected prose uses Obsidian's native Markdown renderer, with the note path retained for links.
Replacing a render cancels its component and disposes resources registered by late native postprocessors.
Map opens on demand with Fit, zoom and Arrange controls; selecting a mark or its wording reveals the full text.
Read passage returns to the current local occurrence, including a reuse of an earlier Point.
Edit opens or reuses a native source pane in the same window, beside the preview on wide windows and below it on narrow windows.
Enter on a Reading occurrence or Map mark selects its exact source range there, retaining a local reuse when selected.
The native editor owns typing, IME, undo and persistence; edits update the host preview without replacing Map with Reading.
The adapter validates the note identity and current fence before navigating and again after native focus callbacks.
It refuses stale source positions and stops when the preview is unloaded during that handoff.
Fence metadata, removed indentation and trailing blank lines retain their exact source mapping.
Reading supplies a dedented code-block callback, while Live Preview preserves the original fenced lines.
Compiling the raw Live Preview callback previously treated the fence's two-space indentation as Cogitatum structure, producing false indentation diagnostics and rejecting unchanged source during Edit.
The adapter now uses the current section's full document text and fence bounds with Core's host extraction to obtain the canonical source before compiling.
It accepts the callback only when it matches either that exact raw fence body or Core's dedented body, allowing line-ending normalization while preserving authored trailing blanks.
An inconsistent callback is rejected rather than replaced with a newer section revision; the canonical render revision remains subject to the editor's stale-source and note-identity checks.
Renders without section information retain their callback unchanged and cannot navigate to native source without an editable location.
Compiler diagnostics remain visible even when only partial structure can be rendered.
The plugin never writes note contents itself or scans other vault files.

Only document-level code fences are supported. Ordinary Markdown outside the fence stays under Obsidian's control. This is a host adapter for the inquiry markup language; it does not infer Cogitatum structure from ordinary Markdown lists or assess the reasoning.

Core compiles each block once; shared View owns reading projection, marks, graph layout and motion.
The shared `@cogitatum/view/block` shell owns the frame, view switching, diagnostics, selection and expansion.
The adapter owns theme variables, native source navigation and Obsidian render-child lifecycle.
Edit reuses an existing source pane without resetting its view state, and preserves the cursor when it is already inside the current fence and no passage is selected.
A replaced or destroyed preview cancels its pending navigation before it can select or focus stale source.
Expand uses the same live views; editing exits the modal before focusing the native editor.
Each Markdown render child owns one immutable source revision and destroys its views when Obsidian replaces it.
Disabling the plugin also releases views in notes that remain open.
No source or selection identifiers are persisted between compilations.
Only the Reading/Map preference is remembered for a pane and fence start line; moving a fence may reset that preference.
Shared Map motion follows the connected component with damped attraction and repulsion, stops within 900 ms of the last movement, and respects earlier manual placements and reduced motion.

## Build and test

Requires Node.js 22.12 or newer and npm.
Core and View are vendored MIT-licensed tarballs; no sibling checkout or private workspace is needed.
The adapter is versioned independently: Obsidian plugin `0.1.0-alpha.2` uses Core, View and Format `0.5.0`.

```sh
npm ci
npm run check
npm run build -- --production
npm exec -- playwright install chromium
npm run test:browser
npm run release
```

`check` validates local package/manifest identity, the public source pin, archive checksums and installed lockfile integrity, then typechecks the adapter.
`test:browser` builds the production bundle before running the browser harness.
`release` repeats those checks and creates `releases/cogitatum-0.1.0-alpha.2.zip` with `main.js`, `styles.css`, `manifest.json` and `LICENSE` at its root.
Creating the ZIP requires the `zip` command (included with macOS; install it separately on Linux if needed).
No command installs the plugin into a vault, publishes a release or modifies notes.

The public Core/View commit and SHA-256 archive digests live in `package.json` under `cogitatumSource`.
When updating the archives, update that pin and both digests together, then regenerate the lockfile and run `npm ci` before checking.
Package versions alone do not identify development builds; both archives can remain `0.5.0` across distinct source commits.
Version details in the plugin expose the public pin and available standalone Git revision.
A source archive builds without Git metadata and is labelled accordingly; retain the release ZIP digest when identifying a tested artifact.

The mark in `assets/cogitatum.svg` is a byte-for-byte snapshot of the accepted Cogitatum geometry.
Build embeds it as a data URL; shared Block renders it as a decorative mask inheriting the Obsidian theme's ink.
The build never reads a website asset or a private version script.

## Local installation and evidence

Extract the release ZIP into `.obsidian/plugins/cogitatum` in a test vault, enable Cogitatum in Community plugins, and reload it after replacing files.
Alternatively, copy `dist/main.js`, `dist/styles.css` and `dist/manifest.json` there.
The package is not published to npm or the Obsidian Community directory.

The browser harness exercises the production bundle with real Core/View and a stand-in for Obsidian registration, native Markdown delegation, editor focus and render-child lifecycle.
Its copied fixture lives in `tests/fixtures`; tests require no website or private workspace.
Coverage includes literal note boundaries, relative links, invalid/raw fallback, pending/late native resource cleanup, exact local source occurrences, Reading/Map, expanded editing, queued/cancelled focus, note identity, stale source guards, raw Live Preview/dedented Reading parity, fence metadata/indentation/trailing blanks, CRLF and Unicode columns, pointer dragging and settling, diagnostics, themes, narrow panes, multiple blocks, a second document and plugin unload.
Set `COGITATUM_SCREENSHOT_DIR` to retain browser screenshots.
This harness is not the Obsidian app and does not establish native desktop or mobile behavior.
Historical native checks from the former integration do not validate this standalone release bundle.
Install/reload and validate the exact release artifact in the real host before claiming that coverage.

## License

MIT; see `LICENSE`.
Vendored Core and View include their own MIT license notices.

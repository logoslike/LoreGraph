# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-01

**Breaking:** world exports now declare `format: "loregraph.universe"` instead of `"loregraph"`,
and files written by v0.1 are no longer importable. 世界导出格式标识由 `loregraph` 改为
`loregraph.universe`，旧文件不再支持导入。

### Added

- World descriptions: create and edit a world's description (up to 20,000 characters) in the
  shared world form; it is shown on the library card and in the inspector's world overview.
- Two-step import: `analyzeImport` reads and validates a file without writing and returns a
  preview (file type, node/edge counts, new and reused types, type conflicts, duplicate node
  names, warnings, validation errors); `commitImport` then writes the plan in one transaction.
  The same preview dialog is used from every entry point.
- Merge import mode: a world file can be merged into the current world instead of creating a new
  one. Types are reused by `(scope, key)`, nodes and edges get fresh ids, name collisions are
  reported but not merged, and self-loops or duplicate relations are kept with a warning.
- Graph snippets (`format: "loregraph.graph"`): export a selection as nodes plus the relations
  whose two endpoints are selected and the types they reference. The export reports how many
  relations were dropped because one endpoint was outside the selection. Snippets can only be
  merged.
- Import/export entry points: the universe library (import as a new world), the inspector's world
  overview (export a world; import a world as new or merged), and the graph toolbar's 更多 menu
  (import/export a graph snippet).
- Automatic layout with elkjs: force-directed (default) and layered top-down modes. Only
  coordinates change; the positions from before the first layout stay in memory and can be
  undone from the success toast or restored from 更多 → 恢复布局前位置, even after further
  layouts.
- Viewport stability: resizing the window or opening/closing the sidebar and inspector keeps the
  content at the canvas centre; the view refits after a layout, a restore, and a snippet import.
- Tolerant list reads from IndexedDB: each row is validated and invalid rows are skipped with a
  console warning instead of failing the whole query; single-record reads stay strict.

### Changed

- The file format is split into two documents that share `formatVersion: 1`: world files
  (`loregraph.universe`) and graph snippets (`loregraph.graph`).
- Existing data is read through the model schemas, so a stored world or node without
  `description` reads as `""`.
- World import is no longer limited to the universe library, and it no longer always creates a new
  world: the inspector can merge a file into the current world.
- The canvas keeps its centre on panel/window resize instead of re-fitting, which would interrupt
  the user's pan and zoom.

### Fixed

- Dialogs sat in the top-left corner of the viewport instead of being centred: Tailwind's
  preflight resets `margin` to `0`, overriding the `margin: auto` native modal dialogs rely
  on. They are centred again and scroll their body internally when the content is taller than the
  viewport.
- Collapsing the sidebar or the inspector could shrink the canvas to zero width: the grid relied
  on auto-placement, and the hidden panel left the main area in a 0-wide first column. The three
  panels now occupy named grid areas.

### Removed

- The v0.1 file format identifier `"loregraph"`. Importing such a file fails with
  `不支持的文件格式：loregraph`; there is no migration or compatibility path.

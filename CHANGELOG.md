# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Workspace header: a fixed 48 px context bar shows the current world name and view (世界名 /
  Graph); the main area is a vertical flex column, so the canvas fills the height below it.
- Grouped node library: sidebar nodes are grouped by type, each group header showing the type
  colour, label, and count, with per-group and whole-list collapse. The collapse preference is
  kept per world in `localStorage`; a search temporarily expands the matching groups.
- Node folding: a node with outgoing relations can be folded, hiding its descendants and the
  relations reaching them, with a badge counting what is hidden. Folding is view state and never
  enters the data model or the export files.
- Relation lanes: parallel and mutual relations between the same pair of nodes are routed onto
  separate lanes with labels on either side instead of stacking on one path.
- Clustered layout: 更多 → 自动布局（按类型）clusters nodes by type before arranging the clusters;
  cross-type relations stay visible.
- A global switch in the graph toolbar that shows or hides direction arrows on every relation.

### Changed

- Desktop layout is a three-column grid (sidebar 264 px, collapsed rail 56 px, inspector 336 px),
  so collapsing a panel widens the canvas instead of overlapping it; below 900 px both panels are
  still overlay drawers.

### Removed

- Unused scaffolding components `BaseInput`, `BaseSelect`, and `ColorField`, an unused
  `createMemoryRepositories` re-export in the repositories barrel, a Tailwind colour mapping with
  no class using it, and an unused node-collapse defaults constant.

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
- Adjacency highlighting: selecting a node keeps it, its direct neighbours, and its incident
  relations sharp while the rest fade (node opacity 0.25, relation opacity 0.15); selecting a
  relation keeps the relation and its two endpoints. Search matches keep their ring on top, and
  nothing fades without a selection.
- Focus Mode (`F` or the toolbar's 聚焦选中节点 button): show only the centre node and its direct
  neighbours, with a banner whose button leaves it again. The centre is session state separate
  from the selection, so selecting another node or clicking empty canvas keeps it; deleting the
  centre, switching worlds, or reloading the graph leaves Focus Mode. `Esc` also leaves it.
- Edge label polish: labels sit on a rounded, padded background and are hidden while zoomed out
  below 0.6 or when the relation is faded. Relations without a custom label still show no label.
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

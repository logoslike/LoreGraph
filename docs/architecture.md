# Architecture

LoreGraph is a Web-first, local-first single-page application. There is no backend, no
account system, and no application server: the product is a set of static assets served by any
HTTP server, and all user data is persisted in the browser with Dexie over IndexedDB. The only
network request at runtime is a `fetch` for the bundled sample world
(`public/examples/emberfall.json`), loaded from the same origin.

This document describes the layering, the contracts between layers, and the behavioural rules
that are easy to get wrong (autosave, undo, import and export, automatic layout, universe
isolation, cascade deletion, and the limitations of running multiple tabs).

## Design principles

1. **Local-first.** The browser is the source of truth. Exporting to JSON is the only backup
   and transfer mechanism.
2. **Thin UI, explicit rules.** Components render state and dispatch intent; business rules
   live in services, not in components or stores.
3. **Validate at the boundary.** Every persisted entity passes through its Zod schema before it
   reaches storage, and every external file is validated before it is imported.
4. **Replaceable persistence.** Services depend on repository interfaces, never on Dexie
   directly, so tests can run entirely in memory or on isolated in-memory IndexedDB databases.
5. **One world at a time.** The workspace is scoped to a single universe loaded through the
   route. The only cross-world operation is importing a file, which either creates a new world or
   merges into the current one.

## Layers

```text
┌──────────────────────────────────────────────────────────────┐
│ views / components         Vue 3 SFCs, Vue Flow canvas,      │
│                            sidebar, inspector, dialogs,      │
│                            toasts                            │
└──────────────────────────────┬───────────────────────────────┘
                               │ reads state / calls actions
┌──────────────────────────────▼───────────────────────────────┐
│ stores + composables       universe, types, graph, ui;       │
│                            useTheme, useToast, useShortcuts, │
│                            useGraphViewport                  │
└──────────────────────────────┬───────────────────────────────┘
                               │ service calls
┌──────────────────────────────▼───────────────────────────────┐
│ services                   business rules, Zod validation,   │
│                            transactions, import/export,      │
│                            automatic layout, debounced       │
│                            autosave, domain errors           │
└──────────────────────────────┬───────────────────────────────┘
                               │ repository interfaces
┌──────────────────────────────▼───────────────────────────────┐
│ repositories               UniverseRepository,               │
│                            NodeRepository, EdgeRepository,   │
│                            EntityTypeRepository,             │
│                            TransactionRunner                 │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ persistence                Dexie database `loregraph` on     │
│                            IndexedDB (src/db/schema.ts);     │
│                            in-memory adapter for tests       │
└──────────────────────────────────────────────────────────────┘
```

### Models (`src/models/`)

Zod schemas and the types inferred from them. Models are pure data descriptions with no
behaviour beyond validation helpers:

- `universe.ts` — `Universe` (world container).
- `type-def.ts` — `EntityType` shared by node types and relation types, distinguished by
  `scope: 'node' | 'relation'`.
- `node.ts` — `LoreNode`, custom property values, canvas position.
- `edge.ts` — `LoreEdge` (relation between two nodes).
- `export-format.ts` — the two versioned file documents, `LoreUniverseFile`
  (`loregraph.universe`) and `LoreGraphFile` (`loregraph.graph`), sharing `formatVersion: 1` (see
  [data-format.md](data-format.md)).
- `ids.ts` — 12-character `[A-Za-z0-9]` identifiers and a central `now()` timestamp source.
- `icons.ts` — whitelisted Lucide icon set for node types.

### Database and repositories (`src/db/`, `src/repositories/`)

`src/db/schema.ts` declares the Dexie database (default name `loregraph`), its tables, and its
indexes:

| Table         | Primary key | Indexes                                                                        |
| ------------- | ----------- | ------------------------------------------------------------------------------ |
| `universes`   | `id`        | `updatedAt`, `name`                                                            |
| `nodes`       | `id`        | `universeId`, `[universeId+type]`, `updatedAt`, `name`                         |
| `edges`       | `id`        | `universeId`, `source`, `target`, `[universeId+source]`, `[universeId+target]` |
| `entityTypes` | `id`        | `universeId`, `[universeId+scope]`, unique `[universeId+scope+key]`            |

`src/repositories/types.ts` declares the persistence contracts: four entity repositories plus a
`TransactionRunner`. Implementations:

- `src/repositories/dexie/` — production persistence. `createDexieRepositories(db)` wires the
  four repositories to one database instance; `DexieTransactionRunner` maps the declared
  `TableName[]` to tables and opens a real `rw` IndexedDB transaction over exactly those tables.
  List queries go through `parseRows`, which validates each row and skips corrupt ones with a
  warning; point reads use a strict `parse`.
- `src/repositories/memory/` — in-memory adapter used by service unit tests. It clones values on
  read and write, but it cannot roll back, so its transaction runner simply executes the
  callback.

`src/repositories/index.ts` re-exports both factories. A transaction is declared as
`tx.run(['nodes', 'edges'], fn)`; all multi-record writes in services go through it.

### Services (`src/services/`)

Services own the business rules and are constructed with a `Repositories` bundle
(`createServices(repos)`), which makes them testable with the memory adapter.

| Module                | Responsibility                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `universe.service.ts` | Create/list/update/delete worlds; seeds the 6 default node types and 6 default relation types for a new world; cascade-deletes a world; loads the bundled sample world (`public/examples/emberfall.json`) through the importer. |
| `graph.service.ts`    | Node and edge CRUD; rejects self-loops and duplicate `(source, target, relationType)` edges; deletes incident edges together with a node inside one transaction; returns snapshots for undo.                                    |
| `type.service.ts`     | Entity type CRUD; refuses to delete a type that is still referenced and reports the reference count.                                                                                                                            |
| `import.service.ts`   | Two-phase import: `analyzeImport` parses and validates a `.loregraph.json` file read-only and returns a preview; `commitImport` writes that plan in one transaction, either as a new world or merged into an existing one.      |
| `export.service.ts`   | Builds a `LoreUniverseFile` for one world, or a `LoreGraphFile` for a node selection (only edges whose two endpoints are selected, and only the types they reference); triggers the browser download.                           |
| `layout.service.ts`   | Computes automatic layout coordinates with elkjs in `force` (default), `layered`, and `clustered` (grouped by node type) modes. Positions only; it never reads or writes storage, and elkjs is imported on first use.           |
| `autosave.ts`         | Per-key debounced autosave used by the graph store.                                                                                                                                                                             |
| `search.ts`           | Pure helpers for name search and type filtering, used by the sidebar node list.                                                                                                                                                 |
| `collapse.ts`         | Pure helpers for node folding: walks the edge list to find the descendants hidden by a folded node and the hidden count per folded node, and reveals the collapsed ancestors that hide a target node.                           |
| `neighborhood.ts`     | Pure 1-hop neighbourhood of a selection: the node, its direct neighbours and incident edges, or a relation and its two endpoints. Ignores dangling edges; backs adjacency highlighting and Focus Mode.                          |
| `errors.ts`           | `LoreGraphError` base class plus `GraphError` and `TypeInUseError`.                                                                                                                                                             |
| `index.ts`            | Composition root: `services` singleton wired to Dexie (`createDexieRepositories(createLoreDatabase())`).                                                                                                                        |

Service APIs are declared as interfaces in `src/services/types.ts` so that stores depend on
contracts rather than implementations.

### Stores and composables (`src/stores/`, `src/composables/`)

Pinia stores hold view state and orchestrate service calls. They are deliberately thin — no
cross-entity invariants live here. Composables wrap store capabilities for components that only
need one narrow behaviour.

- `stores/universe.ts` — world list, the currently selected world, sample-world seeding.
- `stores/types.ts` — node and relation type definitions of the current world, plus lookup
  getters by key.
- `stores/graph.ts` — nodes, edges, selection, the optimistic update path for node edits, and the
  one-level layout snapshot.
- `stores/ui.ts` — theme, panel collapse state, search query, active type filters, toast
  notifications, and the Focus Mode centre. Theme is persisted in `localStorage` under
  `loregraph.theme`; everything else, including the focus centre, is session-only. The first-run
  sample flag (`loregraph.firstRunSeeded`) is owned by the universe view, which loads the sample
  world once when the library is empty.
- `composables/useTheme.ts`, `useToast.ts`, `useShortcuts.ts`, `useGraphViewport.ts` —
  read-only theme access, notification helpers (including the 8-second undo toast), the global
  keyboard shortcuts, and viewport fit/zoom/centre-preservation operations for the canvas.
- `composables/useNodeCollapse.ts` — the fold state of the canvas: which nodes are folded, per
  world, persisted in `localStorage` under `loregraph.node-collapse.<universeId>` and sanitised on
  read; folding is view state and never enters the data model or the export files.
- `composables/useSidebarPreferences.ts` — collapsed groups of the sidebar node library, also per
  world and kept in `localStorage`. A search expands matching groups temporarily without
  overwriting the stored preference.

### Views and components (`src/views/`, `src/components/`)

- `/` — universe list: world cards with description, node/edge/type counts and creation date;
  create, edit (name + description), export, import (always as a new world), and cascade-delete
  actions (with confirmation); the import preview lists validation issues before anything is
  written; theme toggle; loads a built-in Chinese fantasy sample world on first run when the
  library is empty.
- `/u/:universeId` — workspace: a three-pane shell (sidebar, graph canvas, inspector) under a
  fixed 48 px context header that shows the current world name and view. The sidebar collapses to
  a 56 px rail, holds the world switcher, node search, a collapsible type-filter section with
  counts, and the node list grouped by type (colour, label, count per group, per-group and
  whole-list collapse). The canvas renders nodes and relations, creates relations by dragging
  from a node handle into a dialog (relation type + optional label), validates self-loops and
  duplicates, highlights search matches, fades everything outside the selected element's 1-hop
  neighbourhood, folds a node's descendants on demand (from 100 nodes or 300 relations the canvas
  switches to on-demand relations: every node card stays, relation lines start hidden, clicking a
  node reveals all of its direct incoming and outgoing relations, clicking a neighbour reveals the
  next layer, and a node chevron toggles its relations), and offers fit-view, zoom, Focus Mode,
  delete, a global direction-arrow switch, and type-manager actions plus a 更多 menu with all
  three layout modes (force, layered, clustered by type), 恢复布局前位置, and graph-snippet
  import/export. Relations between the same pair of nodes are spread onto separate lanes by
  `edge-lanes.ts`, so parallel and mutual relations stay distinguishable. The inspector edits the
  selected node or edge, lists a node's incident relations, and shows world statistics plus world
  export/import actions when nothing is selected. Keyboard shortcuts: `N` new node, `F` enter/exit Focus Mode,
  `Delete`/`Backspace` delete selection, `Esc` cancel/close and leave Focus Mode,
  `Ctrl/⌘+K` focus search, `?` shortcut help.
- `/:pathMatch(.*)*` — not found page.

Components are grouped as `common/` (primitives, color/icon pickers, confirm, help, and import
preview dialogs), `layout/` (app shell, sidebar, inspector, panel toggles), `editor/` (node/edge
editors, property rows, type select), `universe/` (the shared world create/edit form), and
`graph/` (`GraphCanvas`, `LoreNode`, `LoreEdge` with its lane geometry in `edge-lanes.ts`, the
toolbar, the search panel, create-node/relation dialogs, graph import/export dialogs, and the
type manager). The canvas is built on `@vue-flow/core`
with the background, controls, and minimap add-ons; nodes are one custom Vue Flow node type
mapped from store state, and dragging a node writes its snapped position back to the store on
drag stop. Relation geometry reads one shared obstacle snapshot; while dragging, `@node-drag`
replaces only the moving node's rect and keeps every other rect object identical. The moving node
therefore participates in every relation's obstacle test immediately: paths whose candidate
corridor it enters or leaves reroute during the drag, while relations it cannot touch keep their
previous path array (identity-checked) and are not recomputed. Ports are still chosen from the
stable store coordinates and obstacle avoidance is recomputed exactly once on drop. Below 900 px
the side panels become overlay drawers.

## Autosave and undo

### Autosave

Node edits (typing in the inspector, dragging on the canvas) are applied to the store
immediately — the UI never waits for IndexedDB. `DebouncedAutosave` then coalesces writes:

1. `graph.updateNode` applies the patch to the in-memory node and records the pre-edit
   snapshot the first time a node is touched.
2. The patch is merged into a pending patch for that node, and a task is scheduled under the
   key `node:<id>` with a 400 ms debounce (`AUTOSAVE_DELAY_MS` in `src/services/autosave.ts`).
3. When the timer fires, the merged patch is written through `GraphService.updateNode`, which
   re-validates with Zod and updates `updatedAt`.
4. On success, the saved entity replaces the optimistic one. On failure, the pre-edit snapshot
   is restored and the error is logged, so the UI never shows data that was not persisted.

`graph.flush()` forces all pending saves; the workspace calls it when the view unmounts so that
navigation does not silently drop the last keystrokes. The autosave runner swallows individual
failures (logging them) so one failed write does not block later ones.

Edge edits and structural changes (create, delete) are committed immediately instead of being
debounced, because they cannot be merged into a partial patch.

### Undo

v0.1 introduced a deliberately small undo surface; v0.2 added layout restore; v0.3 adds no
new undoable action — node folding, sidebar collapse, the arrow switch, and the folded-node badge
are view state, so they are deliberately outside the undo model.

- **Deleting a node** is atomic in the service: incident edges and the node are removed in one
  transaction, and the service returns a `DeleteNodeSnapshot` with the node and its edges. The
  store shows a toast with an **撤销** action for 8 seconds; restoring re-inserts the node and
  edges.
- **Deleting an edge** returns the deleted edge and offers the same toast-based undo.
- **Automatic layout** keeps the coordinates from just before the _first_ automatic layout
  (see [Automatic layout](#automatic-layout)); later layouts leave that snapshot alone, so both
  paths return to the state before the first layout. The success toast offers 撤销 for 8 seconds,
  and the 更多 menu keeps 恢复布局前位置 for as long as the snapshot exists.
- **Deleting a universe**, deleting a type, and editing properties are _not_ undoable. Type
  deletion is blocked while references exist, and universe deletion requires explicit
  confirmation in the UI.

There is no undo history stack or redo. Toast actions and the layout snapshot are the only
recovery paths; property edits are optimistic but are only rolled back when persistence fails,
not when the user changes their mind.

## Automatic layout

The graph toolbar's 更多 menu offers 自动布局（力导向） (the default), 自动布局（层级）,
自动布局（按类型）, and 恢复布局前位置.

`computeLayout(nodes, edges, mode)` in `src/services/layout.service.ts` drives elkjs: `force`
runs 120 iterations with a fixed random seed, so the same graph always yields the same result,
`layered` lays components out top-down, and `clustered` groups nodes by the optional `group` key
(the store passes `node.type`), lays out each group with the `force` options, and packs the groups
by their real bounding boxes (240 px horizontal and 200 px vertical gaps, 40 px outer padding) so
a large group cannot overlap its neighbour. Cross-group edges are not passed to elkjs for the
cluster-internal layout, but they are neither removed nor hidden: the canvas still draws them
between the groups. A single group (or nodes without a group) falls back to plain `force`. Node
size is estimated at 210×52 when Vue Flow has not measured a node yet. Edges with a missing
endpoint or a self-loop are dropped before layout, so malformed data cannot make ELK fail. The
function only returns integer top-left coordinates, and it runs only after the user picks a layout
menu item — loading, switching worlds, importing, and type filtering never lay out the graph.

`graph.applyLayout(mode)` is the write path:

1. compute positions, and discard them if the active world changed meanwhile;
2. flush pending per-node autosaves so an older drag cannot land after the layout;
3. remember the current positions as the restore snapshot — only when no snapshot exists yet, so
   the snapshot always holds the state from before the first automatic layout;
4. write every position in one transaction (`updateNodePositions`); if that write fails, the
   in-memory positions are rolled back, no snapshot is recorded, and the error is surfaced as a
   toast.

Layout never changes names, descriptions, properties, types, or edges. The snapshot powers the
撤销 action in the success toast (8 seconds) and 恢复布局前位置 in the menu. Consecutive layouts
show only one 已自动布局 toast — the newest replaces the older one — and its 撤销 still returns to
the positions from before the first layout. Restoring writes the snapshot back and then clears
it. The snapshot is also dropped when the user drags a node (`moveNode`: manual placement
abandons the automatic result) and when the world changes or the graph is reloaded. Nodes deleted
after the snapshot are skipped; nodes created after it keep their current positions. It lives
only in the store, so a page reload loses it.

The canvas fits the view after a layout, a restore, or a snippet import. `useGraphViewport` also
keeps the content at the canvas centre when the window resizes or the side panels open or close:
`preserveCenterOnResize` observes the container and shifts the viewport by the centre delta only,
without changing zoom or calling `fitView`.

## Adjacency highlighting and Focus Mode

Selecting a node keeps it, its direct neighbours (one hop, either direction), and its incident
relations at full strength while everything else fades — node opacity 0.25, relation opacity
0.15. Selecting a relation keeps the relation and its two endpoints. Search matches keep their
ring on top of the faded state. With nothing selected nothing fades. The neighbourhood is
computed over the visible elements only (`src/services/neighborhood.ts` ignores edges with a
missing endpoint), so a selection hidden by a type filter dims nothing.

Focus Mode narrows the canvas to one centre node and its direct neighbours. The centre lives in
the `ui` store as session state, separate from the selection: selecting another node or clicking
empty canvas changes the highlight but not the centre. It is entered with `F` or the toolbar's
聚焦选中节点 button (the button is a no-op when no node is selected) and left with `F`, `Esc`,
the same button, or the canvas banner. Events that invalidate the graph also clear it — deleting the
centre, switching worlds, or reloading the graph exits Focus Mode, and undoing a delete does not
bring it back. While focused, nodes are intersected with the active type filters, only relations
whose two endpoints are visible are drawn, and the canvas refits on entry and exit through
`useGraphViewport.fitAll` (waiting for `nodesInitialized` when new nodes have no size yet).

`F` 键除选中节点外还接受指针悬停的可见节点：悬停目标优先，无有效悬停时回退到选中节点；已聚焦时
悬停其他可见节点会切换聚焦中心，悬停当前中心或没有悬停则退出。工具栏按钮仍只使用选中节点。

Edge labels show the optional per-relation label, never the relation type. They sit on a
rounded, padded background and are hidden while the viewport zoom is below 0.6
(`EDGE_LABEL_MIN_ZOOM`) and on every faded relation.

## Universe isolation

- Every `EntityType`, `LoreNode`, and `LoreEdge` carries a `universeId`. Repositories expose
  universe-scoped queries, and services always pass the owning world id explicitly; there are
  no cross-world reads in normal operation.
- A world's types are unique per `(scope, key)`; nodes and edges refer to types **by key**
  within their own world, never by global id. The database enforces this with a unique compound
  index on `[universeId+scope+key]`.
- The workspace route (`/u/:universeId`) selects the active world. Loading another world
  replaces graph and type state; the previous world's data is untouched in the database.
- Importing either creates a **new** world (fresh identifiers, name suffixed `（导入）`) or merges
  into the current world. Merging only appends: types are matched by `(scope, key)` and nodes and
  edges always get new ids, so it cannot overwrite an existing record. The sample world goes
  through the same new-world path.
- Export is always scoped to exactly one world: a world file contains all of it, a graph snippet
  only the selected nodes, their internal edges, and the types they reference.

## Import and export

Both directions live in `src/services/import.service.ts` and `src/services/export.service.ts`;
the file contract is documented in [data-format.md](data-format.md).

Export reads the database (not in-memory state) and triggers a download:

- `exportUniverse(universeId)` returns a `LoreUniverseFile` with the world record and every type,
  node, and edge of that world, each collection ordered by `createdAt` (ties by id).
- `exportGraph(universeId, nodeIds)` returns `{ data, omittedEdgeCount }`. `data` is a
  `LoreGraphFile` with the selected nodes, only the edges whose two endpoints are selected, and
  only the types those nodes and edges reference; `omittedEdgeCount` counts edges with exactly one
  endpoint selected, which the UI reports as dropped.

Import is deliberately two-phase:

1. **Analyze** — `analyzeImport(raw, { mode, targetUniverseId })` parses and validates the JSON,
   checks ids, type keys, `universeId` consistency, and references, and plans the merge. It never
   writes. The `ImportPreview` carries counts, new/reused/conflicting types, duplicate node names,
   warnings, errors, and an internal `plan`.
2. **Commit** — `commitImport(preview)` re-validates the plan, then writes world, types, nodes, and
   edges in a single Dexie transaction. In `new-universe` mode every id is regenerated, the world
   name gets the `（导入）` suffix, and edge endpoints are remapped; in `merge` mode types are
   matched by `(scope, key)` (an existing type wins, a missing one is appended with the next
   `order`), nodes and edges get fresh ids, and the target world's metadata is untouched. The plan
   fingerprints the target world's update timestamp and its types; if they changed after the
   analysis, the commit aborts with `目标世界在分析后已发生变化，请重新分析后再导入` and writes
   nothing.

Graph snippets can only be merged. Entry points: the universe library (导入世界, new world only), the
inspector's world overview (export a world; import with a mode selector), and the graph toolbar's
更多 menu (import or export a graph snippet). After a snippet import the canvas refits the view.

## Cascade deletion rules

| Action             | Semantics                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Delete universe    | In one transaction: delete its edges, then nodes, then types, then the universe record.                           |
| Delete node        | In one transaction: delete every edge incident to the node, then the node. Returns a snapshot for undo.           |
| Delete edge        | Delete the single record; returns it for undo.                                                                    |
| Delete entity type | Refused while any node or edge of that world references the type key (`TypeInUseError` with the reference count). |

Dexie provides real transactional guarantees; the memory adapter shares the same call sites but
executes them without rollback, which is acceptable for tests.

## Failure handling and validation boundaries

- **Storage boundary:** services parse every entity with its Zod schema before writing, so
  invalid data cannot reach IndexedDB through normal paths.
- **File boundary:** `ImportService.analyzeImport` uses `safeParse` to collect human-readable
  issues instead of throwing, then runs additional referential-integrity checks (unique ids,
  consistent `universeId`, defined type keys, existing edge endpoints, unique type keys per
  scope). Issues carry field paths such as `edges.0.source`. `commitImport` re-validates the plan
  and re-checks the target world's fingerprint inside the transaction before writing.
- **Store boundary:** service errors surface as user-facing toasts; the graph store keeps an
  `error` field for load failures.
- **Read boundary:** list reads validate every row and skip bad ones with a `console.warn`
  instead of failing the whole query (`src/repositories/dexie/parse.ts`); single-record reads and
  all writes stay strict and throw. Zod defaults fill missing optional fields, so a stored world
  or node without `description` reads as `""`. The database schema version is bumped on any
  structural change (see data-format.md for the file format versioning, which is independent).

## Cross-tab limitations

v0.3 does **not** synchronise state between browser tabs:

- There is no `BroadcastChannel`, `SharedWorker`, or storage-event listener. Each tab holds its
  own Pinia state for the same world.
- IndexedDB writes are transactional, so a write is never partially applied; however, each
  entity is written as a whole record, so two tabs editing the same entity are **last write
  wins**. A tab with stale state can overwrite fields another tab changed.
- Autosave timers and the layout snapshot are per tab. Closing a tab with a pending < 400 ms write
  may lose the last keystrokes of that tab, and another tab cannot restore its layout.
- Export reads the database, not the in-memory state, so exporting from tab B can miss tab A's
  unsaved debounce window.
- localStorage preferences (theme, first-run sample flag) are shared between tabs; nothing else
  is.

Practical guidance: work on a world in a single tab, and refresh other tabs after switching.
Adding cross-tab coordination (a `BroadcastChannel` invalidate-and-reload, or Dexie
`liveQuery`) is a natural future extension point, but it is intentionally out of scope for now.

## Extension points

- **New persistence backend / cloud sync** — implement the repository interfaces in
  `src/repositories/types.ts` and pass the bundle to `createServices`. No service or UI code
  needs to change.
- **New tables or indexes** — bump the Dexie version in `src/db/schema.ts`, extend the
  `TableName` union, then add the corresponding repository methods.
- **New entity types or schemas** — add a Zod schema under `src/models/` and extend the export
  format; bump `formatVersion` only for breaking changes.
- **New default type seeds** — edit `DEFAULT_NODE_TYPE_SEEDS` / `DEFAULT_RELATION_TYPE_SEEDS` in
  `src/services/universe.service.ts`. These only affect newly created worlds.
- **New layout modes** — extend `LayoutMode` and, for whole-graph modes, `layoutOptions` in
  `src/services/layout.service.ts`, then expose the mode in `GraphToolbar.vue`. `clustered` shows
  how a mode can compose the existing per-graph layout instead of adding ELK options.
- **New icons** — add the Lucide component to `LUCIDE_ICONS` in `src/models/icons.ts`.
- **Replacing the sample world** — swap `public/examples/emberfall.json`; the path is declared as
  `SAMPLE_UNIVERSE_PATH` in `src/services/universe.service.ts`.
- **Autosave timing** — `AUTOSAVE_DELAY_MS` in `src/services/autosave.ts`.

## Deployment

The build output in `dist/` is a static SPA. The router uses HTML5 history mode
(`createWebHistory`), so the hosting server must rewrite unknown paths to `index.html`;
otherwise deep links such as `/u/<id>` return 404 after a refresh. The sample world is fetched
with a relative URL based on `import.meta.env.BASE_URL`, so deployments under a sub-path work
as long as static assets are served from that base path.

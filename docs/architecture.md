# Architecture

LoreGraph is a Web-first, local-first single-page application. There is no backend, no
account system, and no application server: the product is a set of static assets served by any
HTTP server, and all user data is persisted in the browser with Dexie over IndexedDB. The only
network request at runtime is a `fetch` for the bundled sample world
(`public/examples/emberfall.json`), loaded from the same origin.

This document describes the layering, the contracts between layers, and the behavioural rules
that are easy to get wrong (autosave, undo, universe isolation, cascade deletion, and the
limitations of running multiple tabs).

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
   route; cross-world operations do not exist.

## Layers

```text
┌──────────────────────────────────────────────────────────────┐
│ views / components         Vue 3 SFCs, Vue Flow canvas,      │
│                            sidebar, inspector, dialogs,      │
│                            toasts                            │
└──────────────────────────────┬───────────────────────────────┘
                               │ reads state / calls actions
┌──────────────────────────────▼───────────────────────────────┐
│ composables + Pinia stores  universe, types, graph, ui;     │
│                            useTheme, useToast, useShortcuts  │
└──────────────────────────────┬───────────────────────────────┘
                               │ service calls
┌──────────────────────────────▼───────────────────────────────┐
│ services                   business rules, Zod validation,  │
│                            transactions, import/export,      │
│                            debounced autosave, domain errors │
└──────────────────────────────┬───────────────────────────────┘
                               │ repository interfaces
┌──────────────────────────────▼───────────────────────────────┐
│ repositories               UniverseRepository,              │
│                            NodeRepository, EdgeRepository,   │
│                            EntityTypeRepository,             │
│                            TransactionRunner                 │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ persistence                Dexie database `loregraph` on    │
│                            IndexedDB (src/db/schema.ts);     │
│                            in-memory adapter for tests      │
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
- `export-format.ts` — `LoreExport`, the versioned file format (see
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
| `import.service.ts`   | Parses and validates a `.loregraph.json` file, checks referential integrity, and imports it as a new world with fresh ids.                                                                                                      |
| `export.service.ts`   | Builds a `LoreExport` snapshot for one world and triggers the browser download.                                                                                                                                                 |
| `autosave.ts`         | Per-key debounced autosave used by the graph store.                                                                                                                                                                             |
| `search.ts`           | Pure helpers for name search and type filtering, used by the sidebar node list.                                                                                                                                                 |
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
- `stores/graph.ts` — nodes, edges, selection, and the optimistic update path for node edits.
- `stores/ui.ts` — theme, panel collapse state, search query, active type filters, and toast
  notifications. Theme is persisted in `localStorage` under `loregraph.theme`; everything else
  is session-only. The first-run sample flag (`loregraph.firstRunSeeded`) is owned by the
  universe view, which loads the sample world once when the library is empty.
- `composables/useTheme.ts`, `useToast.ts`, `useShortcuts.ts`, `useGraphViewport.ts` —
  read-only theme access, notification helpers (including the 8-second undo toast), the global
  keyboard shortcuts, and viewport fit/zoom operations for the canvas.

### Views and components (`src/views/`, `src/components/`)

- `/` — universe list: world cards with node/edge/type counts and creation date; create, rename,
  export, and cascade-delete actions (with confirmation); JSON import with a validation-issues
  dialog; theme toggle; loads a built-in Chinese fantasy sample world on first run when the
  library is empty.
- `/u/:universeId` — workspace: a three-pane shell (sidebar, graph canvas, inspector). The
  sidebar holds the world switcher, node search, create-node action, type filters with counts,
  and the filtered node list. The canvas renders nodes and relations, creates relations by
  dragging from a node handle into a dialog (relation type + optional label), validates
  self-loops and duplicates, highlights search matches, and offers fit-view, zoom, delete, and
  type-manager actions. The inspector edits the selected node or edge, lists a node's incident
  relations, and shows world statistics when nothing is selected. Keyboard shortcuts: `N` new
  node, `Delete`/`Backspace` delete selection, `Esc` cancel/close, `Ctrl/⌘+K` focus search, `?`
  shortcut help.
- `/:pathMatch(.*)*` — not found page.

Components are grouped as `common/` (primitives, color/icon pickers, confirm and help
dialogs), `layout/` (app shell, sidebar, inspector, panel toggles), `editor/` (node/edge
editors, property rows, type select), and `graph/` (`GraphCanvas`, `LoreNode`, toolbar,
create-node/relation dialogs, and the type manager). The canvas is built on `@vue-flow/core`
with the background, controls, and minimap add-ons; nodes are one custom Vue Flow node type
mapped from store state, and dragging a node writes its snapped position back to the store on
drag stop. Below 900 px the side panels become overlay drawers.

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

v0.1 has a deliberately small undo surface:

- **Deleting a node** is atomic in the service: incident edges and the node are removed in one
  transaction, and the service returns a `DeleteNodeSnapshot` with the node and its edges. The
  store shows a toast with an **撤销** action for 8 seconds; restoring re-inserts the node and
  edges.
- **Deleting an edge** returns the deleted edge and offers the same toast-based undo.
- **Deleting a universe**, deleting a type, and editing properties are _not_ undoable. Type
  deletion is blocked while references exist, and universe deletion requires explicit
  confirmation in the UI.

There is no undo history stack or redo in v0.1; the toast is the only recovery path for
deletions. Property edits are optimistic but are only rolled back when persistence fails, not
when the user changes their mind.

## Universe isolation

- Every `EntityType`, `LoreNode`, and `LoreEdge` carries a `universeId`. Repositories expose
  universe-scoped queries, and services always pass the owning world id explicitly; there are
  no cross-world reads in normal operation.
- A world's types are unique per `(scope, key)`; nodes and edges refer to types **by key**
  within their own world, never by global id. The database enforces this with a unique compound
  index on `[universeId+scope+key]`.
- The workspace route (`/u/:universeId`) selects the active world. Loading another world
  replaces graph and type state; the previous world's data is untouched in the database.
- Importing always creates a **new** world with fresh identifiers and appends `（导入）` to its
  name, so imports can never overwrite existing data. The sample world goes through the same
  path.
- Export is always scoped to exactly one world and includes its types, nodes, and edges.

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
- **File boundary:** `ImportService.parse` uses `safeParse` to collect human-readable issues
  instead of throwing, then runs additional referential-integrity checks (unique ids, consistent
  `universeId`, defined type keys, existing edge endpoints). Issues carry field paths such as
  `edges.0.source`.
- **Store boundary:** service errors surface as user-facing toasts; the graph store keeps an
  `error` field for load failures.
- **Read boundary:** entities read back from storage are typed by the schema definitions; the
  database schema version is bumped on any structural change (see data-format.md for the file
  format versioning, which is independent).

## Cross-tab limitations

v0.1 does **not** synchronise state between browser tabs:

- There is no `BroadcastChannel`, `SharedWorker`, or storage-event listener. Each tab holds its
  own Pinia state for the same world.
- IndexedDB writes are transactional, so a write is never partially applied; however, each
  entity is written as a whole record, so two tabs editing the same entity are **last write
  wins**. A tab with stale state can overwrite fields another tab changed.
- Autosave timers are per tab. Closing a tab with a pending < 400 ms write may lose the last
  keystrokes of that tab.
- Export reads the database, not the in-memory state, so exporting from tab B can miss tab A's
  unsaved debounce window.
- localStorage preferences (theme, first-run sample flag) are shared between tabs; nothing else
  is.

Practical guidance: work on a world in a single tab, and refresh other tabs after switching.
Adding cross-tab coordination (a `BroadcastChannel` invalidate-and-reload, or Dexie
`liveQuery`) is a natural future extension point, but it is intentionally out of scope for
v0.1.

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

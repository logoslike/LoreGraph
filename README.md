# LoreGraph

**A local-first knowledge graph for building and exploring fictional worlds.**

LoreGraph is a Web-first worldbuilding tool for writers, game masters, and anyone who keeps a
setting bible. Characters, places, factions, events, and objects become nodes on an infinite
canvas; the relationships between them become directed edges. Everything runs in your browser,
everything is saved locally, and there is no account, no backend, and no telemetry.

The interface is written in Chinese; this README is available in
[English](README.md) and [简体中文](README.zh-CN.md).

## Screenshots

**Universe library** — manage multiple worlds from one local library.

![Universe library](docs/screenshots/universes.png)

**Workspace** — graph canvas with the sidebar and inspector (light theme).

![Workspace in light theme](docs/screenshots/workspace-light.png)

| Dark theme                                                      | Inspector                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| ![Workspace in dark theme](docs/screenshots/workspace-dark.png) | ![Inspector editing a node](docs/screenshots/inspector.png)                 |
| The same world with the dark theme.                             | Editing a node's name, type, description, custom properties, and relations. |

All screenshots are captured at 1440×900.

## Features

- **Local-first by design.** Worlds live in IndexedDB in your browser. No sign-up, no server,
  and your data is never uploaded.
- **Graph canvas.** Pan, zoom, drag nodes, and connect them by dragging from a node handle;
  a dialog asks for the relation type and an optional label. The canvas ships with a background
  grid, zoom/fit controls, and a pannable minimap, and validates self-loops and duplicates as
  you connect.
- **Entity types.** Create, rename, recolor, and delete node types and relation types in the
  type manager; each type has a Chinese label, a color, and an optional icon, and shows how many
  nodes or relations use it. New worlds start with six node types (角色, 组织, 地点, 事件, 物品,
  概念) and six relation types (隶属于, 结盟, 位于, 参与, 导致, 相关).
- **Inspector.** Edit a node's name, type, long-form description, and arbitrary custom
  properties (string, number, or boolean); browse its incident relations and jump to them. For
  edges, edit the relation type, label, and properties. When nothing is selected it shows world
  statistics and import/export actions.
- **Search and filters.** Find nodes by name (case-insensitive substring), browse the matches
  in the sidebar node list, see them highlighted on the canvas, and show or hide nodes by type
  with per-type counts.
- **Keyboard shortcuts.** `N` creates a node, `Delete`/`Backspace` deletes the selection,
  `Esc` cancels, `Ctrl/⌘+K` focuses search, `?` opens the shortcut help.
- **Autosave.** Edits are applied to the UI immediately and flushed to IndexedDB after a short
  debounce; failed writes roll back to the last persisted state.
- **Safe deletion.** Deleting a node removes its relations atomically and offers an undo toast.
  A type that is still in use cannot be deleted.
- **Universe management.** Create, rename, and delete worlds from a card library with
  per-world node/edge/type counts; each world has its own types, nodes, and relations.
- **Sample world.** An original Chinese fantasy world (烬海纪元) is bundled and loaded
  automatically the first time you open the app when the library is empty, so it is never an
  empty canvas; it can also be loaded from the empty state.
- **JSON import and export.** Move a world between browsers and back it up as a
  `.loregraph.json` file; import problems are listed with field paths instead of failing
  silently (see [the data format](docs/data-format.md)).
- **Light and dark themes.** Follows your system preference by default and remembers your
  choice.
- **Responsive workspace.** Three panes on desktop; on narrow screens the sidebar and inspector
  become overlay drawers.

## Tech stack

| Area         | Choice                                                         |
| ------------ | -------------------------------------------------------------- |
| UI framework | Vue 3 (Composition API, `<script setup lang="ts">`)            |
| Language     | TypeScript (strict)                                            |
| Build tool   | Vite 8 + `@vitejs/plugin-vue`                                  |
| Styling      | Tailwind CSS v4 with CSS design tokens                         |
| State        | Pinia                                                          |
| Routing      | Vue Router 5 (HTML5 history mode)                              |
| Graph canvas | Vue Flow (`@vue-flow/core` with background, controls, minimap) |
| Persistence  | Dexie 4 over IndexedDB (database `loregraph`)                  |
| Validation   | Zod 4                                                          |
| Icons        | Lucide (`@lucide/vue`)                                         |
| Tests        | Vitest + Vue Test Utils + `fake-indexeddb`; Playwright for E2E |
| Quality      | ESLint (flat config) + Prettier, `vue-tsc` for type checking   |

## Quick start

**Requirements:** Node.js **24.12 or newer** (the `engines` field also allows 22.18+) and
npm.

```bash
npm install
npm run dev          # dev server at http://127.0.0.1:5173
```

Build and preview the production bundle:

```bash
npm run build        # type-check + build into dist/
npm run preview      # serve the built assets
```

Checks and tests:

```bash
npm run type-check
npm run lint
npm run test:unit
```

The suite contains **100 unit tests across 13 files** (Vitest with jsdom and
`fake-indexeddb`) and **27 end-to-end tests across 7 files** (Playwright, Chromium). Install
the browser once and run the E2E suite:

```bash
npx playwright install chromium
npm run test:e2e
```

CI (`.github/workflows/ci.yml`) runs on every push and pull request: lint → type-check → unit
tests → production build → Playwright E2E on Chromium. When the job fails, the Playwright
report and test results are uploaded as artifacts.

## Architecture

The application is layered as **components → Pinia stores/composables → services →
repositories → Dexie**. Business rules and Zod validation live in services; persistence is
hidden behind repository interfaces so tests can run against an in-memory adapter. Stores keep
only view state and orchestrate service calls; components render and dispatch intent.

```text
src/
├─ db/              Dexie database definition (tables and indexes)
├─ models/          Zod schemas and inferred domain types
├─ repositories/    Persistence interfaces + memory and Dexie adapters
├─ services/        Business rules, import/export, autosave, errors
├─ stores/          Pinia stores (universe, types, graph, ui)
├─ composables/     Theme, toast, shortcut and viewport helpers
├─ components/      Vue components: common/, layout/, editor/, graph/
├─ views/           Route-level views
├─ router/          Routes: / (worlds), /u/:universeId (workspace)
└─ styles/          Tailwind entry and design tokens
```

Read [docs/architecture.md](docs/architecture.md) for the full design: autosave and undo
semantics, universe isolation, cascade deletion, and the cross-tab limitations of v0.1.

## Data and privacy

- All data is stored in the browser's IndexedDB. Your worlds are never uploaded, and the app
  makes no request to any third-party server. The only fetch is for the bundled sample world
  file served from the app itself.
- There is no account, no cloud sync, and no analytics.
- Clearing site data (or using a private window) deletes your worlds. **Export regularly** if
  the data matters.
- An export contains the entire world — names, descriptions, custom properties, coordinates,
  and timestamps. Review files before sharing them.
- Format reference: [docs/data-format.md](docs/data-format.md).

## Roadmap

**v0.1 (current)** — graph canvas, search and filters, inspector with custom properties,
universe management, a built-in sample world, JSON import/export, light/dark themes, autosave,
keyboard shortcuts.

**Later, in rough order** — encyclopedia list view, timeline, map view, image attachments,
AI-assisted worldbuilding, cloud sync, real-time collaboration, plugin system.

Ideas and priorities are tracked in GitHub issues; large features are intentionally out of
scope for v0.1 so the core editing loop stays small and reliable.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers the
environment, scripts, code style, testing expectations, and commit conventions. Bug reports and
feature requests use the issue templates in [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE).

## License

[MIT](LICENSE) © 2026 LoreGraph contributors

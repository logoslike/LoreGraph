# Contributing to LoreGraph

Thanks for your interest in LoreGraph. This guide covers the development environment, the
scripts, the conventions this repository follows, and how to get a change merged.

LoreGraph is a **local-first, no-account, no-backend** web application for worldbuilding.
Everything runs in the browser and data lives in IndexedDB. Please keep that constraint in
mind when proposing changes: no server-side features, no telemetry, no remote storage.

## Prerequisites

- [Node.js](https://nodejs.org/) **24.12 or newer**. The `engines` field also allows 22.18+,
  but local development and CI target Node 24.
- **npm** (ships with Node.js). This project uses npm and `package-lock.json`; do not run
  pnpm install, yarn install, or delete the lockfile.
- Git.

For end-to-end tests you also need the Playwright Chromium browser:

```bash
npx playwright install chromium
```

## Getting started

```bash
git clone <repository-url> LoreGraph
cd LoreGraph
npm install
npm run dev
```

The dev server starts on <http://127.0.0.1:5173>.

## Scripts

| Command                   | Description                                                                   |
| ------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`             | Start the Vite dev server.                                                    |
| `npm run build`           | Type-check with vue-tsc and build the production bundle into `dist/`.         |
| `npm run preview`         | Serve the production build locally.                                           |
| `npm run type-check`      | Run `vue-tsc --noEmit`.                                                       |
| `npm run lint`            | Run ESLint over the repository.                                               |
| `npm run lint:fix`        | Run ESLint and apply safe fixes.                                              |
| `npm run format`          | Format with Prettier.                                                         |
| `npm run format:check`    | Check formatting without writing.                                             |
| `npm run test:unit`       | Run the Vitest unit suite once.                                               |
| `npm run test:unit:watch` | Run Vitest in watch mode.                                                     |
| `npm run test:e2e`        | Run Playwright end-to-end specs from `tests/e2e/` (browser install required). |

## Project structure

```text
.
├─ docs/                     Architecture, data format, and screenshots
├─ public/
│  └─ examples/              Bundled sample world (emberfall.json)
├─ src/
│  ├─ db/                    Dexie database definition (tables and indexes)
│  ├─ models/                Zod schemas and inferred domain types
│  ├─ repositories/          Persistence interfaces + memory and Dexie adapters
│  ├─ services/              Business rules, validation, import/export, autosave
│  ├─ stores/                Pinia stores: UI state and graph state
│  ├─ composables/           useTheme, useToast, useShortcuts
│  ├─ components/
│  │  ├─ common/             Reusable primitives and dialogs
│  │  ├─ layout/             App shell, sidebar, inspector, panel toggles
│  │  ├─ editor/             Node/edge editors, property rows, type select
│  │  └─ graph/              Vue Flow canvas and custom node rendering
│  ├─ views/                 Route-level views
│  ├─ router/                Vue Router configuration
│  ├─ styles/                Tailwind entry, design tokens, theme variables
│  ├─ App.vue                Root component
│  └─ main.ts                Application bootstrap
├─ tests/
│  ├─ unit/                  Vitest specs (models, services, repositories)
│  └─ e2e/                   Playwright end-to-end specs
└─ .github/                  CI workflow, issue and pull request templates
```

`src/assets/` is intentionally absent in v0.1: the application ships no binary assets of its own,
so the favicon lives in `public/` and icons come from `@lucide/vue`. Create that directory when the
project needs its own images or fonts, and document it here at the same time.

Read [docs/architecture.md](docs/architecture.md) before changing anything below the view
layer. The intended flow is **components → Pinia stores → services → repositories → Dexie**;
business rules belong in services, and persistence details belong in repositories.

## Coding conventions

- **TypeScript strict mode** is on (`strict`, `noUnusedLocals`, `noUnusedParameters`). Avoid
  `any`; if it is unavoidable, add a short comment explaining why.
- **Vue 3 Composition API** with `<script setup lang="ts"`. Prefer the existing components in
  `src/components/common/` over ad-hoc markup.
- **Language**: UI copy and user-facing text are written in **Chinese**; identifiers, file
  names, and API/interface names are in **English**; code comments are written in Chinese.
- **Formatting** is enforced by Prettier (`.prettierrc.json`: no semicolons, single quotes,
  100 columns). Run `npm run format` before committing.
- **Linting** uses the ESLint flat config in `eslint.config.ts` (Vue essential rules plus the
  TypeScript recommendation set). Do not suppress rules inline without a comment.
- Import project modules through the `@/` alias (mapped to `src/`) instead of long relative
  paths.
- Domain entities are validated with **Zod** schemas in `src/models/`; services throw typed
  errors from `src/services/errors.ts` instead of returning ad-hoc strings.
- Every write path must validate input via the corresponding schema before persisting.
- **Dependencies**: discuss new runtime dependencies in an issue first. Prefer what the
  project already uses and avoid duplicating standard functionality.

## Testing

- Unit and integration tests live in `tests/unit/**/*.spec.ts` (**100 tests across 13 files**)
  and run on Vitest with jsdom and `fake-indexeddb` (see `tests/unit/setup.ts`).
- End-to-end tests live in `tests/e2e/**/*.spec.ts` (**33 tests across 8 files**) and run on
  Playwright with Chromium. Install the browser once with
  `npx playwright install chromium`.
- Service tests can be built on the in-memory repositories:
  `createMemoryRepositories()` + `createServices(repos)`. Persistence tests use
  `createLoreDatabase()` with a per-test database name; `tests/unit/repositories/test-db.ts`
  holds the shared helpers.
- Add tests for new service behaviour, data migrations, and import/export round-trips. UI
  bug fixes should include a regression test where feasible.
- Before opening a pull request, all of these must pass locally:

```bash
npm run lint
npm run type-check
npm run test:unit
npm run build
```

Run the E2E suite locally as well when a change touches the UI, persistence, or import/export:

```bash
npm run test:e2e
```

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request with Node.js 24 and npm. The
single `verify` job runs lint, type-check, unit tests, and the production build, then installs
Chromium and runs the E2E suite; it uploads the Playwright report and test results when it
fails. A pull request is ready to merge only when this job is green.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <short summary>

<optional body explaining why>
```

Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`, `perf`.
Scopes are directory or feature names, for example `graph`, `workspace`, `import`,
`docs`. Example:

```text
feat(graph): 支持拖拽节点后自动保存坐标

节点位置变化按 400ms 防抖写入 IndexedDB，失败时回滚到修改前快照。
```

Keep commits focused: one logical change per commit. Do not commit `node_modules`, `dist`,
`.local`, exported data files, or local credentials.

## Issues and pull requests

1. Search existing issues before opening a new one.
2. Use the bug report or feature request template. For bugs, include reproduction steps,
   browser/OS, and a minimal exported `.loregraph.json` when data is involved.
3. For anything larger than a small fix, open an issue first so the approach can be agreed on.
4. Fork the repository, create a branch (`feat/...`, `fix/...`, `docs/...`), and keep the pull
   request small and reviewable.
5. Link the related issue in the pull request and fill in the checklist.
6. Make sure the checks above pass. Review feedback is addressed with additional commits; avoid
   force-pushing once review has started.

By contributing, you agree that your contributions are licensed under the MIT License.

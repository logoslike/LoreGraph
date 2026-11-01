# Data format — LoreGraph files v1

LoreGraph reads and writes two kinds of UTF-8 JSON documents, both with the
`.loregraph.json` extension:

- **World file** (`format: "loregraph.universe"`) — a complete world: metadata, entity type
  definitions, nodes, and edges. Used for backup and for moving a world between browsers.
- **Graph snippet** (`format: "loregraph.graph"`) — a selected part of a world: some nodes,
  the types they reference, and every edge whose two endpoints are both selected. Used to
  merge part of one world into another.

The canonical source of truth is `src/models/export-format.ts` together with the entity
schemas in `src/models/`. This page documents the current version and the rules around it.

## File kinds

| Kind          | `format`               | Contains                                                    | Import modes            |
| ------------- | ---------------------- | ----------------------------------------------------------- | ----------------------- |
| World file    | `"loregraph.universe"` | `universe`, `types`, `nodes`, `edges`                       | `new-universe`, `merge` |
| Graph snippet | `"loregraph.graph"`    | `types` (referenced only), `nodes`, `edges` (internal only) | `merge` only            |

Both kinds share `formatVersion`, `exportedAt`, `types`, `nodes`, and `edges`.

v0.1 world files declared `format: "loregraph"`. v0.2 does not accept that value: there is no
compatibility path, and such a file fails with `不支持的文件格式：loregraph`. Only the two values
in the table above are valid.

## Top-level structure

| Field           | Type    | Required         | Description                                    |
| --------------- | ------- | ---------------- | ---------------------------------------------- |
| `format`        | string  | yes              | `"loregraph.universe"` or `"loregraph.graph"`. |
| `formatVersion` | number  | yes              | Always `1` for this version.                   |
| `exportedAt`    | integer | yes              | Export timestamp, Unix epoch milliseconds.     |
| `universe`      | object  | world files only | The world being exported.                      |
| `types`         | array   | yes              | Entity type definitions (node + relation).     |
| `nodes`         | array   | yes              | Nodes included in the document.                |
| `edges`         | array   | yes              | Relations included in the document.            |

Arrays may be empty, but every reference inside them must resolve (see
[validation](#validation-rules)).

## The `universe` object

Only world files carry it.

| Field         | Type    | Constraints                           | Description                             |
| ------------- | ------- | ------------------------------------- | --------------------------------------- |
| `id`          | string  | non-empty                             | World id.                               |
| `name`        | string  | 1–120 characters                      | World name.                             |
| `description` | string  | ≤ 20,000 characters, defaults to `""` | Free-form description.                  |
| `createdAt`   | integer | ≥ 0                                   | Creation timestamp (epoch ms).          |
| `updatedAt`   | integer | ≥ 0                                   | Last modification timestamp (epoch ms). |

## Entity types (`types[]`)

Node types and relation types share one structure; `scope` distinguishes them.

| Field        | Type                     | Constraints                           | Description                                                                                                                       |
| ------------ | ------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | string                   | non-empty                             | Type id.                                                                                                                          |
| `universeId` | string                   | world files: must equal `universe.id` | Owning world.                                                                                                                     |
| `scope`      | `"node"` \| `"relation"` | —                                     | Kind of entity this type describes.                                                                                               |
| `key`        | string                   | `^[a-z0-9-]{1,40}$`                   | Stable machine identifier, unique per `(scope, key)` within the document. Node `type` and edge `relationType` reference this key. |
| `label`      | string                   | 1–40 characters                       | Human-readable Chinese label, for example `角色`.                                                                                 |
| `color`      | string                   | `^#[0-9a-fA-F]{6}$`                   | UI color, for example `#6366f1`.                                                                                                  |
| `icon`       | string                   | ≤ 40 characters, optional             | Icon name from the Lucide whitelist in `src/models/icons.ts`. Unknown names fall back to the default icon.                        |
| `order`      | integer                  | any integer                           | Display order within its scope, ascending.                                                                                        |
| `createdAt`  | integer                  | ≥ 0                                   | Creation timestamp.                                                                                                               |
| `updatedAt`  | integer                  | ≥ 0                                   | Last modification timestamp.                                                                                                      |

New worlds are seeded with six node types (`character`, `organization`, `location`, `event`,
`item`, `concept`) and six relation types (`member-of`, `allies-with`, `located-in`,
`participates-in`, `causes`, `related-to`), with `order` starting at 0 in each scope.

A graph snippet contains only the types referenced by its nodes and edges: node types used by
`nodes[].type` and relation types used by `edges[].relationType`.

## Nodes (`nodes[]`)

| Field         | Type    | Constraints                                 | Description                  |
| ------------- | ------- | ------------------------------------------- | ---------------------------- |
| `id`          | string  | non-empty, unique in the document           | Node id.                     |
| `universeId`  | string  | world files: must equal `universe.id`       | Owning world.                |
| `type`        | string  | must match a node type `key` in `types[]`   | Node type.                   |
| `name`        | string  | 1–120 characters                            | Display name.                |
| `description` | string  | ≤ 20,000 characters, defaults to `""`       | Long-form description.       |
| `properties`  | object  | defaults to `{}`; see below                 | Custom key/value attributes. |
| `position`    | object  | `{ "x": number, "y": number }`, both finite | Canvas coordinates.          |
| `createdAt`   | integer | ≥ 0                                         | Creation timestamp.          |
| `updatedAt`   | integer | ≥ 0                                         | Last modification timestamp. |

## Edges (`edges[]`)

| Field          | Type    | Constraints                                   | Description                                        |
| -------------- | ------- | --------------------------------------------- | -------------------------------------------------- |
| `id`           | string  | non-empty, unique in the document             | Edge id.                                           |
| `universeId`   | string  | world files: must equal `universe.id`         | Owning world.                                      |
| `source`       | string  | must match a node `id` in `nodes[]`           | Source node.                                       |
| `target`       | string  | must match a node `id` in `nodes[]`           | Target node.                                       |
| `relationType` | string  | must match a relation type `key` in `types[]` | Relation kind.                                     |
| `label`        | string  | ≤ 120 characters, optional                    | Optional free-form annotation, for example `常驻`. |
| `properties`   | object  | defaults to `{}`                              | Custom key/value attributes.                       |
| `createdAt`    | integer | ≥ 0                                           | Creation timestamp.                                |
| `updatedAt`    | integer | ≥ 0                                           | Last modification timestamp.                       |

Edges are directed (`source` → `target`). Self-loops and duplicate
`(source, target, relationType)` triples are rejected by the application when they are
created, but the file schema itself does not forbid them; the importer reports them as
warnings and keeps them.

### Graph snippets

`ExportService.exportGraph(universeId, nodeIds)` selects the requested node ids that exist in
the world and returns `{ data, omittedEdgeCount }`:

- `nodes` — the selected nodes, in `createdAt` order, with their canvas positions.
- `edges` — only edges whose `source` and `target` are both selected.
- `types` — only the types referenced by those nodes and edges.
- `omittedEdgeCount` — edges with exactly one endpoint selected (dropped because the other
  endpoint is outside the snippet). Edges fully outside the selection are not counted.

`expandWithNeighbors(edges, nodeIds)` is a pure one-hop helper: it returns the seed ids plus
the ids directly connected to them by an edge, without following the graph further.

A graph snippet has no `universe` field and can only be imported with `mode: "merge"`;
requesting `new-universe` for it is an error.

## Custom property values

`properties` is a flat object whose keys are arbitrary strings and whose values are one of:

| Value type | Example  |
| ---------- | -------- |
| `string`   | `"北境"` |
| `number`   | `27`     |
| `boolean`  | `true`   |
| `null`     | `null`   |

Nested objects and arrays are not supported in v1. A property whose value is not one of the
four types above fails validation.

## Example world file

```json
{
  "format": "loregraph.universe",
  "formatVersion": 1,
  "exportedAt": 1767225600000,
  "universe": {
    "id": "u7Qm3xK9pL2a",
    "name": "穹顶之下",
    "description": "一个被风暴包围的浮空群岛世界。",
    "createdAt": 1767139200000,
    "updatedAt": 1767222000000
  },
  "types": [
    {
      "id": "tNXb2kQ8Zr4M",
      "universeId": "u7Qm3xK9pL2a",
      "scope": "node",
      "key": "character",
      "label": "角色",
      "color": "#6366f1",
      "icon": "user-round",
      "order": 0,
      "createdAt": 1767139200000,
      "updatedAt": 1767139200000
    },
    {
      "id": "tRb5Hy7Qe1Ns",
      "universeId": "u7Qm3xK9pL2a",
      "scope": "relation",
      "key": "located-in",
      "label": "位于",
      "color": "#10b981",
      "order": 2,
      "createdAt": 1767139200000,
      "updatedAt": 1767139200000
    }
  ],
  "nodes": [
    {
      "id": "nA1sD4fG7hJ0",
      "universeId": "u7Qm3xK9pL2a",
      "type": "character",
      "name": "林澈",
      "description": "浮空城的年轻守望者。",
      "properties": {
        "年龄": 27,
        "alive": true,
        "头衔": null
      },
      "position": { "x": 120.5, "y": -80 },
      "createdAt": 1767140100000,
      "updatedAt": 1767200000000
    },
    {
      "id": "nB2tE5gH8jK1",
      "universeId": "u7Qm3xK9pL2a",
      "type": "character",
      "name": "苏晚",
      "description": "引路人。",
      "properties": {},
      "position": { "x": 420, "y": 60 },
      "createdAt": 1767140200000,
      "updatedAt": 1767140200000
    }
  ],
  "edges": [
    {
      "id": "eC3uF6hI9kL2",
      "universeId": "u7Qm3xK9pL2a",
      "source": "nA1sD4fG7hJ0",
      "target": "nB2tE5gH8jK1",
      "relationType": "located-in",
      "label": "常驻",
      "properties": { "since": 1024 },
      "createdAt": 1767140300000,
      "updatedAt": 1767140300000
    }
  ]
}
```

## Example graph snippet

```json
{
  "format": "loregraph.graph",
  "formatVersion": 1,
  "exportedAt": 1767225600000,
  "types": [
    {
      "id": "tNXb2kQ8Zr4M",
      "universeId": "u7Qm3xK9pL2a",
      "scope": "node",
      "key": "character",
      "label": "角色",
      "color": "#6366f1",
      "icon": "user-round",
      "order": 0,
      "createdAt": 1767139200000,
      "updatedAt": 1767139200000
    },
    {
      "id": "tRb5Hy7Qe1Ns",
      "universeId": "u7Qm3xK9pL2a",
      "scope": "relation",
      "key": "located-in",
      "label": "位于",
      "color": "#10b981",
      "order": 2,
      "createdAt": 1767139200000,
      "updatedAt": 1767139200000
    }
  ],
  "nodes": [
    {
      "id": "nA1sD4fG7hJ0",
      "universeId": "u7Qm3xK9pL2a",
      "type": "character",
      "name": "林澈",
      "description": "浮空城的年轻守望者。",
      "properties": {},
      "position": { "x": 120.5, "y": -80 },
      "createdAt": 1767140100000,
      "updatedAt": 1767200000000
    },
    {
      "id": "nB2tE5gH8jK1",
      "universeId": "u7Qm3xK9pL2a",
      "type": "character",
      "name": "苏晚",
      "description": "引路人。",
      "properties": {},
      "position": { "x": 420, "y": 60 },
      "createdAt": 1767140200000,
      "updatedAt": 1767140200000
    }
  ],
  "edges": [
    {
      "id": "eC3uF6hI9kL2",
      "universeId": "u7Qm3xK9pL2a",
      "source": "nA1sD4fG7hJ0",
      "target": "nB2tE5gH8jK1",
      "relationType": "located-in",
      "label": "常驻",
      "properties": { "since": 1024 },
      "createdAt": 1767140300000,
      "updatedAt": 1767140300000
    }
  ]
}
```

## Validation rules

`ImportService.analyzeImport(raw, options)` is read-only and never writes to the database. It
returns `{ canImport: false, errors }` rather than throwing, so the UI can list every problem
at once:

1. **JSON syntax.** Invalid JSON reports `JSON 解析失败：<detail>`.
2. **Format and version.** `format` and `formatVersion` are checked before schema validation.
   Unknown formats report `不支持的文件格式：<value>` (a missing field reports
   `不支持的文件格式：缺少 format 字段`); a version other than `1` reports
   `不支持的格式版本：<value>，当前支持 1` (a missing field reports
   `不支持的格式版本：缺少 formatVersion 字段，当前支持 1`). The two checks are independent, so
   a file that is wrong on both counts lists both messages.
3. **Schema validation.** The document is parsed with `LoreUniverseFileSchema` or
   `LoreGraphFileSchema` (Zod). Failures are reported as `<field path>：<message>`, for example
   `nodes.3.name：Too small: expected string to have >=1 characters`. Error paths use dot
   notation, with `根` for the root value.
4. **Uniqueness.** Every id in the document — `universe.id` (world files), every `types[].id`,
   `nodes[].id`, and `edges[].id` — must be unique across the whole document, not merely within
   its own collection. A repeat is reported as `<field path>：id「<id>」重复`.
5. **World consistency.** In a world file, every `universeId` in `types[]`, `nodes[]`, and
   `edges[]` must equal `universe.id`. Graph snippets have no world id to compare against.
6. **Type keys.** Type `key` values must be unique per scope (`node` vs `relation`).
7. **References.**
   - `nodes[].type` must match a node type key.
   - `edges[].source` and `edges[].target` must match node ids.
   - `edges[].relationType` must match a relation type key.

Additional analysis errors:

- A graph snippet requested with `mode: "new-universe"`.
- `mode: "merge"` without `targetUniverseId`, or with a world id that does not exist.

Non-fatal warnings appear in `preview.warnings`: self-loops
(`检测到 N 条自连关系（起点与终点为同一节点），导入后将保留`) and duplicate
`(source, target, relationType)` triples in the file
(`检测到 N 组重复关系（同起点、同终点、同类型），导入后将保留`). Both are kept on import.

If `errors` is empty, `canImport` is `true` and `preview.plan` holds the internal commit plan.

## Import preview

`analyzeImport` returns an `ImportPreview`:

| Field                    | Description                                                                       |
| ------------------------ | --------------------------------------------------------------------------------- |
| `format`                 | File format, or `null` when the file could not be identified.                     |
| `mode`                   | Requested import mode.                                                            |
| `targetUniverseId`       | Merge target, or `null`.                                                          |
| `universeName`           | Name from a world file, or `null` for snippets.                                   |
| `nodeCount`, `edgeCount` | Counts declared by the file.                                                      |
| `newTypes`               | All file types for a new world; in merge mode, the types missing from the target. |
| `reusedTypes`            | Types matched to an existing type by `(scope, key)` (merge only).                 |
| `typeConflicts`          | Same `(scope, key)` but a different `label` or `color`; the existing type wins.   |
| `duplicateNodeNames`     | Incoming node names already used in the merge target (hint only, no merging).     |
| `warnings`               | Non-fatal findings (see above).                                                   |
| `errors`                 | Everything that prevents the import.                                              |
| `canImport`              | `errors.length === 0`.                                                            |
| `plan`                   | Internal plan for `commitImport`; `null` when `canImport` is false.               |

## Committing an import

`ImportService.commitImport(preview)` writes everything in one Dexie transaction over the
`universes`, `entityTypes`, `nodes`, and `edges` tables. It returns
`{ universeId, universeName, createdUniverse, createdTypes, reusedTypes, createdNodes, createdEdges }`.

The plan carries the parsed document; `commitImport` validates it again before writing and
throws `导入计划中的数据已损坏，请重新分析文件` if it no longer parses. A preview that is not
`canImport` is rejected with its first error, and a graph snippet can never reach the
new-universe path.

**New universe** (world files only):

- all ids (world, types, nodes, edges) are regenerated;
- `universeId` fields are rewritten to the new world id;
- `source`/`target` are remapped to the regenerated node ids;
- the world name gets the suffix `（导入）`, truncated if needed to respect the 120-character
  limit;
- the world description, type definitions (label, color, icon, order), and all timestamps are
  copied from the file unchanged.

**Merge** (world files and graph snippets):

- all node and edge ids are regenerated and endpoints are remapped to them;
- types are matched to the target world by `(scope, key)`: an existing type is reused (its
  id, label, and color win), a missing type is created with a new id and an `order` appended
  to its scope;
- the source world's name and description are ignored; target world metadata is untouched;
- nodes whose names already exist in the target are still imported as new nodes (no merging
  by name).

After the analysis, the target world's id, `updatedAt`, and type definitions are fingerprinted
in the plan. `commitImport` re-reads them inside the transaction: if they changed — for example a
type was added, removed, or edited, or the world was deleted — the commit aborts with
`目标世界在分析后已发生变化，请重新分析后再导入` and nothing is written.

## Versioning and migration

- The file format is versioned independently from the IndexedDB schema. `format` and
  `formatVersion` are checked before schema validation: a document with an unknown format or a
  version other than `1` produces a readable error instead of a Zod literal message. v0.2 accepts
  exactly version `1`; there is no upcast chain yet.
- Exports always write the current `formatVersion` and are ordered deterministically by
  `createdAt` (ascending) for each collection.
- **Additive, optional fields** (for example a new optional field on a type) do not require a
  version bump: older files remain valid because the field is optional, and new files remain
  readable by older versions that ignore unknown optional fields only if the schema is
  non-strict. Treat any change that alters required fields, removes fields, renames fields, or
  changes a field's meaning as breaking.
- **Breaking changes** bump `formatVersion` to `2` (and so on). Once version 2 exists, the
  importer must:
  1. read the declared version before schema validation;
  2. apply ordered upcast functions `v1 → v2 → v3 …` to the raw JSON;
  3. validate the upgraded document against the current schema.

  Each migration step should be a small pure function with a fixture of a real historical
  export checked into the test suite, so old files keep working as the format evolves.

- Importing unsupported formats or versions is a hard failure with a readable message; there
  is no best-effort partial import.

## Privacy

The exported file contains every included node and relation: names, descriptions, custom
properties, and coordinates. Timestamps and identifiers are included as well. A world file
contains the whole world. Review a file before sharing it, and do not attach worlds you are not
willing to publish when reporting bugs.

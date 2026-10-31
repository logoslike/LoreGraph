# Data format — LoreExport v1

LoreGraph exports and imports a single world as a UTF-8 JSON document with the file extension
`.loregraph.json` (for example `穹顶之下-20260101.loregraph.json`; characters that are invalid
in file names are replaced with `-`). The document contains everything needed to recreate the
world: its metadata, entity type definitions, nodes, and edges.

The canonical source of truth is `src/models/export-format.ts` together with the entity
schemas in `src/models/`. This page documents the current version and the rules around it.

## Top-level structure

| Field           | Type    | Required | Description                                                 |
| --------------- | ------- | -------- | ----------------------------------------------------------- |
| `format`        | string  | yes      | Always `"loregraph"`.                                       |
| `formatVersion` | number  | yes      | Always `1` for this version.                                |
| `exportedAt`    | integer | yes      | Export timestamp, Unix epoch milliseconds.                  |
| `universe`      | object  | yes      | The world being exported.                                   |
| `types`         | array   | yes      | All entity type definitions of the world (node + relation). |
| `nodes`         | array   | yes      | All nodes of the world.                                     |
| `edges`         | array   | yes      | All relations of the world.                                 |

A minimal valid document only needs the keys above; arrays may be empty, but every reference
inside them must resolve (see [validation](#validation-rules)).

## The `universe` object

| Field         | Type    | Constraints                           | Description                             |
| ------------- | ------- | ------------------------------------- | --------------------------------------- |
| `id`          | string  | non-empty                             | World id.                               |
| `name`        | string  | 1–120 characters                      | World name.                             |
| `description` | string  | ≤ 20,000 characters, defaults to `""` | Free-form description.                  |
| `createdAt`   | integer | ≥ 0                                   | Creation timestamp (epoch ms).          |
| `updatedAt`   | integer | ≥ 0                                   | Last modification timestamp (epoch ms). |

## Entity types (`types[]`)

Node types and relation types share one structure; `scope` distinguishes them.

| Field        | Type                     | Constraints               | Description                                                                                                                    |
| ------------ | ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | string                   | non-empty                 | Type id.                                                                                                                       |
| `universeId` | string                   | must equal `universe.id`  | Owning world.                                                                                                                  |
| `scope`      | `"node"` \| `"relation"` | —                         | Kind of entity this type describes.                                                                                            |
| `key`        | string                   | `^[a-z0-9-]{1,40}$`       | Stable machine identifier, unique per `(scope, key)` within the world. Node `type` and edge `relationType` reference this key. |
| `label`      | string                   | 1–40 characters           | Human-readable Chinese label, for example `角色`.                                                                              |
| `color`      | string                   | `^#[0-9a-fA-F]{6}$`       | UI color, for example `#6366f1`.                                                                                               |
| `icon`       | string                   | ≤ 40 characters, optional | Icon name from the Lucide whitelist in `src/models/icons.ts`. Unknown names fall back to the default icon.                     |
| `order`      | integer                  | any integer               | Display order within its scope, ascending.                                                                                     |
| `createdAt`  | integer                  | ≥ 0                       | Creation timestamp.                                                                                                            |
| `updatedAt`  | integer                  | ≥ 0                       | Last modification timestamp.                                                                                                   |

New worlds are seeded with six node types (`character`, `organization`, `location`, `event`,
`item`, `concept`) and six relation types (`member-of`, `allies-with`, `located-in`,
`participates-in`, `causes`, `related-to`), with `order` starting at 0 in each scope.

## Nodes (`nodes[]`)

| Field         | Type    | Constraints                                 | Description                  |
| ------------- | ------- | ------------------------------------------- | ---------------------------- |
| `id`          | string  | non-empty, unique in the document           | Node id.                     |
| `universeId`  | string  | must equal `universe.id`                    | Owning world.                |
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
| `universeId`   | string  | must equal `universe.id`                      | Owning world.                                      |
| `source`       | string  | must match a node `id` in `nodes[]`           | Source node.                                       |
| `target`       | string  | must match a node `id` in `nodes[]`           | Target node.                                       |
| `relationType` | string  | must match a relation type `key` in `types[]` | Relation kind.                                     |
| `label`        | string  | ≤ 120 characters, optional                    | Optional free-form annotation, for example `常驻`. |
| `properties`   | object  | defaults to `{}`                              | Custom key/value attributes.                       |
| `createdAt`    | integer | ≥ 0                                           | Creation timestamp.                                |
| `updatedAt`    | integer | ≥ 0                                           | Last modification timestamp.                       |

Edges are directed (`source` → `target`). Self-loops and duplicate
`(source, target, relationType)` triples are rejected by the application when they are
created, but the file schema itself does not forbid them; importers should treat such data as
suspect rather than assume it is valid.

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

## Example

```json
{
  "format": "loregraph",
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
      "id": "tKp9Wt4Lm2Vc",
      "universeId": "u7Qm3xK9pL2a",
      "scope": "node",
      "key": "location",
      "label": "地点",
      "color": "#10b981",
      "icon": "map-pin",
      "order": 2,
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
    },
    {
      "id": "tVd8Jc3Pf6Xw",
      "universeId": "u7Qm3xK9pL2a",
      "scope": "relation",
      "key": "allies-with",
      "label": "结盟",
      "color": "#f59e0b",
      "order": 1,
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
      "type": "location",
      "name": "浮空城",
      "description": "悬于云海之上的主城。",
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

`ImportService.parse` runs the following pipeline and returns `{ ok: false, issues }` rather
than throwing, so the UI can list every problem at once:

1. **JSON syntax.** Invalid JSON reports `JSON 解析失败：<detail>`.
2. **Schema validation.** The document is parsed with `LoreExportSchema` (Zod). Failures are
   reported as `<field path>：<message>`, for example `nodes.3.name：Too small: expected string to have >=1 characters`.
   Error paths use dot notation, with `根` for the root value.
3. **Uniqueness.** `universe.id`, every `types[].id`, `nodes[].id`, and `edges[].id` must be
   unique inside the document.
4. **World consistency.** Every `universeId` in `types[]`, `nodes[]`, and `edges[]` must equal
   `universe.id`.
5. **Type keys.** Type `key` values must be unique per scope (`node` vs `relation`).
6. **References.**
   - `nodes[].type` must match a node type key.
   - `edges[].source` and `edges[].target` must match node ids.
   - `edges[].relationType` must match a relation type key.

If any issue is found, nothing is imported. When the document is valid, `ImportService.import`
always creates a **new** world (it never merges into an existing one):

- all ids (world, types, nodes, edges) are regenerated;
- `universeId` fields are rewritten to the new world id;
- `source`/`target` are remapped to the regenerated node ids;
- the world name gets the suffix `（导入）`, truncated if needed to respect the 120-character
  limit;
- the insert happens in a single transaction over the `universes`, `entityTypes`, `nodes`, and
  `edges` tables.

## Versioning and migration

- The file format is versioned independently from the IndexedDB schema. `format` and
  `formatVersion` are literals: a document with an unknown format or a version other than `1`
  fails schema validation and is reported as an unsupported file instead of being guessed at.
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

- Importing unsupported versions is a hard failure with a readable message; there is no
  best-effort partial import.

## Privacy

The exported file contains the entire world: names, descriptions, custom properties, and
coordinates. Timestamps and identifiers are included as well. Review a file before sharing it,
and do not attach worlds you are not willing to publish when reporting bugs.

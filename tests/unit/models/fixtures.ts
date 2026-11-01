import type { LoreEdge } from '@/models/edge'
import type { LoreGraphFile, LoreUniverseFile } from '@/models/export-format'
import {
  LORE_FORMAT_VERSION,
  LORE_GRAPH_FORMAT,
  LORE_UNIVERSE_FORMAT,
} from '@/models/export-format'
import type { LoreNode } from '@/models/node'
import type { EntityType } from '@/models/type-def'
import type { Universe } from '@/models/universe'

/** 固定时间戳，避免断言受系统时间影响。 */
export const TS = 1_700_000_000_000

/** 深拷贝：测试中修改副本，避免污染共享夹具。 */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function makeUniverse(overrides: Partial<Universe> = {}): Universe {
  return {
    id: 'universe-1',
    name: '烬海纪元',
    description: '一片被潮汐反复冲刷的海上文明。',
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  }
}

export function makeNodeType(overrides: Partial<EntityType> = {}): EntityType {
  return {
    id: 'type-node-character',
    universeId: 'universe-1',
    scope: 'node',
    key: 'character',
    label: '角色',
    color: '#6366f1',
    icon: 'user-round',
    order: 0,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  }
}

export function makeRelationType(overrides: Partial<EntityType> = {}): EntityType {
  return {
    id: 'type-relation-allies',
    universeId: 'universe-1',
    scope: 'relation',
    key: 'allies-with',
    label: '结盟',
    color: '#f59e0b',
    order: 0,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  }
}

export function makeNode(overrides: Partial<LoreNode> = {}): LoreNode {
  return {
    id: 'node-1',
    universeId: 'universe-1',
    type: 'character',
    name: '澜舟',
    description: '潮汐教团的引路人。',
    properties: { age: 32, alive: true, title: null },
    position: { x: 10.5, y: -20 },
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  }
}

export function makeEdge(overrides: Partial<LoreEdge> = {}): LoreEdge {
  return {
    id: 'edge-1',
    universeId: 'universe-1',
    source: 'node-1',
    target: 'node-2',
    relationType: 'allies-with',
    label: '亦师亦友',
    properties: {},
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  }
}

/** 一份完整的合法世界文件：1 个世界、2 个类型、2 个节点、1 条关系。 */
export function makeExport(overrides: Partial<LoreUniverseFile> = {}): LoreUniverseFile {
  return {
    format: LORE_UNIVERSE_FORMAT,
    formatVersion: LORE_FORMAT_VERSION,
    exportedAt: TS,
    universe: makeUniverse(),
    types: [makeNodeType(), makeRelationType()],
    nodes: [makeNode(), makeNode({ id: 'node-2', name: '墨鸦', position: { x: 300, y: 160 } })],
    edges: [makeEdge()],
    ...overrides,
  }
}

/** 图谱片段夹具：默认包含两个节点与它们之间唯一的关系。 */
export function makeGraphExport(overrides: Partial<LoreGraphFile> = {}): LoreGraphFile {
  const source = makeExport()
  return {
    format: LORE_GRAPH_FORMAT,
    formatVersion: LORE_FORMAT_VERSION,
    exportedAt: TS,
    types: source.types,
    nodes: source.nodes,
    edges: source.edges,
    ...overrides,
  }
}

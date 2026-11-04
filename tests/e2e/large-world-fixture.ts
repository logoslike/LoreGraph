/**
 * 大图 E2E 固定世界：100 节点（10×10 网格，间距 420×260），5 条关系。
 *
 * 关系刻意覆盖「入边 / 出边 / 邻居下一层 / 远端分支」：
 * - e-in:   n-010 → n-000（入边）
 * - e-out:  n-000 → n-001（出边）
 * - e-next: n-001 → n-002（邻居的下一层）
 * - e-far:  n-090 → n-091（远端分支，用于验证搜索只展开目标一跳）
 * - e-far2: n-091 → n-092
 *
 * 100 节点已达到 nodes>=100 的大图阈值，因此初始不应渲染任何关系线。
 */

export const LARGE_WORLD_NAME = '大图展开测试'
export const LARGE_UNIVERSE_ID = 'u-large-expansion'
export const LARGE_NODE_COUNT = 100
/** 文件里的固定时间戳（2026-01-01T00:00:00Z），只用于让导入结果可复现。 */
export const LARGE_TIMESTAMP = 1767225600000

export const LARGE_EDGE_IDS = {
  incoming: 'e-in',
  outgoing: 'e-out',
  next: 'e-next',
  far: 'e-far',
  far2: 'e-far2',
} as const

/**
 * 实时避障场景：在 100 节点网格上再加一条与 n-000 不相邻的关系。
 * n-000(0,0)、n-001(420,0)、n-010(0,260)，e-cross 从 n-001 左出、n-010 右入，
 * 曲线走廊正好经过 n-000 拖动后可以到达的区域。
 */
export const OBSTACLE_WORLD_NAME = '大图实时避障测试'
export const OBSTACLE_UNIVERSE_ID = 'u-large-obstacles'
export const OBSTACLE_EDGE_IDS = {
  cross: 'e-cross',
} as const

export function largeNodeId(index: number): string {
  return 'n-' + String(index).padStart(3, '0')
}

export function largeNodeName(index: number): string {
  return '节点-' + String(index).padStart(3, '0')
}

function positionOf(index: number): { x: number; y: number } {
  return { x: (index % 10) * 420, y: Math.floor(index / 10) * 260 }
}

function typeOf(
  universeId: string,
  id: string,
  scope: 'node' | 'relation',
  key: string,
  label: string,
  color: string,
  order: number,
): Record<string, unknown> {
  return {
    id,
    universeId,
    scope,
    key,
    label,
    color,
    order,
    createdAt: LARGE_TIMESTAMP,
    updatedAt: LARGE_TIMESTAMP,
  }
}

function nodeOf(universeId: string, index: number): Record<string, unknown> {
  return {
    id: largeNodeId(index),
    universeId,
    type: index % 2 === 0 ? 'character' : 'location',
    name: largeNodeName(index),
    description: '',
    properties: {},
    position: positionOf(index),
    createdAt: LARGE_TIMESTAMP,
    updatedAt: LARGE_TIMESTAMP,
  }
}

function edgeOf(
  universeId: string,
  id: string,
  source: number,
  target: number,
): Record<string, unknown> {
  return {
    id,
    universeId,
    source: largeNodeId(source),
    target: largeNodeId(target),
    relationType: 'related-to',
    label: '',
    properties: {},
    createdAt: LARGE_TIMESTAMP,
    updatedAt: LARGE_TIMESTAMP,
  }
}

function universeOf(id: string, name: string, description: string): Record<string, unknown> {
  return {
    id,
    name,
    description,
    createdAt: LARGE_TIMESTAMP,
    updatedAt: LARGE_TIMESTAMP,
  }
}

/** 折叠阈值场景：99 节点（阈值以下），X→Y→Z 三节点链用于复现跨阈值清理。 */
export const COLLAPSE_WORLD_NAME = '折叠阈值测试'
export const COLLAPSE_UNIVERSE_ID = 'u-collapse-threshold'
export const COLLAPSE_NODE_COUNT = 99

function baseTypes(universeId: string): Record<string, unknown>[] {
  return [
    typeOf(universeId, 't-character', 'node', 'character', '角色', '#6366f1', 0),
    typeOf(universeId, 't-location', 'node', 'location', '地点', '#10b981', 1),
    typeOf(universeId, 't-related-to', 'relation', 'related-to', '相关', '#94a3b8', 0),
  ]
}

function baseWorld(
  universeId: string,
  worldName: string,
  description: string,
): Record<string, unknown> {
  return {
    format: 'loregraph.universe',
    formatVersion: 1,
    exportedAt: LARGE_TIMESTAMP,
    universe: universeOf(universeId, worldName, description),
    types: baseTypes(universeId),
    nodes: Array.from({ length: LARGE_NODE_COUNT }, (_, index) => nodeOf(universeId, index)),
    edges: [
      edgeOf(universeId, LARGE_EDGE_IDS.incoming, 10, 0),
      edgeOf(universeId, LARGE_EDGE_IDS.outgoing, 0, 1),
      edgeOf(universeId, LARGE_EDGE_IDS.next, 1, 2),
      edgeOf(universeId, LARGE_EDGE_IDS.far, 90, 91),
      edgeOf(universeId, LARGE_EDGE_IDS.far2, 91, 92),
    ],
  }
}

export function buildLargeWorld(): Record<string, unknown> {
  return baseWorld(
    LARGE_UNIVERSE_ID,
    LARGE_WORLD_NAME,
    '大图关系按需展开的固定场景：100 节点、5 条关系。',
  )
}

/**
 * 折叠阈值场景：99 节点，只有 X(n-000) → Y(n-001) → Z(n-002) 一条链。
 * 用于复现「93→100 跨阈值后旧折叠重新生效，隐藏的聚焦中心残留」。
 */
export function buildCollapseThresholdWorld(): Record<string, unknown> {
  return {
    format: 'loregraph.universe',
    formatVersion: 1,
    exportedAt: LARGE_TIMESTAMP,
    universe: universeOf(
      COLLAPSE_UNIVERSE_ID,
      COLLAPSE_WORLD_NAME,
      '99 节点；X→Y→Z 三节点链，用于验证跨大图阈值的折叠清理。',
    ),
    types: baseTypes(COLLAPSE_UNIVERSE_ID),
    nodes: Array.from({ length: COLLAPSE_NODE_COUNT }, (_, index) =>
      nodeOf(COLLAPSE_UNIVERSE_ID, index),
    ),
    edges: [
      edgeOf(COLLAPSE_UNIVERSE_ID, 'e-xy', 0, 1),
      edgeOf(COLLAPSE_UNIVERSE_ID, 'e-yz', 1, 2),
    ],
  }
}

/** 大图展开场景 + 一条横穿 n-000 拖动走廊的非关联关系 n-001 → n-010。 */
export function buildObstacleWorld(): Record<string, unknown> {
  const world = baseWorld(
    OBSTACLE_UNIVERSE_ID,
    OBSTACLE_WORLD_NAME,
    '大图实时避障的固定场景：100 节点，含一条横穿 n-000 拖动走廊的非关联关系。',
  )
  ;(world.edges as Record<string, unknown>[]).push(
    edgeOf(OBSTACLE_UNIVERSE_ID, OBSTACLE_EDGE_IDS.cross, 1, 10),
  )
  return world
}

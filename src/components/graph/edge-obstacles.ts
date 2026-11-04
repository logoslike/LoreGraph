import type { InjectionKey, Ref } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from '@/services/layout.service'
import { rectTouchesBounds, type Bounds, type Rect } from './edge-lanes'

/** 节点盒的只读快照：节点 id → 画布坐标与已量尺寸。 */
export type NodeRects = ReadonlyMap<string, Rect>

/**
 * 共享障碍几何：GraphCanvas 提供一份快照，所有关系复用同一份节点盒。
 * 拖动期间快照随 @node-drag 增量更新——只有真正移动的节点盒被替换，
 * 其余盒保持对象身份，因此远端关系的候选列表逐项不变、几何不会被重算。
 */
export const EDGE_OBSTACLES: InjectionKey<Readonly<Ref<NodeRects>>> = Symbol(
  'loregraph.edge-obstacles',
)

/** 读取 Vue Flow 节点当前的画布盒；尺寸未量到时退回默认卡片尺寸。 */
export function nodeRectOf(node: GraphNode): Rect {
  const dimensions = node.dimensions
  return {
    x: node.computedPosition.x,
    y: node.computedPosition.y,
    width: dimensions.width > 0 ? dimensions.width : DEFAULT_NODE_WIDTH,
    height: dimensions.height > 0 ? dimensions.height : DEFAULT_NODE_HEIGHT,
  }
}

/** 两个节点盒的坐标与尺寸是否完全相同（用于复用旧对象、保住引用身份）。 */
export function sameRect(left: Rect, right: Rect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

/**
 * 从共享快照里挑出除两端之外、且可能被这条关系的候选曲线命中的障碍盒。
 */
export function pickObstacles(
  rects: NodeRects,
  source: string,
  target: string,
  bounds: Bounds,
): readonly Rect[] {
  const picked: Rect[] = []
  for (const [id, rect] of rects) {
    if (id === source || id === target) {
      continue
    }
    if (rectTouchesBounds(rect, bounds)) {
      picked.push(rect)
    }
  }
  return picked
}

/**
 * 障碍列表的逐项身份复用：内容或矩形身份有变化时返回新数组，
 * 否则返回上一份数组，让下游 geometry computed 命中缓存。
 * 移动中的节点盒是每帧新建的，因此它一定落在新数组的前后差异里。
 */
export function reuseObstacles(previous: readonly Rect[], next: readonly Rect[]): readonly Rect[] {
  if (previous.length !== next.length) {
    return next
  }
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] !== next[index]) {
      return next
    }
  }
  return previous
}

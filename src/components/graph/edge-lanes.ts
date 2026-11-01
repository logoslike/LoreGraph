import { getSmoothStepPath, Position } from '@vue-flow/core'

/**
 * 平行关系分道的行距（px）。
 * 标签文字 11px + 上下内边距 3px 约 18px 高，36px 行距保证相邻车道的标签盒不重叠。
 */
export const EDGE_LANE_GAP = 36

/** 分道时连接点先水平伸出的距离，与 Vue Flow smoothstep 的默认 offset 保持一致。 */
const EDGE_LANE_STUB = 20

/** 车道折点的圆角半径，与 Vue Flow smoothstep 的默认 borderRadius 一致。 */
const EDGE_LANE_BEND = 5

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 只依赖 id / 两端节点，便于直接用 store 里的边计算车道。 */
export interface LaneEdgeInput {
  id: string
  source: string
  target: string
}

/**
 * 给同一对节点之间的多条关系分配对称车道：0 表示不需要分道。
 * 车道值按 id 排序后交替取正负（+1、-1、+2、-2…），
 * 正数绕到节点下方、负数绕到节点上方，与边的输入顺序无关。
 */
export function assignEdgeLanes(edges: readonly LaneEdgeInput[]): Map<string, number> {
  const groups = new Map<string, LaneEdgeInput[]>()
  for (const edge of edges) {
    const [first, second] =
      edge.source <= edge.target ? [edge.source, edge.target] : [edge.target, edge.source]
    const key = `${first}\u0000${second}`
    const group = groups.get(key)
    if (group) {
      group.push(edge)
    } else {
      groups.set(key, [edge])
    }
  }

  const lanes = new Map<string, number>()
  for (const group of groups.values()) {
    if (group.length === 1) {
      lanes.set(group[0].id, 0)
      continue
    }
    const ordered = [...group].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    ordered.forEach((edge, index) => {
      const track = Math.floor(index / 2) + 1
      lanes.set(edge.id, index % 2 === 0 ? track : -track)
    })
  }
  return lanes
}

/**
 * 选中关系的绘制顺序：把它排到最后，SVG 后绘制的关系（含标签）会盖在其他关系之上。
 * 其余关系保持调用方传入的顺序，避免选中态变化时整层重排。
 */
export function orderEdgesForVisualPriority<T extends { id: string }>(
  edges: readonly T[],
  selectedEdgeId: string | null,
): T[] {
  if (selectedEdgeId === null) {
    return [...edges]
  }
  const selected = edges.filter((edge) => edge.id === selectedEdgeId)
  if (selected.length === 0) {
    return [...edges]
  }
  return [...edges.filter((edge) => edge.id !== selectedEdgeId), ...selected]
}

export interface LanedEdgeGeometry {
  path: string
  labelX: number
  labelY: number
  /** 分道后的折点；车道为 0 时为空数组（此时沿用 Vue Flow 的 smoothstep 路径）。 */
  points: Point[]
}

export interface LanedEdgeInput {
  lane: number
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  sourceRect: Rect
  targetRect: Rect
  /** 连接点伸出距离，默认与 Vue Flow 的 smoothstep offset 一致。 */
  offset?: number
}

function isHorizontal(position: Position): boolean {
  return position === Position.Left || position === Position.Right
}

function distance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/** 去掉连续重复点，避免圆角计算出现零长度方向向量。 */
function dedupe(points: readonly Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const last = result[result.length - 1]
    if (!last || distance(last, point) > 0.01) {
      result.push(point)
    }
  }
  return result
}

function format(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** 用二次贝塞尔把折线拐角磨圆；共线点直接连线，不生成退化曲线。 */
function roundedPath(points: readonly Point[], radius: number): string {
  if (points.length === 0) {
    return ''
  }
  let path = `M ${format(points[0].x)} ${format(points[0].y)}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const next = points[index + 1]
    const bend = Math.min(radius, distance(previous, current) / 2, distance(current, next) / 2)
    if (bend < 0.5) {
      path += ` L ${format(current.x)} ${format(current.y)}`
      continue
    }
    const inX = (current.x - previous.x) / distance(previous, current)
    const inY = (current.y - previous.y) / distance(previous, current)
    const outX = (next.x - current.x) / distance(current, next)
    const outY = (next.y - current.y) / distance(current, next)
    // 叉积为 0 表示三点共线，不需要拐角
    if (Math.abs(inX * outY - inY * outX) < 1e-6) {
      path += ` L ${format(current.x)} ${format(current.y)}`
      continue
    }
    const beforeX = current.x - inX * bend
    const beforeY = current.y - inY * bend
    const afterX = current.x + outX * bend
    const afterY = current.y + outY * bend
    path += ` L ${format(beforeX)} ${format(beforeY)} Q ${format(current.x)} ${format(current.y)} ${format(afterX)} ${format(afterY)}`
  }
  const last = points[points.length - 1]
  path += ` L ${format(last.x)} ${format(last.y)}`
  return path
}

/**
 * 计算一条关系的路径与标签锚点。
 * 车道为 0（一对节点之间只有一条关系）时沿用 Vue Flow 的 smoothstep，
 * 保持现有外观不变；车道非 0 时绕到两个节点整体的上方或下方，
 * 让双向/重复关系的连线与标签彼此分开，也不再从节点盒中穿过。
 */
export function computeLanedEdgeGeometry(input: LanedEdgeInput): LanedEdgeGeometry {
  const smoothStep = (): LanedEdgeGeometry => {
    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX: input.sourceX,
      sourceY: input.sourceY,
      sourcePosition: input.sourcePosition,
      targetX: input.targetX,
      targetY: input.targetY,
      targetPosition: input.targetPosition,
      offset: input.offset,
    })
    return { path, labelX, labelY, points: [] }
  }

  if (
    input.lane === 0 ||
    !isHorizontal(input.sourcePosition) ||
    !isHorizontal(input.targetPosition)
  ) {
    return smoothStep()
  }

  const stub = input.offset ?? EDGE_LANE_STUB
  const sourceStubX = input.sourceX + (input.sourcePosition === Position.Right ? stub : -stub)
  const targetStubX = input.targetX + (input.targetPosition === Position.Left ? -stub : stub)
  const track = Math.abs(input.lane)
  const laneY =
    input.lane > 0
      ? Math.max(
          input.sourceRect.y + input.sourceRect.height,
          input.targetRect.y + input.targetRect.height,
        ) +
        EDGE_LANE_GAP * track
      : Math.min(input.sourceRect.y, input.targetRect.y) - EDGE_LANE_GAP * track

  const points = dedupe([
    { x: input.sourceX, y: input.sourceY },
    { x: sourceStubX, y: input.sourceY },
    { x: sourceStubX, y: laneY },
    { x: targetStubX, y: laneY },
    { x: targetStubX, y: input.targetY },
    { x: input.targetX, y: input.targetY },
  ])

  return {
    path: roundedPath(points, EDGE_LANE_BEND),
    labelX: (sourceStubX + targetStubX) / 2,
    labelY: laneY,
    points,
  }
}

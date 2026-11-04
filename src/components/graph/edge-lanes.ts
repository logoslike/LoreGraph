import { Position } from '@vue-flow/core'

/**
 * 平行关系分道的行距（px）。
 * 标签文字 11px + 上下内边距 3px 约 18px 高，36px 行距保证相邻车道的标签盒不重叠。
 */
export const EDGE_LANE_GAP = 36

/** 普通关系切线控制柄的最大长度，避免曲线为了平缓而绕出很远的弧线。 */
const MAX_TANGENT = 260
/** 自环相对节点上/下边缘的拱高。 */
const SELF_LOOP_LIFT = 64
/** 两端高度差不超过该值时分道用平滑拱，否则改用并集外缘绕行。 */
const LANE_ARC_SPAN = 8
/** 外缘绕行相对节点并集外缘的额外间距。 */
const LANE_STUB = 24
/** 外缘绕行的转角半径：四角都是三次贝塞尔四分之一转，不是圆弧。 */
const STAPLE_CORNER = 18
/** 反向/重叠关系绕过节点并集时的净空。 */
const LOOP_CLEARANCE = 44
/** 标签相对路径锚点的垂直偏移：标签盒高约 17px，偏移后不压在曲线上。 */
const LABEL_OFFSET = 17

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
}

/** 一条关系两端使用的端口 id（LoreNode 的 Handle id）。 */
export interface PortPair {
  sourceHandle: string
  targetHandle: string
}

/**
 * 按两节点的相对方位挑选相向的一对端口（普通关系用）：
 * 比较中心距的主轴，优先水平/垂直中跨度更大的一侧；只有该轴确实存在正间隙才采用，
 * 两盒重叠或退化时回退到原有 right/left 端口，避免触发环绕曲线。
 */
export function choosePorts(source: Rect, target: Rect): PortPair {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2)
  const dy = target.y + target.height / 2 - (source.y + source.height / 2)
  const horizontalGap =
    dx >= 0 ? target.x - (source.x + source.width) : source.x - (target.x + target.width)
  const verticalGap =
    dy >= 0 ? target.y - (source.y + source.height) : source.y - (target.y + target.height)
  const horizontal: PortPair =
    dx >= 0
      ? { sourceHandle: 'right', targetHandle: 'left' }
      : { sourceHandle: 'source-left', targetHandle: 'target-right' }
  const vertical: PortPair =
    dy >= 0
      ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
      : { sourceHandle: 'source-top', targetHandle: 'target-bottom' }
  const dominant = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical'
  if (dominant === 'horizontal' && horizontalGap > 0) {
    return horizontal
  }
  if (dominant === 'vertical' && verticalGap > 0) {
    return vertical
  }
  if (horizontalGap > 0) {
    return horizontal
  }
  if (verticalGap > 0) {
    return vertical
  }
  return { sourceHandle: 'right', targetHandle: 'left' }
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
  /** 只读的其它节点盒（不含两端），用于给普通关系做有界避障候选选择。 */
  obstacles?: readonly Rect[]
}

/** 样条路径点：point 必填，tangent 是前进方向的单位向量，reach 覆盖默认切线长度。 */
interface Waypoint {
  point: Point
  tangent: Point
  reach?: number
}

function isHorizontal(position: Position): boolean {
  return position === Position.Left || position === Position.Right
}

/** 连接点朝节点外侧的方向。 */
function outward(position: Position): Point {
  switch (position) {
    case Position.Left:
      return { x: -1, y: 0 }
    case Position.Right:
      return { x: 1, y: 0 }
    case Position.Top:
      return { x: 0, y: -1 }
    default:
      return { x: 0, y: 1 }
  }
}

/** 连接点的入线方向：沿路径前进进入节点，与 outward 相反。 */
function inward(position: Position): Point {
  const vector = outward(position)
  return { x: -vector.x, y: -vector.y }
}

function distance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

function format(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function add(point: Point, vector: Point, scaleValue = 1): Point {
  return { x: point.x + vector.x * scaleValue, y: point.y + vector.y * scaleValue }
}

/** 节点右边缘。 */
function rightOf(rect: Rect): number {
  return rect.x + rect.width
}

/** 两个节点盒是否在内部区域相交（贴边不算）。 */
function boxesOverlap(first: Rect, second: Rect): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  )
}

/** 两个节点盒是否完全相同（自环，或两个节点恰好叠在同一点）。 */
function sameRect(first: Rect, second: Rect): boolean {
  return (
    Math.abs(first.x - second.x) < 0.5 &&
    Math.abs(first.y - second.y) < 0.5 &&
    Math.abs(first.width - second.width) < 0.5 &&
    Math.abs(first.height - second.height) < 0.5
  )
}

/**
 * BaseEdge 用 labelX && labelY 判断是否渲染标签（@vue-flow/core 1.48.2 dist:7263），
 * 坐标恰好为 0 时标签会静默消失；退让 0.01px 规避该实现细节。
 */
function avoidZero(value: number): number {
  return value === 0 ? 0.01 : value
}

/**
 * 段落端点切线长度：沿切线方向取位移投影的一半，再按段长与上限封顶，
 * 控制柄绝不会长过这一段——短段里过长的控制柄会让曲线回绕成小圈。
 * 投影取绝对值：环绕关系的端点切线可能背对下一路点，此时仍要沿切向外伸，
 * 控制点才不会退化为零长度。切线长度上限与段长成正比，极短段自然收缩。
 */
function tangentReach(from: Point, to: Point, tangent: Point, max: number): number {
  const projection = Math.abs((to.x - from.x) * tangent.x + (to.y - from.y) * tangent.y)
  return Math.min(max, projection / 2, distance(from, to) / 2)
}

interface Cubic {
  from: Point
  c1: Point
  c2: Point
  to: Point
}

/**
 * 几何函数的中间结果：段列表 + 起点 + 标签锚点。
 * path 字符串只对最终选中的候选生成一次；避障采样与候选长度直接复用段列表，
 * 不再像旧实现那样把 path 字符串解析回贝塞尔段。
 */
interface GeometryShape {
  start: Point
  segments: Cubic[]
  labelX: number
  labelY: number
}

/** 由段列表拼出 path；输出与旧实现逐字节一致（M + 若干 C，坐标保留两位小数）。 */
function cubicPath(segments: readonly Cubic[], start: Point): string {
  let path = `M ${format(start.x)} ${format(start.y)}`
  for (const segment of segments) {
    path += ` C ${format(segment.c1.x)} ${format(segment.c1.y)}`
    path += ` ${format(segment.c2.x)} ${format(segment.c2.y)}`
    path += ` ${format(segment.to.x)} ${format(segment.to.y)}`
  }
  return path
}

/**
 * 用三次贝塞尔段串起路点，每段端点切线由路点给出，因此整条路径 G1 连续：
 * 不会有直角折点，也不会有方向突变。相邻路点重合时跳过该段。
 */
function splineSegments(waypoints: readonly Waypoint[], maxTangent = MAX_TANGENT): Cubic[] {
  const segments: Cubic[] = []
  for (let index = 0; index + 1 < waypoints.length; index += 1) {
    const from = waypoints[index]
    const to = waypoints[index + 1]
    if (distance(from.point, to.point) < 0.01) {
      continue
    }
    const firstReach = from.reach ?? tangentReach(from.point, to.point, from.tangent, maxTangent)
    const secondReach = to.reach ?? tangentReach(to.point, from.point, to.tangent, maxTangent)
    segments.push({
      from: from.point,
      c1: add(from.point, from.tangent, firstReach),
      c2: add(to.point, to.tangent, -secondReach),
      to: to.point,
    })
  }
  return segments
}

/** 由路点生成几何中间结果（标签锚点由调用方给出）。 */
function shapeOf(
  waypoints: readonly Waypoint[],
  labelX: number,
  labelY: number,
  maxTangent = MAX_TANGENT,
): GeometryShape {
  return {
    start: waypoints[0].point,
    segments: splineSegments(waypoints, maxTangent),
    labelX,
    labelY,
  }
}

/** 只有最终几何才拼 path 字符串。 */
function toGeometry(shape: GeometryShape): LanedEdgeGeometry {
  return {
    path: cubicPath(shape.segments, shape.start),
    labelX: shape.labelX,
    labelY: shape.labelY,
  }
}

function pointOnCubic(cubic: Cubic, t: number): Point {
  const mt = 1 - t
  return {
    x:
      mt * mt * mt * cubic.from.x +
      3 * mt * mt * t * cubic.c1.x +
      3 * mt * t * t * cubic.c2.x +
      t * t * t * cubic.to.x,
    y:
      mt * mt * mt * cubic.from.y +
      3 * mt * mt * t * cubic.c1.y +
      3 * mt * t * t * cubic.c2.y +
      t * t * t * cubic.to.y,
  }
}

/** 折线近似的路径长度，用于在同样不穿节点的候选里选较短的一条。 */
function pathLength(segments: readonly Cubic[]): number {
  let total = 0
  for (const cubic of segments) {
    let previous = cubic.from
    for (let step = 1; step <= 12; step += 1) {
      const point = pointOnCubic(cubic, step / 12)
      total += Math.hypot(point.x - previous.x, point.y - previous.y)
      previous = point
    }
  }
  return total
}

/** 轴对齐包围盒。 */
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 段列表的控制点包围盒：贝塞尔曲线一定落在控制点凸包内，因此也在该盒内。 */
function boundsOf(segments: readonly Cubic[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const segment of segments) {
    for (const point of [segment.from, segment.c1, segment.c2, segment.to]) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  return { minX, minY, maxX, maxY }
}

/**
 * 只保留可能与曲线相交的障碍盒：控制点包围盒之外的节点不可能被命中。
 * 这是纯剪枝，命中统计与逐一遍历全部障碍完全一致。
 */
function nearbyObstacles(segments: readonly Cubic[], obstacles: readonly Rect[]): readonly Rect[] {
  if (segments.length === 0) {
    return []
  }
  const bounds = boundsOf(segments)
  return obstacles.filter((rect) => rectTouchesBounds(rect, bounds))
}

/**
 * 障碍盒是否可能被落在该包围盒内的曲线命中。
 * 容差与 nearbyObstacles 完全一致：先按并集包围盒预筛不会改变命中统计。
 */
export function rectTouchesBounds(rect: Rect, bounds: Bounds): boolean {
  return (
    rect.x < bounds.maxX + 1 &&
    rect.x + rect.width > bounds.minX - 1 &&
    rect.y < bounds.maxY + 1 &&
    rect.y + rect.height > bounds.minY - 1
  )
}

/**
 * 普通关系两个避障候选的包围盒并集。两个候选只由两端点与端口决定，
 * 因此关系组件可以在不重算几何的前提下，用它把障碍盒预筛到「可能命中」的一小撮；
 * 拖动期间移动的节点盒一旦进入/离开该走廊，预筛结果就会变化并触发重算。
 * 返回 null 表示这条关系不使用障碍（此时任何障碍盒都不影响几何）。
 */
export function normalObstacleBounds(input: LanedEdgeInput): Bounds | null {
  const candidates = normalCandidates(input)
  if (candidates === null) {
    return null
  }
  const [direct, flat] = candidates
  return boundsOf([...direct.segments, ...flat.segments])
}

/** 采样路径并统计落入障碍盒内部的点数；用于在少量候选曲线里挑不穿节点的。 */
function obstacleHits(segments: readonly Cubic[], obstacles: readonly Rect[]): number {
  if (obstacles.length === 0) {
    return 0
  }
  let hits = 0
  for (const segment of segments) {
    for (let step = 1; step < 24; step += 1) {
      const point = pointOnCubic(segment, step / 24)
      for (const rect of obstacles) {
        if (
          point.x > rect.x + 1 &&
          point.x < rect.x + rect.width - 1 &&
          point.y > rect.y + 1 &&
          point.y < rect.y + rect.height - 1
        ) {
          hits += 1
        }
      }
    }
  }
  return hits
}

/**
 * 普通关系的平滑 S 形：两端沿 handle 切线离开/进入。
 * flatMiddle 为真时在中点再插一个水平切线的路点，让曲线以较平的姿态穿过两列之间，
 * 这是避障候选：直连 S 会擦到中间列节点时改用它。
 */
function sCurveShape(input: LanedEdgeInput, flatMiddle = false): GeometryShape {
  const source: Point = { x: input.sourceX, y: input.sourceY }
  const target: Point = { x: input.targetX, y: input.targetY }
  if (!flatMiddle || Math.abs(target.y - source.y) < 0.5) {
    return shapeOf(
      [
        { point: source, tangent: outward(input.sourcePosition) },
        { point: target, tangent: inward(input.targetPosition) },
      ],
      avoidZero((source.x + target.x) / 2),
      avoidZero((source.y + target.y) / 2),
    )
  }
  const apex: Point = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
  const horizontal = isHorizontal(input.sourcePosition) && isHorizontal(input.targetPosition)
  const apexTangent = horizontal
    ? { x: target.x >= source.x ? 1 : -1, y: 0 }
    : { x: 0, y: target.y >= source.y ? 1 : -1 }
  return shapeOf(
    [
      { point: source, tangent: outward(input.sourcePosition) },
      { point: apex, tangent: apexTangent },
      { point: target, tangent: inward(input.targetPosition) },
    ],
    avoidZero(apex.x),
    avoidZero(apex.y),
  )
}

/**
 * 普通关系的两个避障候选：直连平滑 S、以及中点带水平切线的 S。
 * 返回 null 表示这条关系根本不走避障（自环、重叠、分道、反向、无横向间隙），
 * 此时障碍盒对几何没有影响。几何与「候选包围盒预筛」共用这一处判定。
 */
function normalCandidates(input: LanedEdgeInput): [GeometryShape, GeometryShape] | null {
  if (sameRect(input.sourceRect, input.targetRect)) {
    return null
  }
  if (boxesOverlap(input.sourceRect, input.targetRect)) {
    return null
  }
  if (isHorizontal(input.sourcePosition) && isHorizontal(input.targetPosition)) {
    const facing =
      (input.sourcePosition === Position.Right && input.targetPosition === Position.Left) ||
      (input.sourcePosition === Position.Left && input.targetPosition === Position.Right)
    if (!facing || input.lane !== 0) {
      return null
    }
    const direction = outward(input.sourcePosition).x
    if ((input.targetX - input.sourceX) * direction <= 0) {
      return null
    }
  }
  return [sCurveShape(input), sCurveShape(input, true)]
}

/**
 * 有界避障：普通关系只有两个候选——直连平滑 S、以及中点带水平切线的 S。
 * 取穿节点最少的一条；同样不穿时取更短的，避免为了绕行而绕远。
 * 不做全图搜索，也不引入每条关系的持久数据。
 * 候选先用控制点包围盒预筛障碍：盒外的节点不可能被曲线命中。
 */
function avoidObstacles(
  input: LanedEdgeInput,
  candidates: readonly [GeometryShape, GeometryShape],
): GeometryShape {
  if (!input.obstacles || input.obstacles.length === 0) {
    return candidates[0]
  }
  let best = candidates[0]
  let bestHits = obstacleHits(best.segments, nearbyObstacles(best.segments, input.obstacles))
  let bestLength = pathLength(best.segments)
  for (const candidate of candidates.slice(1)) {
    const hits = obstacleHits(
      candidate.segments,
      nearbyObstacles(candidate.segments, input.obstacles),
    )
    const length = pathLength(candidate.segments)
    if (hits < bestHits || (hits === bestHits && length < bestLength)) {
      best = candidate
      bestHits = hits
      bestLength = length
    }
  }
  return best
}

/** 同一行两节点之间的车道：以中点为拱顶的对称平滑拱，标签落在拱顶。 */
function laneArcShape(input: LanedEdgeInput, laneY: number): GeometryShape {
  const apex: Point = { x: (input.sourceX + input.targetX) / 2, y: laneY }
  const forward = input.targetX >= input.sourceX ? 1 : -1
  return shapeOf(
    [
      { point: { x: input.sourceX, y: input.sourceY }, tangent: outward(input.sourcePosition) },
      { point: apex, tangent: { x: forward, y: 0 } },
      { point: { x: input.targetX, y: input.targetY }, tangent: inward(input.targetPosition) },
    ],
    avoidZero(apex.x),
    avoidZero(apex.y),
  )
}

/**
 * 外缘绕行：从源节点外侧升/降到车道高度，横穿到目标节点外侧，再落回连接点。
 * 竖直与水平段都在两节点并集之外，四角由三次贝塞尔四分之一转连接，
 * 因此既不会切进端点盒，也没有直角折点。lane 的上下与行距由调用方给定的 laneY 决定。
 */
function stapleShape(input: LanedEdgeInput, laneY: number, labelDelta: number): GeometryShape {
  const direction = outward(input.sourcePosition).x
  const inwardX = inward(input.targetPosition).x
  const step = laneY > input.sourceY ? 1 : -1
  const verticalStep = -step
  const unionLeft = Math.min(input.sourceRect.x, input.targetRect.x) - LANE_STUB
  const unionRight = Math.max(rightOf(input.sourceRect), rightOf(input.targetRect)) + LANE_STUB
  const sourceOuter = direction > 0 ? unionRight : unionLeft
  const targetOuter = inwardX > 0 ? unionLeft : unionRight
  const laneDirection = targetOuter >= sourceOuter ? 1 : -1
  const radius = STAPLE_CORNER
  return shapeOf(
    [
      { point: { x: input.sourceX, y: input.sourceY }, tangent: { x: direction, y: 0 } },
      {
        point: { x: sourceOuter - direction * radius, y: input.sourceY },
        tangent: { x: direction, y: 0 },
      },
      { point: { x: sourceOuter, y: input.sourceY + step * radius }, tangent: { x: 0, y: step } },
      { point: { x: sourceOuter, y: laneY - step * radius }, tangent: { x: 0, y: step } },
      {
        point: { x: sourceOuter + laneDirection * radius, y: laneY },
        tangent: { x: laneDirection, y: 0 },
      },
      {
        point: { x: targetOuter - laneDirection * radius, y: laneY },
        tangent: { x: laneDirection, y: 0 },
      },
      {
        point: { x: targetOuter, y: laneY + verticalStep * radius },
        tangent: { x: 0, y: verticalStep },
      },
      {
        point: { x: targetOuter, y: input.targetY - verticalStep * radius },
        tangent: { x: 0, y: verticalStep },
      },
      {
        point: { x: targetOuter + inwardX * radius, y: input.targetY },
        tangent: { x: inwardX, y: 0 },
      },
      { point: { x: input.targetX, y: input.targetY }, tangent: { x: inwardX, y: 0 } },
    ],
    avoidZero((sourceOuter + targetOuter) / 2),
    avoidZero(laneY + labelDelta),
  )
}

/**
 * 分道关系：同一行的双向/平行关系用对称平滑拱（绕到节点上方/下方）；
 * 两端高度差较大时用外缘绕行，保证不切进端点盒。lane 的正负决定上下，
 * 绝对值决定行距。
 */
function laneShape(input: LanedEdgeInput): GeometryShape {
  const track = Math.max(1, Math.abs(input.lane))
  const above = input.lane <= 0
  const laneY = above
    ? Math.min(input.sourceRect.y, input.targetRect.y) - EDGE_LANE_GAP * track
    : Math.max(
        input.sourceRect.y + input.sourceRect.height,
        input.targetRect.y + input.targetRect.height,
      ) +
      EDGE_LANE_GAP * track
  const forward = (input.targetX - input.sourceX) * outward(input.sourcePosition).x > 0
  // 只有“向前且同一行”的双向/平行关系用对称拱；其余用外缘绕行，
  // 否则从右侧反向回来时曲线会切进源节点上/下角。
  if (forward && Math.abs(input.targetY - input.sourceY) <= LANE_ARC_SPAN) {
    return laneArcShape(input, laneY)
  }
  return stapleShape(input, laneY, 0)
}

/**
 * 反向 / 重叠关系：沿两节点并集外侧绕到上方或下方，再回到目标连接点外侧。
 * 与分道共用同一套外缘绕行曲线，全程没有直角；lane 的正负与绝对值沿用分道的上下与行距。
 */
function loopShape(input: LanedEdgeInput): GeometryShape {
  const track = Math.max(1, Math.abs(input.lane))
  const above = input.lane <= 0
  const top = Math.min(input.sourceRect.y, input.targetRect.y)
  const bottom = Math.max(
    input.sourceRect.y + input.sourceRect.height,
    input.targetRect.y + input.targetRect.height,
  )
  const clearance = LOOP_CLEARANCE + EDGE_LANE_GAP * (track - 1)
  const laneY = above ? top - clearance : bottom + clearance
  return stapleShape(input, laneY, above ? -LABEL_OFFSET : LABEL_OFFSET)
}

/**
 * 自环：沿 Right handle 外向短桩离开节点，从节点上方/下方绕一圈，
 * 再从左侧沿水平切向进入 Left handle。左右两侧的绕行边都在节点盒之外，
 * 不会切进节点；收尾为水平切向，箭头不会被节点盖住一半。
 */
function selfLoopShape(input: LanedEdgeInput): GeometryShape {
  const rect = input.sourceRect
  const track = Math.max(1, Math.abs(input.lane))
  const above = input.lane <= 0
  const lift = SELF_LOOP_LIFT + EDGE_LANE_GAP * (track - 1)
  const apexY = above ? rect.y - lift : rect.y + rect.height + lift
  return stapleShape(input, apexY, above ? -LABEL_OFFSET : LABEL_OFFSET)
}

/**
 * 计算一条关系的路径与标签锚点。
 * - 自环：在节点上/下方画平滑拱形，收尾沿水平切向进入连接点；
 * - 平行/互反关系：在节点并集外侧找到车道高度，用平滑曲线过渡；
 * - 反向或节点重叠：绕并集上方/下方一圈，仍是连续曲线；
 * - 其余（含同轴直连）：一条完整的三次贝塞尔 S 形，两端沿 handle 切向进出。
 *
 * BaseEdge 以 labelX && labelY 判断标签是否渲染，因此标签锚点恰好为 0 时退让 0.01px。
 * 内部先算 Cubic 段再拼 path：避障采样、候选长度都复用同一份段列表。
 */
export function computeLanedEdgeGeometry(input: LanedEdgeInput): LanedEdgeGeometry {
  if (sameRect(input.sourceRect, input.targetRect)) {
    return toGeometry(selfLoopShape(input))
  }
  if (boxesOverlap(input.sourceRect, input.targetRect)) {
    return toGeometry(loopShape(input))
  }
  // 普通关系（含竖向端口）用有界避障候选；其余走分道或环绕
  const candidates = normalCandidates(input)
  if (candidates !== null) {
    return toGeometry(avoidObstacles(input, candidates))
  }
  const facing =
    (input.sourcePosition === Position.Right && input.targetPosition === Position.Left) ||
    (input.sourcePosition === Position.Left && input.targetPosition === Position.Right)
  // 双向/平行关系无论方向都走上下车道，保持两条曲线对称分居节点两侧
  if (facing && input.lane !== 0) {
    return toGeometry(laneShape(input))
  }
  return toGeometry(loopShape(input))
}

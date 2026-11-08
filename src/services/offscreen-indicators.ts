/**
 * 屏外节点指示器的纯几何：判断哪些节点完全落在画布外、贴在哪条边上，
 * 以及标注的锚点与指向角度。不读 DOM、不依赖 Vue / Vue Flow，便于单测。
 *
 * 坐标约定与 Vue Flow 视口一致：屏幕坐标 = 画布坐标 × zoom + 视口平移，
 * 原点在画布左上角（视口 transform-origin 为 0 0）。
 */

/** 画布视口变换。 */
export interface ViewportTransform {
  x: number
  y: number
  zoom: number
}

/** 画布可视区尺寸（CSS 像素）。 */
export interface CanvasSize {
  width: number
  height: number
}

/** 参与判定的节点盒：画布坐标 + 已量尺寸。 */
export interface IndicatorNodeBox {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

/** 标注贴在画布的哪条边。 */
export type IndicatorSide = 'left' | 'right' | 'top' | 'bottom'

export interface OffscreenIndicator {
  nodeId: string
  name: string
  side: IndicatorSide
  /** 标注锚点（px，相对画布左上角）；贴边距离与同侧排布已算入。 */
  x: number
  y: number
  /** 画布中心指向节点的角度（度，[-180, 180]），用于旋转方向箭头。 */
  angle: number
}

/** 标注与画布右/上/下边缘的距离（px）。 */
export const INDICATOR_EDGE_MARGIN = 12
/** 左/右两列标注沿边的纵向最小间距（px），略大于胶囊高度，保证名称不被压住。 */
export const INDICATOR_MIN_GAP = 28

/**
 * 左列标注的横向位置（px）：左上工具栏是竖列浮层（画布局部 x15–61、y15–299），
 * 层级高于标注且高度随按钮增减，所以左列整体挪到它右侧，而不是按当前高度躲。
 */
export const INDICATOR_LEFT_INSET = 72

/**
 * 顶部让给聚焦提示条、底部让给左下缩放控件与右下小地图的内缩（px）。
 * Vue Flow 的面板是绝对定位浮层且层级更高，标注只能靠内缩避让，不测量它们的尺寸。
 */
const TOP_RESERVE = 52
const BOTTOM_RESERVE = 52
/** 左/右两列在顶部让出横排标注占用的高度（52–76），纵向列从它下方起排。 */
const COLUMN_TOP_RESERVE = 98
/** 左/右两列在底部让出的高度：左侧缩放控件、右侧小地图。 */
const LEFT_COLUMN_BOTTOM_RESERVE = 140
const RIGHT_COLUMN_BOTTOM_RESERVE = 190
/** 底边一行在左右两端让出的宽度：左侧缩放控件、右侧小地图。 */
const BOTTOM_ROW_LEFT_RESERVE = 56
const BOTTOM_ROW_RIGHT_RESERVE = 220
/** 上排标注在工具栏右侧起排：工具栏右缘 61 + 8 间隙，再让出半个胶囊。 */
const TOP_ROW_LEFT_RESERVE = 69
/** 胶囊宽度的保守估计（px）：把居中锚点收回画布内，实际宽度由名称决定。 */
const PILL_HALF_WIDTH = 64

/**
 * 上/下两行标注沿边的横向最小间距（px）：胶囊横排，间距必须容纳整块宽度
 * （max-width 8rem = 128）再加一点空隙，否则相邻两个胶囊会大幅重叠。
 * 间距放大后单行容量变小，节点多到排不下时会退化为等距分布（允许部分重叠）。
 */
export const INDICATOR_MIN_GAP_HORIZONTAL = PILL_HALF_WIDTH * 2 + 4

/**
 * 某一侧标注沿边方向可用的区间。纵向（左/右）用 y、横向（上/下）用 x，
 * 区间已经扣掉面板占位，避免标注被工具栏、缩放控件与小地图盖住。
 */
function spanOf(side: IndicatorSide, size: CanvasSize): [number, number] {
  const { width, height } = size
  switch (side) {
    case 'left':
      return [COLUMN_TOP_RESERVE, Math.max(COLUMN_TOP_RESERVE, height - LEFT_COLUMN_BOTTOM_RESERVE)]
    case 'right':
      return [
        COLUMN_TOP_RESERVE,
        Math.max(COLUMN_TOP_RESERVE, height - RIGHT_COLUMN_BOTTOM_RESERVE),
      ]
    case 'top':
      return [
        TOP_ROW_LEFT_RESERVE + PILL_HALF_WIDTH,
        Math.max(
          TOP_ROW_LEFT_RESERVE + PILL_HALF_WIDTH,
          width - INDICATOR_EDGE_MARGIN - PILL_HALF_WIDTH,
        ),
      ]
    case 'bottom':
      return [
        BOTTOM_ROW_LEFT_RESERVE + PILL_HALF_WIDTH,
        Math.max(
          BOTTOM_ROW_LEFT_RESERVE + PILL_HALF_WIDTH,
          width - BOTTOM_ROW_RIGHT_RESERVE - PILL_HALF_WIDTH,
        ),
      ]
  }
}

interface Anchor {
  /** 在结果数组里的下标。 */
  index: number
  /** 在本侧分组里的槽位。返回值按槽位对齐，与排序无关。 */
  slot: number
  /** 沿边方向的原始锚点（来自射线交点）。 */
  along: number
}

/**
 * 同侧标注沿边排布：按原始锚点排序并保持最小间距，越界时整体回退，
 * 仍放不下就退化为等距分布——任何情况下都不让两个标注落在同一点。
 *
 * 排序只影响排布顺序，返回值按「槽位」回到分组原始顺序，
 * 否则调用方按原顺序取位置时会把锚点配错节点。
 * 间距小于「胶囊尺寸 + 间隔」时排布会压缩：容量（区间长度 / 间距）耗尽后
 * 等距分布仍可能让胶囊部分重叠，这是明确保留的上限。
 */
function spreadAnchors(
  group: readonly Anchor[],
  [min, max]: [number, number],
  gap: number,
): number[] {
  const sorted = [...group].sort(
    (left, right) => left.along - right.along || left.slot - right.slot,
  )
  const positions: number[] = []
  for (const [order, anchor] of sorted.entries()) {
    const previous = order === 0 ? Number.NEGATIVE_INFINITY : positions[order - 1] + gap
    positions.push(Math.max(anchor.along, previous))
  }

  for (let order = positions.length - 1; order >= 0; order -= 1) {
    const limit = order === positions.length - 1 ? max : positions[order + 1] - gap
    if (positions[order] > limit) {
      positions[order] = limit
    }
  }

  if (positions[0] < min) {
    const step = positions.length > 1 ? (max - min) / (positions.length - 1) : 0
    for (let order = 0; order < positions.length; order += 1) {
      positions[order] = min + step * order
    }
  }

  const result: number[] = new Array<number>(group.length)
  sorted.forEach((anchor, order) => {
    result[anchor.slot] = positions[order]
  })
  return result
}

/**
 * 计算屏外节点标注。
 *
 * 只有与画布完全没有交集的节点才出标注：部分可见的节点由画布自己表达位置，
 * 再给方向提示只会互相矛盾。结果保持输入顺序，方便测试与稳定渲染。
 */
export function computeOffscreenIndicators(
  nodes: readonly IndicatorNodeBox[],
  viewport: ViewportTransform,
  size: CanvasSize,
): OffscreenIndicator[] {
  const { width, height } = size
  if (!(width > 0) || !(height > 0) || !(viewport.zoom > 0)) {
    return []
  }

  const centerX = width / 2
  const centerY = height / 2
  /** 射线与内缩矩形交点的可用半径。 */
  const radiusX = Math.max(0, centerX - INDICATOR_EDGE_MARGIN)
  const radiusY = Math.max(0, centerY - INDICATOR_EDGE_MARGIN)
  const indicators: OffscreenIndicator[] = []
  const groups = new Map<IndicatorSide, Anchor[]>()

  for (const node of nodes) {
    const left = node.x * viewport.zoom + viewport.x
    const top = node.y * viewport.zoom + viewport.y
    const right = left + node.width * viewport.zoom
    const bottom = top + node.height * viewport.zoom
    if (right > 0 && left < width && bottom > 0 && top < height) {
      continue
    }

    const dx = (left + right) / 2 - centerX
    const dy = (top + bottom) / 2 - centerY
    const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : radiusX / Math.abs(dx)
    const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : radiusY / Math.abs(dy)
    const scale = Math.min(scaleX, scaleY)
    const side: IndicatorSide =
      scaleX <= scaleY ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top'
    // 与画布中心重合的极端情况没有方向可言：沿 x 轴取右，交点落在中心。
    const along =
      side === 'left' || side === 'right'
        ? centerY + (Number.isFinite(scale) ? dy * scale : 0)
        : centerX + (Number.isFinite(scale) ? dx * scale : 0)

    const index = indicators.length
    indicators.push({
      nodeId: node.id,
      name: node.name,
      side,
      x: 0,
      y: 0,
      angle: dx === 0 && dy === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI,
    })
    const group = groups.get(side)
    if (group === undefined) {
      groups.set(side, [{ index, slot: 0, along }])
    } else {
      group.push({ index, slot: group.length, along })
    }
  }

  for (const [side, group] of groups) {
    const horizontal = side === 'top' || side === 'bottom'
    const positions = spreadAnchors(
      group,
      spanOf(side, size),
      horizontal ? INDICATOR_MIN_GAP_HORIZONTAL : INDICATOR_MIN_GAP,
    )
    group.forEach((anchor) => {
      const indicator = indicators[anchor.index]
      const along = positions[anchor.slot]
      indicator.x =
        side === 'left'
          ? INDICATOR_LEFT_INSET
          : side === 'right'
            ? width - INDICATOR_EDGE_MARGIN
            : along
      indicator.y =
        side === 'top' ? TOP_RESERVE : side === 'bottom' ? height - BOTTOM_RESERVE : along
    })
  }

  return indicators
}

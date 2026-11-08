import { describe, expect, it } from 'vitest'
import {
  INDICATOR_EDGE_MARGIN,
  INDICATOR_LEFT_INSET,
  INDICATOR_MIN_GAP,
  INDICATOR_MIN_GAP_HORIZONTAL,
  computeOffscreenIndicators,
  type IndicatorNodeBox,
  type ViewportTransform,
} from '@/services/offscreen-indicators'

/** 固定画布：800×600，方便把「贴边」与「排布区间」写成确定值。 */
const SIZE = { width: 800, height: 600 }
/** 未平移未缩放的视口：屏幕坐标等于画布坐标。 */
const IDENTITY: ViewportTransform = { x: 0, y: 0, zoom: 1 }

/** 默认 180×64 的节点盒；只给关心的轴传值。 */
function box(id: string, x: number, y: number, width = 180, height = 64): IndicatorNodeBox {
  return { id, name: `节点-${id}`, x, y, width, height }
}

describe('computeOffscreenIndicators', () => {
  it('画布内的节点不出标注，部分可见的节点也不出', () => {
    expect(computeOffscreenIndicators([box('inside', 300, 250)], IDENTITY, SIZE)).toEqual([])
    // 右边缘落在画布内（x=-90 + 180 = 90），算部分可见
    expect(computeOffscreenIndicators([box('partial', -90, 250)], IDENTITY, SIZE)).toEqual([])
    // 上边缘探入画布，同样算部分可见
    expect(computeOffscreenIndicators([box('partial-y', 300, -32)], IDENTITY, SIZE)).toEqual([])
  })

  it('完全在外才出标注：右边缘正好为 0 算在外，露出 1px 算在内', () => {
    expect(computeOffscreenIndicators([box('edge', -180, 250)], IDENTITY, SIZE)).toHaveLength(1)
    expect(computeOffscreenIndicators([box('edge', -179, 250)], IDENTITY, SIZE)).toEqual([])
  })

  it('四条边各自的贴边坐标与指向角度', () => {
    // 节点中心与画布中心同高/同列时，射线交点就是中心坐标，结果可以写成确定值
    const left = computeOffscreenIndicators([box('l', -300, 268)], IDENTITY, SIZE)[0]
    expect(left).toMatchObject({
      nodeId: 'l',
      name: '节点-l',
      side: 'left',
      x: INDICATOR_LEFT_INSET,
      y: 300,
    })
    expect(left.angle).toBeCloseTo(180, 5)

    const right = computeOffscreenIndicators([box('r', 900, 268)], IDENTITY, SIZE)[0]
    expect(right).toMatchObject({ side: 'right', x: SIZE.width - INDICATOR_EDGE_MARGIN, y: 300 })
    expect(right.angle).toBeCloseTo(0, 5)

    const top = computeOffscreenIndicators([box('t', 310, -200)], IDENTITY, SIZE)[0]
    expect(top).toMatchObject({ side: 'top', x: 400, y: 52 })
    expect(top.angle).toBeCloseTo(-90, 5)

    const bottom = computeOffscreenIndicators([box('b', 310, 700)], IDENTITY, SIZE)[0]
    expect(bottom).toMatchObject({ side: 'bottom', x: 400, y: SIZE.height - 52 })
    expect(bottom.angle).toBeCloseTo(90, 5)
  })

  it('角落节点贴最近的那条边', () => {
    // 偏左多于偏上 → 左边；偏上多于偏左 → 上边
    expect(computeOffscreenIndicators([box('corner-l', -200, -60)], IDENTITY, SIZE)[0].side).toBe(
      'left',
    )
    expect(computeOffscreenIndicators([box('corner-t', -60, -200)], IDENTITY, SIZE)[0].side).toBe(
      'top',
    )
  })

  it('缩放与平移改变判定：同一节点在不同视口里进出示范围', () => {
    expect(computeOffscreenIndicators([box('n', 400, 0)], IDENTITY, SIZE)).toEqual([])
    const zoomed = computeOffscreenIndicators([box('n', 400, 0)], { x: 0, y: 0, zoom: 2 }, SIZE)
    expect(zoomed).toHaveLength(1)
    expect(zoomed[0].side).toBe('right')

    const panned = computeOffscreenIndicators([box('n', 400, 0)], { x: 500, y: 0, zoom: 1 }, SIZE)
    expect(panned).toHaveLength(1)
    expect(panned[0].side).toBe('right')
  })

  it('同侧多个节点沿边排布，至少隔开最小间距', () => {
    const result = computeOffscreenIndicators(
      [box('a', 900, 268), box('b', 900, 270)],
      IDENTITY,
      SIZE,
    )
    expect(result).toHaveLength(2)
    expect(result.every((item) => item.side === 'right')).toBe(true)
    expect(result[1].y - result[0].y).toBeGreaterThanOrEqual(INDICATOR_MIN_GAP)
  })

  it('同侧节点多到排不下时等距分布，仍不完全重叠', () => {
    const nodes = Array.from({ length: 20 }, (_, index) => box(`n${index}`, -300, 268))
    const result = computeOffscreenIndicators(nodes, IDENTITY, SIZE)
    const positions = result.map((item) => item.y)
    expect(new Set(positions).size).toBe(20)
    // 纵列从横排标注下方（98）起排，止于左下缩放控件之前
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(98)
    expect(Math.max(...positions)).toBeLessThanOrEqual(SIZE.height - 140)
  })

  it('左列标注避开左上工具栏竖列（x15–61、y15–299）', () => {
    // 偏左且偏上的节点：射线交点本来会落在工具栏区域里
    const [pill] = computeOffscreenIndicators([box('l', -400, -200)], IDENTITY, SIZE)
    expect(pill.side).toBe('left')
    expect(pill.x).toBe(INDICATOR_LEFT_INSET)
    expect(pill.x).toBeGreaterThan(61)
    // 胶囊纵向以 y 为中心、高约 28，故 y 至少要让到 299 + 半个胶囊之外
    expect(pill.y).toBeGreaterThanOrEqual(98)
  })

  it('上排标注从工具栏右缘之外起排，不被工具栏压住', () => {
    // 偏上且偏左的节点：横排标注会落在最左侧
    const [pill] = computeOffscreenIndicators([box('t', -60, -200)], IDENTITY, SIZE)
    expect(pill.side).toBe('top')
    expect(pill.x - 64).toBeGreaterThan(61)
  })

  it('输入沿边乱序时，位置仍按槽位回到各自的节点', () => {
    // 先传下方的节点、再传上方的节点：排序会交换两者，回填位置不能跟着交换
    const result = computeOffscreenIndicators(
      [box('low', 900, 270), box('high', 900, 268)],
      IDENTITY,
      SIZE,
    )
    expect(result.map((item) => item.nodeId)).toEqual(['low', 'high'])
    expect(result[0].y).toBeGreaterThan(result[1].y)
    expect(result[0].y - result[1].y).toBeGreaterThanOrEqual(INDICATOR_MIN_GAP)
  })

  it('上/下两行按胶囊宽度预留间距，相邻标注不互相压住', () => {
    const result = computeOffscreenIndicators(
      [box('t1', 300, -200), box('t2', 310, -200), box('t3', 320, -200)],
      IDENTITY,
      SIZE,
    )
    expect(result).toHaveLength(3)
    expect(result.every((item) => item.side === 'top')).toBe(true)
    const xs = result.map((item) => item.x).sort((left, right) => left - right)
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index] - xs[index - 1]).toBeGreaterThanOrEqual(INDICATOR_MIN_GAP_HORIZONTAL)
    }
  })

  it('底边标注不会落进左下缩放控件与右下小地图的占位', () => {
    // 射线交点 x≈67，低于底边一行的可用左界 120
    const result = computeOffscreenIndicators([box('b', -190, 700)], IDENTITY, SIZE)
    expect(result[0].side).toBe('bottom')
    expect(result[0].x).toBe(120)
    // 射线交点 x=600 会压到小地图，收到 800-220-64=516
    const farRight = computeOffscreenIndicators([box('b', 610, 700)], IDENTITY, SIZE)
    expect(farRight[0].x).toBe(516)
  })

  it('结果保持输入顺序并带出节点名称', () => {
    const result = computeOffscreenIndicators(
      [box('r', 900, 268), box('l', -300, 268)],
      IDENTITY,
      SIZE,
    )
    expect(result.map((item) => item.nodeId)).toEqual(['r', 'l'])
    expect(result.map((item) => item.name)).toEqual(['节点-r', '节点-l'])
  })

  it('画布尺寸或缩放无效时返回空数组', () => {
    expect(
      computeOffscreenIndicators([box('n', -300, 268)], IDENTITY, { width: 0, height: 0 }),
    ).toEqual([])
    expect(
      computeOffscreenIndicators([box('n', -300, 268)], { x: 0, y: 0, zoom: 0 }, SIZE),
    ).toEqual([])
  })
})

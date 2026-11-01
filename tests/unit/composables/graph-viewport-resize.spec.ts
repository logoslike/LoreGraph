import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VueFlowStore } from '@vue-flow/core'
import { useGraphViewport } from '@/composables/useGraphViewport'

/**
 * 用假的 ResizeObserver + 假视口验证 LG-208 的平移逻辑：
 * 容器尺寸变化时只平移视口、不改缩放，原来在画布中心的内容仍落在新中心，卸载时断开观察。
 *
 * Vue Flow 的变换是 transform: translate(x, y) scale(zoom)，挂在容器左上角（transform-origin: 0 0），
 * 所以内容点 p 的屏幕坐标 = 容器左上角 + 视口平移 + p × zoom，左上角的移动本身不需要补偿。
 */

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  readonly callback: ResizeObserverCallback
  disconnected = false
  targets: Element[] = []

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.push(target)
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}

interface FakeRect {
  left: number
  top: number
  width: number
  height: number
}

interface FakeViewport {
  x: number
  y: number
  zoom: number
}

interface Point {
  x: number
  y: number
}

const SIDEBAR = 264
const INSPECTOR = 336

/** 1280×800 窗口、左右面板都展开：画布 680×800，左上角 (264, 0)。 */
const BASE: FakeRect = { left: 264, top: 0, width: 680, height: 800 }
const DEFAULT_VIEWPORT: FakeViewport = { x: 40, y: -25, zoom: 1.25 }

let rect: FakeRect

/** 内容点 p 的屏幕坐标（Vue Flow 的 translate 相对容器左上角，且不被 zoom 缩放）。 */
function screenOf(target: FakeRect, viewport: FakeViewport, point: Point): Point {
  return {
    x: target.left + viewport.x + point.x * viewport.zoom,
    y: target.top + viewport.y + point.y * viewport.zoom,
  }
}

/** 变化前正好落在画布正中心的内容点（画布坐标）。 */
function centerPoint(target: FakeRect, viewport: FakeViewport): Point {
  return {
    x: (target.width / 2 - viewport.x) / viewport.zoom,
    y: (target.height / 2 - viewport.y) / viewport.zoom,
  }
}

/** 断言该内容点仍落在当前画布的中心（相对画布中心的屏幕偏移为 0）。 */
function expectOnCanvasCenter(target: FakeRect, viewport: FakeViewport, point: Point): void {
  const screen = screenOf(target, viewport, point)
  expect(screen.x).toBeCloseTo(target.left + target.width / 2, 10)
  expect(screen.y).toBeCloseTo(target.top + target.height / 2, 10)
}

function makeElement(): HTMLElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => {
    const { left, top, width, height } = rect
    return {
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    } as DOMRect
  }
  return element
}

function makeFlow(element: HTMLElement, initial: FakeViewport = DEFAULT_VIEWPORT) {
  const viewport = { ...initial }
  const flow = {
    dimensions: { value: { width: rect.width, height: rect.height } },
    findNode: () => undefined,
    fitView: () => Promise.resolve(true),
    getViewport: () => ({ ...viewport }),
    screenToFlowCoordinate: (position: { x: number; y: number }) => position,
    setCenter: () => Promise.resolve(true),
    setViewport: (next: { x: number; y: number; zoom: number }) => {
      viewport.x = next.x
      viewport.y = next.y
      viewport.zoom = next.zoom
      return Promise.resolve(true)
    },
    vueFlowRef: { value: element },
    zoomIn: () => Promise.resolve(true),
    zoomOut: () => Promise.resolve(true),
  }
  return { flow: flow as unknown as VueFlowStore, viewport }
}

beforeEach(() => {
  FakeResizeObserver.instances = []
  rect = { ...BASE }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('preserveCenterOnResize 尺寸变化时保持中心', () => {
  it('左侧面板收起：left 264 → 0、宽度 +264，视口右移 132 且中心内容不动', () => {
    const element = makeElement()
    const { flow, viewport } = makeFlow(element)
    const tool = useGraphViewport(flow)
    const stop = tool.preserveCenterOnResize(element)
    const point = centerPoint(rect, viewport)

    rect = { left: 0, top: 0, width: 680 + SIDEBAR, height: 800 }
    FakeResizeObserver.instances[0].trigger()

    // 画布在屏幕上左移 132，内容相对容器本会落后 132，因此视口右移 132
    expect(viewport).toEqual({ x: 40 + SIDEBAR / 2, y: -25, zoom: 1.25 })
    expectOnCanvasCenter(rect, viewport, point)

    stop()
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true)
  })

  it('左侧面板展开：left 0 → 264、宽度 -264，视口左移 132 且中心内容不动', () => {
    rect = { left: 0, top: 0, width: 680 + SIDEBAR, height: 800 }
    const element = makeElement()
    const { flow, viewport } = makeFlow(element, { x: 40 + SIDEBAR / 2, y: -25, zoom: 1.25 })
    const tool = useGraphViewport(flow)
    tool.preserveCenterOnResize(element)
    const point = centerPoint(rect, viewport)

    rect = { ...BASE }
    FakeResizeObserver.instances[0].trigger()

    expect(viewport).toEqual({ x: 40, y: -25, zoom: 1.25 })
    expectOnCanvasCenter(rect, viewport, point)
  })

  it('右侧检查器收起：左边缘不动、宽度 +336，视口右移 168 且中心内容不动', () => {
    const element = makeElement()
    const { flow, viewport } = makeFlow(element)
    const tool = useGraphViewport(flow)
    tool.preserveCenterOnResize(element)
    const point = centerPoint(rect, viewport)

    rect = { left: 264, top: 0, width: 680 + INSPECTOR, height: 800 }
    FakeResizeObserver.instances[0].trigger()

    expect(viewport).toEqual({ x: 40 + INSPECTOR / 2, y: -25, zoom: 1.25 })
    expectOnCanvasCenter(rect, viewport, point)
  })

  it('窗口缩放：宽高各按变化量的一半平移，缩放不变且中心内容不动', () => {
    const element = makeElement()
    const { flow, viewport } = makeFlow(element)
    const tool = useGraphViewport(flow)
    tool.preserveCenterOnResize(element)
    const point = centerPoint(rect, viewport)

    // 窗口 1280×800 → 1200×820：画布宽 680 → 600、高 800 → 820，左上角不变
    rect = { left: 264, top: 0, width: 600, height: 820 }
    FakeResizeObserver.instances[0].trigger()

    expect(viewport).toEqual({ x: 0, y: -15, zoom: 1.25 })
    expectOnCanvasCenter(rect, viewport, point)
  })

  it('多次变化逐次累计，每次之后中心内容都不漂移', () => {
    const element = makeElement()
    const { flow, viewport } = makeFlow(element)
    const tool = useGraphViewport(flow)
    tool.preserveCenterOnResize(element)
    const observer = FakeResizeObserver.instances[0]

    const beforeInspector = centerPoint(rect, viewport)
    rect = { left: 264, top: 0, width: 680 + INSPECTOR, height: 800 }
    observer.trigger()
    expect(viewport).toEqual({ x: 208, y: -25, zoom: 1.25 })
    expectOnCanvasCenter(rect, viewport, beforeInspector)

    const beforeWindow = centerPoint(rect, viewport)
    rect = { left: 264, top: 0, width: 680 + INSPECTOR - 80, height: 800 }
    observer.trigger()
    expect(viewport).toEqual({ x: 168, y: -25, zoom: 1.25 })
    expectOnCanvasCenter(rect, viewport, beforeWindow)
  })

  it('容器整体移动但尺寸不变时不动视口', () => {
    const element = makeElement()
    const { flow, viewport } = makeFlow(element)
    const tool = useGraphViewport(flow)
    tool.preserveCenterOnResize(element)
    const point = centerPoint(rect, viewport)

    rect = { left: 300, top: 40, width: BASE.width, height: BASE.height }
    FakeResizeObserver.instances[0].trigger()

    expect(viewport).toEqual({ x: 40, y: -25, zoom: 1.25 })
    expectOnCanvasCenter(rect, viewport, point)
  })

  it('尺寸不变或容器隐藏（宽高为 0）时不动视口', () => {
    const element = makeElement()
    const { flow, viewport } = makeFlow(element)
    const tool = useGraphViewport(flow)
    tool.preserveCenterOnResize(element)
    const observer = FakeResizeObserver.instances[0]

    observer.trigger()
    expect(viewport).toEqual({ x: 40, y: -25, zoom: 1.25 })

    rect = { left: 264, top: 0, width: 0, height: 0 }
    observer.trigger()
    expect(viewport).toEqual({ x: 40, y: -25, zoom: 1.25 })

    // 从隐藏恢复：只更新基准，不平移
    rect = { ...BASE }
    observer.trigger()
    expect(viewport).toEqual({ x: 40, y: -25, zoom: 1.25 })
  })

  it('环境没有 ResizeObserver 时返回空断开函数，不报错', () => {
    vi.unstubAllGlobals()
    const element = makeElement()
    const { flow } = makeFlow(element)
    const tool = useGraphViewport(flow)
    const stop = tool.preserveCenterOnResize(element)
    expect(() => stop()).not.toThrow()
    expect(FakeResizeObserver.instances).toHaveLength(0)
  })
})

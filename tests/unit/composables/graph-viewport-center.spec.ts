import { describe, expect, it } from 'vitest'
import { centerShift, type ViewportRect } from '@/composables/useGraphViewport'

/** 1280×800 窗口、侧栏 264、检查器 336 都展开时的基准矩形。 */
const BASE: ViewportRect = { left: 264, top: 0, width: 680, height: 800 }
const SIDEBAR = 264
const INSPECTOR = 336

interface Viewport {
  x: number
  y: number
  zoom: number
}

interface Point {
  x: number
  y: number
}

/** 非 1 的缩放，用来确认平移量是屏幕像素、不会被 zoom 缩放。 */
const VIEWPORT: Viewport = { x: 40, y: -25, zoom: 1.25 }

/**
 * Vue Flow 的屏幕映射：transform 挂在容器左上角（transform-origin: 0 0），
 * 内容点 p 的屏幕坐标 = 容器左上角 + 视口平移 + p × zoom。
 */
function screenOf(rect: ViewportRect, viewport: Viewport, point: Point): Point {
  return {
    x: rect.left + viewport.x + point.x * viewport.zoom,
    y: rect.top + viewport.y + point.y * viewport.zoom,
  }
}

/** 变化前正好落在画布正中心的内容点（画布坐标）。 */
function centerPoint(rect: ViewportRect, viewport: Viewport): Point {
  return {
    x: (rect.width / 2 - viewport.x) / viewport.zoom,
    y: (rect.height / 2 - viewport.y) / viewport.zoom,
  }
}

/** 按 centerShift 平移后，原中心点相对新画布中心的屏幕偏移（应为 0）。 */
function driftAfterShift(previous: ViewportRect, next: ViewportRect, viewport: Viewport): Point {
  const point = centerPoint(previous, viewport)
  const shift = centerShift(previous, next)
  const after = screenOf(
    next,
    { ...viewport, x: viewport.x + shift.x, y: viewport.y + shift.y },
    point,
  )
  return {
    x: after.x - (next.left + next.width / 2),
    y: after.y - (next.top + next.height / 2),
  }
}

function expectCentered(previous: ViewportRect, next: ViewportRect): void {
  const drift = driftAfterShift(previous, next, VIEWPORT)
  expect(drift.x).toBeCloseTo(0, 10)
  expect(drift.y).toBeCloseTo(0, 10)
}

describe('centerShift 容器尺寸变化时的视口平移', () => {
  it('尺寸与位置都不变时不产生位移', () => {
    expect(centerShift(BASE, { ...BASE })).toEqual({ x: 0, y: 0 })
  })

  it('容器整体移动但尺寸不变时不产生位移（内容跟着容器走）', () => {
    // 例如窗口滚动或浏览器窗口平移：左上角变了，但画布中心相对容器没变
    const next = { ...BASE, left: 0, top: 80 }
    expect(centerShift(BASE, next)).toEqual({ x: 0, y: 0 })
    expectCentered(BASE, next)
  })

  it('左侧面板收起：left 264 → 0、宽度 +264，视口右移 132', () => {
    const next = { ...BASE, left: 0, width: BASE.width + SIDEBAR }
    // 画布中心在屏幕上左移 132，左上角左移 264，内容相对容器落后 132，需要右移 132
    expect(next.left + next.width / 2).toBe(BASE.left + BASE.width / 2 - SIDEBAR / 2)
    expect(centerShift(BASE, next)).toEqual({ x: SIDEBAR / 2, y: 0 })
    expectCentered(BASE, next)
  })

  it('左侧面板展开：left 0 → 264、宽度 -264，视口左移 132', () => {
    const collapsed = { ...BASE, left: 0, width: BASE.width + SIDEBAR }
    expect(centerShift(collapsed, BASE)).toEqual({ x: -SIDEBAR / 2, y: 0 })
    expectCentered(collapsed, BASE)
  })

  it('右侧检查器收起：左边缘不动、宽度 +336，视口右移 168', () => {
    const next = { ...BASE, width: BASE.width + INSPECTOR }
    expect(centerShift(BASE, next)).toEqual({ x: INSPECTOR / 2, y: 0 })
    expectCentered(BASE, next)
  })

  it('右侧检查器展开：左边缘不动、宽度 -336，视口左移 168', () => {
    const expanded = { ...BASE, width: BASE.width + INSPECTOR }
    expect(centerShift(expanded, BASE)).toEqual({ x: -INSPECTOR / 2, y: 0 })
    expectCentered(expanded, BASE)
  })

  it('窗口缩放时宽高各按变化量的一半平移', () => {
    // 窗口 1280×800 → 1200×820：画布宽 -80、高 +20，左上角不变
    const next = { ...BASE, width: BASE.width - 80, height: BASE.height + 20 }
    expect(centerShift(BASE, next)).toEqual({ x: -40, y: 10 })
    expectCentered(BASE, next)
  })

  it('左上角与尺寸同时变化时仍只按尺寸变化补偿', () => {
    const next = { left: 0, top: 30, width: BASE.width + SIDEBAR, height: BASE.height - 20 }
    expect(centerShift(BASE, next)).toEqual({ x: SIDEBAR / 2, y: -10 })
    expectCentered(BASE, next)
  })

  it('面板开合是同一位移的正反两向，往返后回到原点', () => {
    const collapsed = { ...BASE, left: 0, width: BASE.width + SIDEBAR }
    const there = centerShift(BASE, collapsed)
    const back = centerShift(collapsed, BASE)
    expect(back.x).toBeCloseTo(-there.x, 10)
    expect(back.y).toBeCloseTo(-there.y, 10)
    expectCentered(BASE, collapsed)
    expectCentered(collapsed, BASE)
  })
})

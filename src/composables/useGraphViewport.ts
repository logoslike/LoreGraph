import type { FitViewParams, VueFlowStore, XYPosition } from '@vue-flow/core'

/** 视口适配参数。 */
export interface ViewportFitOptions {
  /** 留白比例：0.2 约等于四周各留 9% 空间。 */
  padding?: number
  /** 过渡动画时长（毫秒）。 */
  duration?: number
  /** 最大缩放，避免单个节点被放得过大。 */
  maxZoom?: number
}

/**
 * 画布容器在屏幕坐标系中的矩形。
 * left / top 用于说明容器本身可能移动，但视口平移只取决于 width / height 的变化。
 */
export interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 容器尺寸变化后，让「原来位于画布中心的内容」仍落在新中心所需的视口位移（屏幕像素）。
 *
 * Vue Flow 的视口变换是 transform: translate(x, y) scale(zoom)，挂在容器左上角且
 * transform-origin: 0 0，所以 x / y 是相对容器左上角的屏幕像素、不随 zoom 缩放，
 * 内容屏幕坐标 = 容器左上角 + 视口平移 + 画布坐标 × zoom。
 *
 * 容器尺寸变化时左上角也可能移动（左侧栏收起时画布左边缘左移 264px），但左上角的
 * 移动会带着内容一起移动，不需要补偿；相对左上角，画布中心只从 W/2 移到 W'/2，
 * 因此只需把内容相对容器移动 (W' - W)/2。left / top 必须排除在外：
 * 若改用屏幕中心差，左侧栏收起会得到 -132（应为 +132），偏差恰为侧栏宽度的一倍。
 *
 * 只改视口平移量，不改缩放。
 */
export function centerShift(previous: ViewportRect, next: ViewportRect): XYPosition {
  return {
    x: (next.width - previous.width) / 2,
    y: (next.height - previous.height) / 2,
  }
}

function rectOf(element: HTMLElement): ViewportRect {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** 图谱视口工具：适应视图、聚焦节点、取视口中心与新建节点落点。 */
export interface GraphViewport {
  /** 适应全部可见节点。 */
  fitAll(options?: ViewportFitOptions): Promise<boolean>
  /** 单节点居中并适配。 */
  fitNode(nodeId: string, options?: ViewportFitOptions): Promise<boolean>
  /** 将节点中心移到视口中心（保持当前缩放或指定缩放）。 */
  centerOnNode(nodeId: string, zoom?: number): Promise<boolean>
  /** 视口中心对应的画布坐标。 */
  viewportCenter(): XYPosition
  /** 视口中心附近（正负 jitter）的落点，用于新建节点。 */
  nextNodePosition(jitter?: number): XYPosition
  zoomIn(): Promise<boolean>
  zoomOut(): Promise<boolean>
  /**
   * 监听容器尺寸变化并保持中心内容不动（按尺寸变化量的一半平移视口，不缩放、不 fitView）。
   * 返回断开函数，组件卸载时调用。
   */
  preserveCenterOnResize(element: HTMLElement | null): () => void
}

/**
 * 在 GraphCanvas 的 setup 中调用：传入 useVueFlow() 返回的实例，
 * 统一封装画布视口相关操作，避免组件里散落 fitView/setCenter 细节。
 */
export function useGraphViewport(flow: VueFlowStore): GraphViewport {
  const {
    dimensions,
    findNode,
    fitView,
    getViewport,
    screenToFlowCoordinate,
    setCenter,
    setViewport,
    vueFlowRef,
    zoomIn: zoomInAction,
    zoomOut: zoomOutAction,
  } = flow

  function fitAll(options: ViewportFitOptions = {}): Promise<boolean> {
    const params: FitViewParams = {
      padding: options.padding ?? 0.2,
      duration: options.duration ?? 320,
      minZoom: 0.1,
      maxZoom: options.maxZoom ?? 1.2,
    }
    return fitView(params)
  }

  function fitNode(nodeId: string, options: ViewportFitOptions = {}): Promise<boolean> {
    if (!findNode(nodeId)) {
      return Promise.resolve(false)
    }
    const params: FitViewParams = {
      nodes: [nodeId],
      padding: options.padding ?? 0.5,
      duration: options.duration ?? 320,
      minZoom: 0.2,
      maxZoom: options.maxZoom ?? 1.25,
    }
    return fitView(params)
  }

  function centerOnNode(nodeId: string, zoom?: number): Promise<boolean> {
    const node = findNode(nodeId)
    if (!node) {
      return Promise.resolve(false)
    }
    const width = node.dimensions.width || 0
    const height = node.dimensions.height || 0
    return setCenter(node.computedPosition.x + width / 2, node.computedPosition.y + height / 2, {
      zoom: zoom ?? getViewport().zoom,
      duration: 280,
    })
  }

  function viewportCenter(): XYPosition {
    const element = vueFlowRef.value
    if (element) {
      const rect = element.getBoundingClientRect()
      // screenToFlowCoordinate 接收的是屏幕（client）坐标
      return screenToFlowCoordinate({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
    }
    const size = dimensions.value
    const viewport = getViewport()
    const zoom = viewport.zoom || 1
    return {
      x: (size.width / 2 - viewport.x) / zoom,
      y: (size.height / 2 - viewport.y) / zoom,
    }
  }

  function nextNodePosition(jitter = 60): XYPosition {
    const center = viewportCenter()
    return {
      x: Math.round(center.x + (Math.random() * 2 - 1) * jitter),
      y: Math.round(center.y + (Math.random() * 2 - 1) * jitter),
    }
  }

  /**
   * 窗口缩放或左右面板开合会让容器尺寸变化。此时若什么都不做，画布左上角锚定的内容会
   * 相对画布中心漂移；若直接 fitView 又会打断用户当前的平移缩放。这里只按尺寸变化的
   * 一半平移视口（见 centerShift）：原来在中心的内容仍在中心，缩放不变。
   */
  function preserveCenterOnResize(element: HTMLElement | null): () => void {
    if (!element || typeof ResizeObserver === 'undefined') {
      return () => {}
    }
    let previous = rectOf(element)
    // ResizeObserver 每帧最多回调一次，回调发生在布局之后、绘制之前，
    // 因此在这里同步平移视口不会闪一帧，也不需要在回调里再套 requestAnimationFrame。
    const observer = new ResizeObserver(() => {
      const next = rectOf(element)
      // 容器尚未布局或已隐藏（宽高为 0）时只更新基准，不做平移
      if (next.width === 0 || next.height === 0 || previous.width === 0 || previous.height === 0) {
        previous = next
        return
      }
      const shift = centerShift(previous, next)
      previous = next
      if (shift.x === 0 && shift.y === 0) {
        return
      }
      const current = getViewport()
      void setViewport({
        x: current.x + shift.x,
        y: current.y + shift.y,
        zoom: current.zoom,
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }

  return {
    fitAll,
    fitNode,
    centerOnNode,
    viewportCenter,
    nextNodePosition,
    zoomIn: () => zoomInAction({ duration: 200 }),
    zoomOut: () => zoomOutAction({ duration: 200 }),
    preserveCenterOnResize,
  }
}

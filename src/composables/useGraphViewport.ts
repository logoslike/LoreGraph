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
    return setCenter(
      node.computedPosition.x + width / 2,
      node.computedPosition.y + height / 2,
      { zoom: zoom ?? getViewport().zoom, duration: 280 },
    )
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

  return {
    fitAll,
    fitNode,
    centerOnNode,
    viewportCenter,
    nextNodePosition,
    zoomIn: () => zoomInAction({ duration: 200 }),
    zoomOut: () => zoomOutAction({ duration: 200 }),
  }
}

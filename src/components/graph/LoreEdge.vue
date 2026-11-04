<script setup lang="ts">
import { computed, inject } from 'vue'
import { BaseEdge, useVueFlow, type EdgeProps } from '@vue-flow/core'
import {
  EDGE_OBSTACLES,
  nodeRectOf,
  pickObstacles,
  reuseObstacles,
  type NodeRects,
} from './edge-obstacles'
import { computeLanedEdgeGeometry, normalObstacleBounds, type Rect } from './edge-lanes'
import type { LoreEdgeData } from './types'

/**
 * 自定义关系渲染：所有关系都由 edge-lanes 生成连续三次贝塞尔路径。
 * 同一对节点之间存在多条关系时 GraphCanvas 传入 lane，
 * 曲线绕到节点上方/下方分道，避免连线与标签完全重叠。
 */
const props = defineProps<EdgeProps<LoreEdgeData>>()

/** 几何不使用障碍时统一返回同一个空数组，避免下游 geometry 因空列表身份变化而失效。 */
const NO_OBSTACLES: readonly Rect[] = []

/**
 * 障碍几何优先用 GraphCanvas 提供的共享快照：拖动期间它按 @node-drag 增量更新，
 * 移动中的节点盒实时参与避障，其余盒保持对象身份。
 * 单独挂载（例如组件单测）时退回本地读取 Vue Flow 节点。
 */
const sharedObstacles = inject(EDGE_OBSTACLES, null)
const flow = useVueFlow()

const localObstacles = computed<NodeRects>(() => {
  const rects = new Map<string, Rect>()
  for (const node of flow.nodes.value) {
    rects.set(node.id, nodeRectOf(node))
  }
  return rects
})

/** 端点盒只由端点位置与尺寸决定：拖动时只有被拖节点的关联边会重建它。 */
const endpointRects = computed(() => ({
  source: nodeRectOf(props.sourceNode),
  target: nodeRectOf(props.targetNode),
}))

/**
 * 只保留可能被这条关系的两个候选曲线命中的障碍盒。
 * 候选只由端点与端口决定，所以包围盒并集与障碍无关：移动中的节点盒一旦进入或离开
 * 走廊，列表就会变化并触发几何重算；内容与矩形身份都没变时返回上一份数组，
 * 让下游 geometry computed 命中缓存——远端关系在拖动期间因此不会重算。
 */
let previousObstacles: readonly Rect[] = NO_OBSTACLES
const obstacles = computed<readonly Rect[]>(() => {
  const bounds = normalObstacleBounds({
    lane: props.data?.lane ?? 0,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    sourceRect: endpointRects.value.source,
    targetRect: endpointRects.value.target,
  })
  if (bounds === null) {
    return NO_OBSTACLES
  }
  const rects = sharedObstacles?.value ?? localObstacles.value
  previousObstacles = reuseObstacles(
    previousObstacles,
    pickObstacles(rects, props.source, props.target, bounds),
  )
  return previousObstacles
})

const geometry = computed(() =>
  computeLanedEdgeGeometry({
    lane: props.data?.lane ?? 0,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    sourceRect: endpointRects.value.source,
    targetRect: endpointRects.value.target,
    obstacles: obstacles.value,
  }),
)
</script>

<template>
  <BaseEdge
    :id="id"
    :path="geometry.path"
    :label-x="geometry.labelX"
    :label-y="geometry.labelY"
    :label="label"
    :label-style="labelStyle"
    :label-show-bg="labelShowBg"
    :label-bg-style="labelBgStyle"
    :label-bg-padding="labelBgPadding"
    :label-bg-border-radius="labelBgBorderRadius"
    :marker-start="markerStart"
    :marker-end="markerEnd"
    :interaction-width="interactionWidth"
    :style="style"
  />
</template>

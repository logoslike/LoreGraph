<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, type EdgeProps, type GraphNode } from '@vue-flow/core'
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from '@/services/layout.service'
import { computeLanedEdgeGeometry, type Rect } from './edge-lanes'
import type { LoreEdgeData } from './types'

/**
 * 自定义关系渲染：默认仍走 Vue Flow 的 smoothstep；
 * 当同一对节点之间存在多条关系时由 GraphCanvas 传入 lane，
 * 绕到节点上方/下方分道，避免连线与标签完全重叠。
 */
const props = defineProps<EdgeProps<LoreEdgeData>>()

function rectOf(node: GraphNode): Rect {
  const dimensions = node.dimensions
  return {
    x: node.computedPosition.x,
    y: node.computedPosition.y,
    width: dimensions.width > 0 ? dimensions.width : DEFAULT_NODE_WIDTH,
    height: dimensions.height > 0 ? dimensions.height : DEFAULT_NODE_HEIGHT,
  }
}

const geometry = computed(() =>
  computeLanedEdgeGeometry({
    lane: props.data?.lane ?? 0,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    sourceRect: rectOf(props.sourceNode),
    targetRect: rectOf(props.targetNode),
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

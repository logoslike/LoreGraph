<script setup lang="ts">
import { computed, type Ref } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import { ArrowRight } from '@lucide/vue'
import { nodeRectOf } from './edge-obstacles'
import type { LoreNodeData } from './types'
import {
  computeOffscreenIndicators,
  type CanvasSize,
  type IndicatorNodeBox,
  type IndicatorSide,
  type ViewportTransform,
} from '@/services/offscreen-indicators'

/**
 * 屏外节点方向标注：由 GraphCanvas 只在「大图 + 聚焦」时挂载。
 *
 * 视口、尺寸与节点都以 ref 传入，而不是在父组件里先解引用成普通值：
 * 平移缩放每帧都会整体替换视口对象，父组件一旦在模板里取值就会整层重渲染；
 * 交给这里订阅，重渲染只发生在这个浮层内部。
 */
const props = defineProps<{
  nodes: Ref<GraphNode[]>
  viewport: Ref<ViewportTransform>
  size: Ref<CanvasSize>
}>()

const emit = defineEmits<{
  locate: [nodeId: string]
}>()

const indicators = computed(() => {
  const boxes: IndicatorNodeBox[] = props.nodes.value.map((node) => ({
    id: node.id,
    name: (node.data as LoreNodeData).name,
    ...nodeRectOf(node),
  }))
  return computeOffscreenIndicators(boxes, props.viewport.value, props.size.value)
})

const SIDE_LABEL: Record<IndicatorSide, string> = {
  left: '左侧',
  right: '右侧',
  top: '上方',
  bottom: '下方',
}

const ANCHOR_TRANSFORM: Record<IndicatorSide, string> = {
  left: 'translate(0, -50%)',
  right: 'translate(-100%, -50%)',
  top: 'translate(-50%, 0)',
  bottom: 'translate(-50%, -100%)',
}
</script>

<template>
  <!-- 标注作为跳转控件，可用 Tab 聚焦并由读屏器按节点名称播报 -->
  <div class="offscreen-indicators" data-testid="offscreen-indicators">
    <button
      v-for="indicator in indicators"
      :key="indicator.nodeId"
      type="button"
      class="offscreen-indicator"
      data-testid="offscreen-indicator"
      :data-node-id="indicator.nodeId"
      :data-side="indicator.side"
      :data-angle="Math.round(indicator.angle)"
      :aria-label="`将画布移至节点：${indicator.name}（${SIDE_LABEL[indicator.side]}）`"
      :title="`将画布移至节点：${indicator.name}（${SIDE_LABEL[indicator.side]}）`"
      :style="{
        left: `${indicator.x}px`,
        top: `${indicator.y}px`,
        transform: ANCHOR_TRANSFORM[indicator.side],
      }"
      @click="emit('locate', indicator.nodeId)"
    >
      <span
        class="offscreen-indicator__arrow"
        aria-hidden="true"
        :style="{ transform: `rotate(${indicator.angle}deg)` }"
      >
        <ArrowRight :size="12" />
      </span>
      <span class="offscreen-indicator__name">{{ indicator.name }}</span>
    </button>
  </div>
</template>

<style scoped>
.offscreen-indicators {
  position: absolute;
  inset: 0;
  z-index: 4;
  overflow: hidden;
  pointer-events: none;
}

.offscreen-indicator {
  position: absolute;
  display: flex;
  max-width: 8rem;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  color: var(--fg);
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
  pointer-events: auto;
  appearance: none;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    background-color 100ms ease,
    border-color 100ms ease,
    box-shadow 100ms ease;
}

.offscreen-indicator:hover {
  border-color: var(--accent);
  background: var(--surface);
}

.offscreen-indicator:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.offscreen-indicator__arrow {
  display: flex;
  flex: none;
  color: var(--muted);
}

.offscreen-indicator__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

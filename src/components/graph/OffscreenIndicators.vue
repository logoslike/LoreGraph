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

const indicators = computed(() => {
  const boxes: IndicatorNodeBox[] = props.nodes.value.map((node) => ({
    id: node.id,
    name: (node.data as LoreNodeData).name,
    ...nodeRectOf(node),
  }))
  return computeOffscreenIndicators(boxes, props.viewport.value, props.size.value)
})

/** 按所在边把胶囊朝画布内侧展开，避免被画布的 overflow: hidden 裁掉。 */
const ANCHOR_TRANSFORM: Record<IndicatorSide, string> = {
  left: 'translate(0, -50%)',
  right: 'translate(-100%, -50%)',
  top: 'translate(-50%, 0)',
  bottom: 'translate(-50%, -100%)',
}
</script>

<template>
  <!-- 纯标注：不接收指针事件，也不进入读屏顺序（节点本身可从侧栏到达） -->
  <div class="offscreen-indicators" data-testid="offscreen-indicators" aria-hidden="true">
    <span
      v-for="indicator in indicators"
      :key="indicator.nodeId"
      class="offscreen-indicator"
      data-testid="offscreen-indicator"
      :data-node-id="indicator.nodeId"
      :data-side="indicator.side"
      :data-angle="Math.round(indicator.angle)"
      :style="{
        left: `${indicator.x}px`,
        top: `${indicator.y}px`,
        transform: ANCHOR_TRANSFORM[indicator.side],
      }"
    >
      <span
        class="offscreen-indicator__arrow"
        :style="{ transform: `rotate(${indicator.angle}deg)` }"
      >
        <ArrowRight :size="12" />
      </span>
      <span class="offscreen-indicator__name">{{ indicator.name }}</span>
    </span>
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
  box-shadow: 0 1px 6px rgb(0 0 0 / 12%);
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

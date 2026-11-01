<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { getIconComponent } from '@/models/icons'
import type { LoreNodeData } from './types'

const props = defineProps<NodeProps<LoreNodeData>>()

const icon = computed(() => getIconComponent(props.data.iconName))
const color = computed(() => props.data.color || '#6366f1')
</script>

<template>
  <div
    class="lore-node"
    data-testid="lore-node"
    :data-node-id="id"
    :data-selected="data.isSelected ? 'true' : 'false'"
    :data-dimmed="data.isDimmed ? 'true' : 'false'"
    :class="{
      'is-selected': data.isSelected,
      'is-match': data.isMatch,
      'is-dimmed': data.isDimmed,
    }"
    :style="{ '--lore-color': color }"
  >
    <!-- 左右各一个连接点：从右侧拖出、连到左侧 -->
    <Handle id="left" type="target" :position="Position.Left" :connectable="connectable" />
    <Handle id="right" type="source" :position="Position.Right" :connectable="connectable" />

    <span class="lore-node__bar" aria-hidden="true" />
    <span class="lore-node__icon" aria-hidden="true">
      <component :is="icon" :size="16" />
    </span>
    <span class="lore-node__text">
      <span class="lore-node__name" :title="data.name">{{ data.name }}</span>
      <span class="lore-node__type">{{ data.typeLabel }}</span>
    </span>
  </div>
</template>

<style scoped>
.lore-node {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 210px;
  min-height: 52px;
  padding: 9px 12px 9px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
  transition:
    box-shadow 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
}

.lore-node:hover {
  border-color: var(--lore-color);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.1);
}

.lore-node.is-selected {
  border-color: var(--lore-color);
  box-shadow:
    0 0 0 2px var(--ring),
    0 6px 18px rgb(0 0 0 / 0.14);
}

/* 相邻高亮：与选中项无关的节点变淡，与搜索命中可叠加 */
.lore-node.is-dimmed {
  opacity: 0.25;
}

/* 搜索命中：额外的高亮环，与选中态可叠加 */
.lore-node.is-match {
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px var(--ring),
    0 0 18px 2px var(--ring);
}

.lore-node__bar {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  border-radius: 10px 0 0 10px;
  background: var(--lore-color);
}

.lore-node__icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--lore-color);
  background: var(--surface-2);
}

.lore-node__text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.lore-node__name {
  overflow: hidden;
  color: var(--fg);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lore-node__type {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lore-node :deep(.vue-flow__handle) {
  width: 8px;
  height: 8px;
  border: 2px solid var(--bg);
  background: var(--border);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.lore-node:hover :deep(.vue-flow__handle),
.lore-node.is-selected :deep(.vue-flow__handle) {
  opacity: 1;
}

.lore-node :deep(.vue-flow__handle:hover) {
  background: var(--accent);
  opacity: 1;
}
</style>

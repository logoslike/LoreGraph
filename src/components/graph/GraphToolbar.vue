<script setup lang="ts">
import { Maximize, Plus, Shapes, Trash, ZoomIn, ZoomOut } from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'

withDefaults(
  defineProps<{
    /** 当前是否有可删除的选中项（节点或关系）。 */
    canDelete?: boolean
  }>(),
  { canDelete: false },
)

const emit = defineEmits<{
  (event: 'create-node'): void
  (event: 'manage-types'): void
  (event: 'fit-view'): void
  (event: 'zoom-in'): void
  (event: 'zoom-out'): void
  (event: 'delete-selected'): void
}>()
</script>

<template>
  <div
    class="flex flex-col items-center gap-0.5 rounded-xl border border-border bg-bg p-1 shadow-lg"
    role="toolbar"
    aria-label="图谱工具栏"
    data-testid="graph-toolbar"
  >
    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="create-node-btn"
      aria-label="新建节点"
      title="新建节点（N）"
      @click="emit('create-node')"
    >
      <Plus :size="16" />
    </BaseButton>
    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="type-manager-btn"
      aria-label="类型管理"
      title="类型管理"
      @click="emit('manage-types')"
    >
      <Shapes :size="16" />
    </BaseButton>

    <span class="my-0.5 h-px w-6 bg-border" aria-hidden="true" />

    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="fit-view-btn"
      aria-label="适应视图"
      title="适应视图"
      @click="emit('fit-view')"
    >
      <Maximize :size="16" />
    </BaseButton>
    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="zoom-in-btn"
      aria-label="放大"
      title="放大"
      @click="emit('zoom-in')"
    >
      <ZoomIn :size="16" />
    </BaseButton>
    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="zoom-out-btn"
      aria-label="缩小"
      title="缩小"
      @click="emit('zoom-out')"
    >
      <ZoomOut :size="16" />
    </BaseButton>

    <span class="my-0.5 h-px w-6 bg-border" aria-hidden="true" />

    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="delete-selected-btn"
      :disabled="!canDelete"
      aria-label="删除选中"
      title="删除选中（支持撤销）"
      @click="emit('delete-selected')"
    >
      <Trash :size="16" :class="canDelete ? 'text-danger' : ''" />
    </BaseButton>
  </div>
</template>

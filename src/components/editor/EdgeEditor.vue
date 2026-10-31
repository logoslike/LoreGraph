<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Trash } from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import TypeSelect from './TypeSelect.vue'
import PropertyRows from './PropertyRows.vue'
import type { LoreEdge } from '@/models/edge'
import type { PropertyValue } from '@/services/types'
import { useToast } from '@/composables/useToast'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'

const props = defineProps<{
  edge: LoreEdge
}>()

const graph = useGraphStore()
const types = useTypesStore()
const toast = useToast()

const label = ref(props.edge.label ?? '')

watch(
  () => props.edge.id,
  () => {
    label.value = props.edge.label ?? ''
  },
)

const relationOptions = computed(() =>
  types.relationTypes.map((type) => ({ value: type.key, label: type.label, color: type.color })),
)

const sourceName = computed(() => graph.nodeById(props.edge.source)?.name ?? '（已删除）')
const targetName = computed(() => graph.nodeById(props.edge.target)?.name ?? '（已删除）')

function onTypeChange(value: string): void {
  if (value !== props.edge.relationType) {
    void graph.updateEdge(props.edge.id, { relationType: value })
  }
}

let labelTimer: ReturnType<typeof setTimeout> | null = null

/** 本地防抖落库，避免逐字符写库；空字符串表示清空标签。 */
function commitLabel(): void {
  const value = label.value.trim()
  if (value !== (props.edge.label ?? '')) {
    void graph.updateEdge(props.edge.id, { label: value })
  }
}

function onLabelInput(event: Event): void {
  label.value = (event.target as HTMLInputElement).value
  if (labelTimer !== null) {
    clearTimeout(labelTimer)
  }
  labelTimer = setTimeout(() => {
    labelTimer = null
    commitLabel()
  }, 400)
}

onBeforeUnmount(() => {
  // 卸载前把未落库的标签改动立即提交，避免切换选中项时丢失
  if (labelTimer !== null) {
    clearTimeout(labelTimer)
    labelTimer = null
    commitLabel()
  }
})

function onPropertiesChange(value: Record<string, PropertyValue>): void {
  void graph.updateEdge(props.edge.id, { properties: value })
}

async function onDelete(): Promise<void> {
  try {
    await graph.deleteEdge(props.edge.id)
  } catch (error) {
    toast.danger(error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-medium tracking-wide text-muted uppercase">关系</h3>
      <span class="text-xs text-muted">自动保存</span>
    </div>

    <div class="rounded-md border border-border bg-bg px-2.5 py-2 text-xs text-fg">
      <span class="font-medium">{{ sourceName }}</span>
      <span class="mx-1 text-muted">→</span>
      <span class="font-medium">{{ targetName }}</span>
    </div>

    <TypeSelect
      label="关系类型"
      :model-value="edge.relationType"
      :options="relationOptions"
      data-testid="edge-relation-type"
      @update:model-value="onTypeChange"
    />

    <label class="block">
      <span class="mb-1 block text-sm text-muted">标签</span>
      <input
        :value="label"
        type="text"
        maxlength="120"
        placeholder="可选，例如「亦师亦友」"
        data-testid="edge-label-input"
        class="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @input="onLabelInput"
      />
    </label>

    <PropertyRows :model-value="edge.properties" @update:model-value="onPropertiesChange" />

    <BaseButton
      variant="danger"
      size="sm"
      class="w-full"
      data-testid="delete-edge-btn"
      @click="onDelete"
    >
      <Trash :size="14" />
      删除关系
    </BaseButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Trash } from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import TypeSelect from './TypeSelect.vue'
import PropertyRows from './PropertyRows.vue'
import type { LoreNode } from '@/models/node'
import type { PropertyValue } from '@/services/types'
import { useToast } from '@/composables/useToast'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'

const props = defineProps<{
  node: LoreNode
}>()

const graph = useGraphStore()
const types = useTypesStore()
const toast = useToast()

const name = ref(props.node.name)
const description = ref(props.node.description)
const nameError = ref(false)

/** 仅在切换节点时同步草稿，避免自动保存回写覆盖正在输入的光标。 */
watch(
  () => props.node.id,
  () => {
    name.value = props.node.name
    description.value = props.node.description
    nameError.value = false
  },
)

const typeOptions = computed(() =>
  types.nodeTypes.map((type) => ({ value: type.key, label: type.label, color: type.color })),
)

interface IncidentRow {
  id: string
  direction: 'out' | 'in'
  otherName: string
  relationLabel: string
  color: string
}

const incidentRows = computed<IncidentRow[]>(() => {
  const nodeId = props.node.id
  return graph.incidentEdgesOf(nodeId).map((edge) => {
    const outgoing = edge.source === nodeId
    const otherId = outgoing ? edge.target : edge.source
    const relation = types.relationTypeByKey(edge.relationType)
    return {
      id: edge.id,
      direction: outgoing ? 'out' : 'in',
      otherName: graph.nodeById(otherId)?.name ?? '（已删除）',
      relationLabel: relation?.label ?? edge.relationType,
      color: relation?.color ?? 'var(--muted)',
    }
  })
})

function onNameInput(event: Event): void {
  name.value = (event.target as HTMLInputElement).value
  const value = name.value.trim()
  if (value === '') {
    nameError.value = true
    return
  }
  nameError.value = false
  if (value !== props.node.name) {
    void graph.updateNode(props.node.id, { name: value })
  }
}

function onNameBlur(): void {
  if (nameError.value) {
    name.value = props.node.name
    nameError.value = false
  }
}

function onDescriptionInput(event: Event): void {
  description.value = (event.target as HTMLTextAreaElement).value
  if (description.value !== props.node.description) {
    void graph.updateNode(props.node.id, { description: description.value })
  }
}

function onTypeChange(value: string): void {
  if (value !== props.node.type) {
    void graph.updateNode(props.node.id, { type: value })
  }
}

function onPropertiesChange(value: Record<string, PropertyValue>): void {
  void graph.updateNode(props.node.id, { properties: value })
}

function selectEdge(id: string): void {
  graph.selectEdge(id)
}

async function onDelete(): Promise<void> {
  try {
    await graph.deleteNode(props.node.id)
  } catch (error) {
    toast.danger(error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-medium tracking-wide text-muted uppercase">节点</h3>
      <span class="text-xs text-muted">自动保存</span>
    </div>

    <label class="block">
      <span class="mb-1 block text-sm text-muted">名称</span>
      <input
        :value="name"
        type="text"
        maxlength="120"
        placeholder="节点名称"
        data-testid="inspector-name"
        class="w-full rounded-md border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="nameError ? 'border-danger' : 'border-border'"
        @input="onNameInput"
        @blur="onNameBlur"
      />
      <span v-if="nameError" class="mt-1 block text-xs text-danger">名称不能为空</span>
    </label>

    <TypeSelect
      label="类型"
      :model-value="node.type"
      :options="typeOptions"
      data-testid="inspector-type-select"
      @update:model-value="onTypeChange"
    />

    <label class="block">
      <span class="mb-1 block text-sm text-muted">描述</span>
      <textarea
        :value="description"
        rows="5"
        maxlength="20000"
        data-testid="inspector-description"
        placeholder="记录这个节点的设定与细节…"
        class="w-full resize-y rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @input="onDescriptionInput"
      />
    </label>

    <PropertyRows :model-value="node.properties" @update:model-value="onPropertiesChange" />

    <section>
      <h4 class="mb-1 text-sm text-muted">所属关系（{{ incidentRows.length }}）</h4>
      <ul v-if="incidentRows.length > 0" class="space-y-1">
        <li v-for="row in incidentRows" :key="row.id">
          <button
            type="button"
            class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-fg hover:bg-surface-2"
            @click="selectEdge(row.id)"
          >
            <component
              :is="row.direction === 'out' ? ArrowRight : ArrowLeft"
              :size="13"
              class="shrink-0 text-muted"
            />
            <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: row.color }" />
            <span class="shrink-0 text-muted">{{ row.relationLabel }}</span>
            <span class="truncate">{{ row.otherName }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="text-xs text-muted">该节点还没有关系</p>
    </section>

    <BaseButton
      variant="danger"
      size="sm"
      class="w-full"
      data-testid="delete-node-btn"
      @click="onDelete"
    >
      <Trash :size="14" />
      删除节点
    </BaseButton>
  </div>
</template>

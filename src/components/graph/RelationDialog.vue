<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import type { LoreEdge } from '@/models/edge'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  open: boolean
  /** 连线起点节点 id。 */
  sourceId?: string | null
  /** 连线终点节点 id。 */
  targetId?: string | null
}>()

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'created', edge: LoreEdge): void
  (event: 'closed'): void
}>()

const graph = useGraphStore()
const types = useTypesStore()
const ui = useUiStore()

const relationType = ref('')
const label = ref('')
const submitting = ref(false)

const sourceNode = computed(() => (props.sourceId ? graph.nodeById(props.sourceId) : null))
const targetNode = computed(() => (props.targetId ? graph.nodeById(props.targetId) : null))
const relationOptions = computed(() => types.relationTypes)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return
    }
    relationType.value = types.relationTypes[0]?.key ?? ''
    label.value = ''
  },
)

function close(): void {
  emit('update:open', false)
  emit('closed')
}

async function onSubmit(): Promise<void> {
  if (submitting.value) {
    return
  }
  const source = props.sourceId
  const target = props.targetId
  if (!source || !target) {
    ui.notify('连线端点已失效，请重新拖拽连线', { variant: 'danger' })
    return
  }
  if (!sourceNode.value || !targetNode.value) {
    ui.notify('连线端点节点不存在', { variant: 'danger' })
    return
  }
  if (source === target) {
    ui.notify('不能把节点连接到自身', { variant: 'danger' })
    return
  }
  if (types.relationTypes.length === 0) {
    ui.notify('请先在「类型管理」中创建关系类型', { variant: 'danger' })
    return
  }
  if (relationType.value === '') {
    ui.notify('请选择关系类型', { variant: 'danger' })
    return
  }
  if (graph.edgeBetween(source, target)) {
    ui.notify('这两个节点之间已存在同向关系', { variant: 'danger' })
    return
  }
  submitting.value = true
  try {
    const edge = await graph.createEdge({
      source,
      target,
      relationType: relationType.value,
      label: label.value.trim() || undefined,
    })
    ui.notify('已创建关系')
    emit('created', edge)
    emit('closed')
  } catch (error) {
    ui.notify(error instanceof Error ? error.message : String(error), { variant: 'danger' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseDialog :open="open" title="新建关系" width="420px" @close="close">
    <div class="space-y-3">
      <p class="rounded-md bg-surface-2 px-3 py-2 text-sm text-fg">
        <span class="font-medium">{{ sourceNode?.name ?? '未知节点' }}</span>
        <span class="mx-1.5 text-muted">→</span>
        <span class="font-medium">{{ targetNode?.name ?? '未知节点' }}</span>
      </p>

      <label class="block">
        <span class="mb-1 block text-sm text-muted">关系类型</span>
        <select
          v-model="relationType"
          data-testid="relation-type-select"
          class="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option v-if="relationOptions.length === 0" value="">暂无关系类型</option>
          <option v-for="option in relationOptions" :key="option.key" :value="option.key">
            {{ option.label }}
          </option>
        </select>
        <span v-if="relationOptions.length === 0" class="mt-1 block text-xs text-danger">
          还没有关系类型，请先在「类型管理」中创建。
        </span>
      </label>

      <label class="block">
        <span class="mb-1 block text-sm text-muted">标签（可选）</span>
        <input
          v-model="label"
          data-testid="relation-label-input"
          type="text"
          maxlength="120"
          placeholder="例如：效忠于、位于…"
          class="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @keydown.enter="onSubmit"
        />
      </label>
    </div>

    <template #footer>
      <BaseButton variant="secondary" size="sm" @click="close">取消</BaseButton>
      <BaseButton
        size="sm"
        data-testid="submit-relation-btn"
        :disabled="submitting"
        @click="onSubmit"
      >
        创建关系
      </BaseButton>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import { useGraphViewport } from '@/composables/useGraphViewport'
import type { LoreNode } from '@/models/node'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'created', node: LoreNode): void
}>()

const graph = useGraphStore()
const types = useTypesStore()
const ui = useUiStore()
// 对话框是 GraphCanvas 的子组件，能注入到同一 Vue Flow store
const viewport = useGraphViewport(useVueFlow())

const name = ref('')
const type = ref('')
const description = ref('')
const nameError = ref(false)
const submitting = ref(false)

const typeOptions = computed(() => types.nodeTypes)
const canSubmit = computed(() => !submitting.value && typeOptions.value.length > 0)

/** 以视口中心为基准取落点，并让节点大致居中在落点处。 */
function dropPosition(): { x: number; y: number } {
  const center = viewport.nextNodePosition(70)
  return { x: Math.round(center.x - 105), y: Math.round(center.y - 26) }
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return
    }
    name.value = ''
    description.value = ''
    type.value = types.nodeTypes[0]?.key ?? ''
    nameError.value = false
  },
)

async function onSubmit(): Promise<void> {
  if (submitting.value) {
    return
  }
  if (name.value.trim() === '') {
    nameError.value = true
    return
  }
  if (types.nodeTypes.length === 0) {
    ui.notify('请先在「类型管理」中创建节点类型', { variant: 'danger' })
    return
  }
  if (type.value === '') {
    ui.notify('请选择节点类型', { variant: 'danger' })
    return
  }
  submitting.value = true
  try {
    const node = await graph.createNode({
      name: name.value.trim(),
      type: type.value,
      description: description.value.trim(),
      position: dropPosition(),
    })
    graph.selectNode(node.id)
    ui.notify('已创建节点「' + node.name + '」')
    emit('created', node)
    emit('update:open', false)
  } catch (error) {
    ui.notify(error instanceof Error ? error.message : String(error), { variant: 'danger' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseDialog :open="open" title="新建节点" width="420px" @close="emit('update:open', false)">
    <div class="space-y-3">
      <label class="block">
        <span class="mb-1 block text-sm text-muted">名称</span>
        <input
          v-model="name"
          data-testid="name-input"
          type="text"
          maxlength="120"
          placeholder="例如：灰烬王座"
          class="w-full rounded-md border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="nameError ? 'border-danger' : 'border-border'"
          @input="nameError = false"
          @keydown.enter="onSubmit"
        />
        <span v-if="nameError" class="mt-1 block text-xs text-danger">名称不能为空</span>
      </label>

      <label class="block">
        <span class="mb-1 block text-sm text-muted">类型</span>
        <select
          v-model="type"
          data-testid="type-select"
          class="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option v-if="typeOptions.length === 0" value="">暂无节点类型</option>
          <option v-for="option in typeOptions" :key="option.key" :value="option.key">
            {{ option.label }}
          </option>
        </select>
        <span v-if="typeOptions.length === 0" class="mt-1 block text-xs text-danger">
          还没有节点类型，请先在「类型管理」中创建。
        </span>
      </label>

      <label class="block">
        <span class="mb-1 block text-sm text-muted">描述（可选）</span>
        <textarea
          v-model="description"
          data-testid="description-input"
          rows="3"
          placeholder="一句话说明它是谁/什么…"
          class="w-full resize-y rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
    </div>

    <template #footer>
      <BaseButton variant="secondary" size="sm" @click="emit('update:open', false)">取消</BaseButton>
      <BaseButton
        size="sm"
        data-testid="submit-node-btn"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        创建节点
      </BaseButton>
    </template>
  </BaseDialog>
</template>

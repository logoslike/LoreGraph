<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import TypeSelect from './TypeSelect.vue'
import type { LoreNode, NodePosition } from '@/models/node'
import { useToast } from '@/composables/useToast'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'created', node: LoreNode): void
}>()

const graph = useGraphStore()
const types = useTypesStore()
const toast = useToast()

const name = ref('')
const type = ref('')
const description = ref('')
const nameError = ref(false)
const submitting = ref(false)

const typeOptions = computed(() =>
  types.nodeTypes.map((item) => ({ value: item.key, label: item.label, color: item.color })),
)

/** 以 220×130 为一格寻找第一个未被占用的落点。 */
function nextFreePosition(): NodePosition {
  const COLS = 5
  const CELL_WIDTH = 220
  const CELL_HEIGHT = 130
  const used = new Set(
    graph.nodes.map(
      (node) =>
        `${Math.round(node.position.x / CELL_WIDTH)},${Math.round(node.position.y / CELL_HEIGHT)}`,
    ),
  )
  for (let index = 0; index < 200; index += 1) {
    const column = index % COLS
    const row = Math.floor(index / COLS)
    if (!used.has(`${column},${row}`)) {
      return { x: column * CELL_WIDTH, y: row * CELL_HEIGHT }
    }
  }
  return { x: 0, y: 0 }
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
  if (type.value === '') {
    toast.danger('请先创建一个节点类型')
    return
  }
  submitting.value = true
  try {
    const node = await graph.createNode({
      name: name.value.trim(),
      type: type.value,
      description: description.value.trim(),
      position: nextFreePosition(),
    })
    graph.selectNode(node.id)
    toast.info(`已创建节点「${node.name}」`)
    emit('created', node)
    emit('update:open', false)
  } catch (error) {
    toast.danger(error instanceof Error ? error.message : String(error))
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
          type="text"
          maxlength="120"
          placeholder="例如：灰烬王座"
          autofocus
          class="w-full rounded-md border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="nameError ? 'border-danger' : 'border-border'"
          @input="nameError = false"
          @keydown.enter="onSubmit"
        />
        <span v-if="nameError" class="mt-1 block text-xs text-danger">名称不能为空</span>
      </label>

      <TypeSelect v-model="type" label="类型" :options="typeOptions" />

      <label class="block">
        <span class="mb-1 block text-sm text-muted">描述（可选）</span>
        <textarea
          v-model="description"
          rows="3"
          placeholder="一句话说明它是谁/什么…"
          class="w-full resize-y rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
    </div>
    <template #footer>
      <BaseButton variant="secondary" size="sm" @click="emit('update:open', false)"
        >取消</BaseButton
      >
      <BaseButton size="sm" :disabled="submitting" @click="onSubmit">创建节点</BaseButton>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import { UNIVERSE_DESCRIPTION_MAX_LENGTH, UNIVERSE_NAME_MAX_LENGTH } from '@/models/universe'

/** 对话框形态：新建与编辑共用同一套字段与校验。 */
type UniverseFormMode = 'create' | 'edit'

interface UniverseFormTestIds {
  name: string
  description: string
  submit?: string
}

const props = withDefaults(
  defineProps<{
    open: boolean
    mode: UniverseFormMode
    initialName?: string
    initialDescription?: string
    busy?: boolean
    testIds: UniverseFormTestIds
  }>(),
  {
    initialName: '',
    initialDescription: '',
    busy: false,
  },
)

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'submit', value: { name: string; description: string }): void
}>()

const name = ref('')
const description = ref('')
const nameError = ref(false)

const isCreate = computed(() => props.mode === 'create')
const title = computed(() => (isCreate.value ? '新建世界' : '编辑世界'))
const submitLabel = computed(() => (isCreate.value ? '创建并进入' : '保存'))
const descriptionHint = computed(() =>
  isCreate.value ? '简介可选，之后也能在世界卡片上修改。' : '留空则清除简介。',
)

// 每次打开都从传入值重置，取消后不残留上一次的输入
watch(
  () => props.open,
  (open) => {
    if (!open) {
      return
    }
    name.value = props.initialName
    description.value = props.initialDescription
    nameError.value = false
  },
  { immediate: true },
)

function onSubmit(): void {
  if (props.busy) {
    return
  }
  const trimmedName = name.value.trim()
  if (trimmedName === '') {
    nameError.value = true
    return
  }
  emit('submit', { name: trimmedName, description: description.value.trim() })
}
</script>

<template>
  <BaseDialog :open="open" :title="title" width="420px" @close="emit('close')">
    <label class="block">
      <span class="mb-1 block text-sm text-muted">世界名称</span>
      <input
        v-model="name"
        type="text"
        :maxlength="UNIVERSE_NAME_MAX_LENGTH"
        :placeholder="isCreate ? '例如：余烬王朝' : undefined"
        autofocus
        :data-testid="testIds.name"
        class="w-full rounded-md border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="nameError ? 'border-danger' : 'border-border'"
        @input="nameError = false"
        @keydown.enter="onSubmit"
      />
      <span v-if="nameError" class="mt-1 block text-xs text-danger">名称不能为空</span>
    </label>
    <label class="mt-3 block">
      <span class="mb-1 block text-sm text-muted">世界简介（可选）</span>
      <textarea
        v-model="description"
        rows="3"
        :maxlength="UNIVERSE_DESCRIPTION_MAX_LENGTH"
        placeholder="一句话介绍这个世界，会显示在世界卡片与检查器的世界概览上"
        :data-testid="testIds.description"
        class="w-full resize-y rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      ></textarea>
      <span class="mt-1 block text-xs text-muted">{{ descriptionHint }}</span>
    </label>
    <template #footer>
      <BaseButton variant="secondary" size="sm" @click="emit('close')">取消</BaseButton>
      <BaseButton size="sm" :disabled="busy" :data-testid="testIds.submit" @click="onSubmit">
        {{ submitLabel }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import BaseButton from './BaseButton.vue'
import BaseDialog from './BaseDialog.vue'

withDefaults(
  defineProps<{
    open: boolean
    title?: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    /** 供 E2E 定位确认按钮的 data-testid，可选。 */
    confirmTestId?: string
  }>(),
  {
    title: '请确认',
    confirmLabel: '确认',
    cancelLabel: '取消',
    danger: true,
    confirmTestId: '',
  },
)

const emit = defineEmits<{ (event: 'confirm'): void; (event: 'close'): void }>()
</script>

<template>
  <BaseDialog :open="open" :title="title" width="400px" @close="emit('close')">
    <p class="whitespace-pre-line text-sm text-muted">{{ message }}</p>
    <template #footer>
      <BaseButton variant="secondary" size="sm" @click="emit('close')">{{
        cancelLabel
      }}</BaseButton>
      <BaseButton
        :variant="danger ? 'danger' : 'primary'"
        size="sm"
        :data-testid="confirmTestId === '' ? undefined : confirmTestId"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>

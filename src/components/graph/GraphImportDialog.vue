<script setup lang="ts">
import { ref } from 'vue'
import ImportPreviewDialog from '@/components/common/ImportPreviewDialog.vue'
import { useToast } from '@/composables/useToast'
import { services } from '@/services'
import type { ImportPreview, ImportResult } from '@/services/types'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUniverseStore } from '@/stores/universe'

/**
 * 图谱片段导入：固定 merge 到当前世界。
 * 组件自己持有文件选择框，由工具栏调用 openPicker 弹出，避免多套对话框。
 */
const emit = defineEmits<{ (event: 'imported', result: ImportResult): void }>()

const graph = useGraphStore()
const types = useTypesStore()
const universe = useUniverseStore()
const toast = useToast()

const fileInput = ref<HTMLInputElement | null>(null)
const preview = ref<ImportPreview | null>(null)
const previewOpen = ref(false)
const analyzing = ref(false)

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 弹出文件选择框；每次打开都清掉上一次的预览。 */
function openPicker(): void {
  preview.value = null
  previewOpen.value = false
  fileInput.value?.click()
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  const universeId = graph.universeId
  if (!universeId) {
    toast.danger('尚未加载世界，无法导入图谱片段')
    return
  }
  analyzing.value = true
  try {
    const raw = await file.text()
    preview.value = await services.importer.analyzeImport(raw, {
      mode: 'merge',
      targetUniverseId: universeId,
    })
    previewOpen.value = true
  } catch (error) {
    toast.danger(`读取文件失败：${formatError(error)}`)
  } finally {
    analyzing.value = false
  }
}

function onClose(): void {
  previewOpen.value = false
  preview.value = null
}

/** 合并完成后刷新当前世界的图谱与类型，再通知外部。 */
async function onImported(result: ImportResult): Promise<void> {
  try {
    await Promise.all([graph.load(result.universeId), types.load(result.universeId)])
  } catch (error) {
    toast.danger(`刷新世界数据失败：${formatError(error)}`)
  }
  emit('imported', result)
}

defineExpose({ openPicker })
</script>

<template>
  <input
    ref="fileInput"
    type="file"
    accept="application/json,.json"
    class="hidden"
    data-testid="graph-import-input"
    @change="onFile"
  />
  <ImportPreviewDialog
    :open="previewOpen"
    :preview="preview"
    :target-name="universe.current?.name ?? ''"
    :analyzing="analyzing"
    @close="onClose"
    @imported="onImported"
  />
</template>

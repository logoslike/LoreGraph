<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import TypeDot from '@/components/common/TypeDot.vue'
import { useToast } from '@/composables/useToast'
import type { EntityScope } from '@/models/type-def'
import { services } from '@/services'
import type { ImportMode, ImportPreview, ImportResult } from '@/services/types'

/**
 * 导入预览：世界列表、世界概览与图谱导入共用同一套展示与提交逻辑。
 * 组件只负责交互，分析与写入都交给 importer 服务。
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    /** 分析结果；为 null 时展示加载态。 */
    preview: ImportPreview | null
    /** 合并导入的目标世界名称（当前世界）。 */
    targetName?: string
    /** 是否在对话框内切换导入方式（世界概览入口需要）。 */
    selectableMode?: boolean
    /** 切换方式后正在重新分析。 */
    analyzing?: boolean
  }>(),
  {
    targetName: '',
    selectableMode: false,
    analyzing: false,
  },
)

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'imported', result: ImportResult): void
  (event: 'mode-change', mode: ImportMode): void
}>()

const toast = useToast()

const submitting = ref(false)
/** 提交失败的原因：保留在对话框内，不关闭，便于用户改写文件后重试。 */
const failure = ref('')

const targetLabel = computed(() => props.targetName || '当前世界')
const isGraph = computed(() => props.preview?.format === 'loregraph.graph')
const formatLabel = computed(() => {
  if (!props.preview) {
    return '无法识别'
  }
  if (props.preview.format === 'loregraph.universe') {
    return '完整世界'
  }
  if (props.preview.format === 'loregraph.graph') {
    return '图谱片段'
  }
  return '无法识别'
})
const targetSummary = computed(() => {
  const preview = props.preview
  if (!preview) {
    return ''
  }
  return preview.mode === 'new-universe'
    ? '新世界（导入后名称追加「（导入）」）'
    : `合并到「${targetLabel.value}」`
})
const canSubmit = computed(
  () => props.preview !== null && props.preview.canImport && !submitting.value && !props.analyzing,
)

function scopeLabel(scope: EntityScope): string {
  return scope === 'node' ? '节点类型' : '关系类型'
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 导入结果的中文摘要，用于 Toast。 */
function describeResult(result: ImportResult): string {
  const head = result.createdUniverse
    ? `已导入世界「${result.universeName}」`
    : `已合并到「${result.universeName}」`
  const typePart = result.createdTypes > 0 ? `，新建 ${result.createdTypes} 个类型` : ''
  return `${head}：${result.createdNodes} 个节点、${result.createdEdges} 条关系${typePart}`
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      submitting.value = false
      failure.value = ''
    }
  },
  { immediate: true },
)

async function onSubmit(): Promise<void> {
  const preview = props.preview
  if (!preview || !preview.canImport || submitting.value) {
    return
  }
  submitting.value = true
  failure.value = ''
  try {
    const result = await services.importer.commitImport(preview)
    toast.info(describeResult(result))
    emit('imported', result)
    emit('close')
  } catch (error) {
    const message = formatError(error)
    failure.value = message
    toast.danger(`导入失败：${message}`)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseDialog
    v-if="open"
    :open="open"
    title="导入预览"
    width="560px"
    data-testid="import-preview-dialog"
    @close="emit('close')"
  >
    <div
      v-if="!preview"
      class="py-8 text-center text-sm text-muted"
      data-testid="import-preview-loading"
    >
      {{ analyzing ? '正在分析文件…' : '尚未选择文件' }}
    </div>

    <div v-else class="space-y-3">
      <dl class="grid grid-cols-2 gap-2">
        <div class="rounded-lg border border-border bg-bg p-2.5">
          <dt class="text-xs text-muted">文件类型</dt>
          <dd class="text-sm font-medium" data-testid="import-preview-format">{{ formatLabel }}</dd>
        </div>
        <div class="rounded-lg border border-border bg-bg p-2.5">
          <dt class="text-xs text-muted">导入目标</dt>
          <dd class="truncate text-sm font-medium" data-testid="import-preview-target">
            {{ targetSummary }}
          </dd>
        </div>
        <div class="rounded-lg border border-border bg-bg p-2.5">
          <dt class="text-xs text-muted">节点</dt>
          <dd class="text-lg font-semibold tabular-nums" data-testid="import-preview-node-count">
            {{ preview.nodeCount }}
          </dd>
        </div>
        <div class="rounded-lg border border-border bg-bg p-2.5">
          <dt class="text-xs text-muted">关系</dt>
          <dd class="text-lg font-semibold tabular-nums" data-testid="import-preview-edge-count">
            {{ preview.edgeCount }}
          </dd>
        </div>
      </dl>

      <p
        v-if="preview.universeName"
        class="text-xs text-muted"
        data-testid="import-preview-universe-name"
      >
        文件中的世界名称：{{ preview.universeName }}
      </p>

      <fieldset
        v-if="selectableMode"
        class="rounded-lg border border-border bg-bg p-3"
        data-testid="import-mode-select"
      >
        <legend class="px-1 text-xs font-medium tracking-wide text-muted uppercase">
          导入方式
        </legend>
        <div class="space-y-1.5">
          <label class="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="import-mode"
              value="new-universe"
              class="mt-0.5 size-3.5 accent-accent"
              :checked="preview.mode === 'new-universe'"
              :disabled="isGraph || analyzing"
              data-testid="import-mode-new"
              @change="emit('mode-change', 'new-universe')"
            />
            <span>
              <span class="font-medium">导入为新世界</span>
              <span class="block text-xs text-muted">新建一个世界，不改动现有世界。</span>
            </span>
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="import-mode"
              value="merge"
              class="mt-0.5 size-3.5 accent-accent"
              :checked="preview.mode === 'merge'"
              :disabled="analyzing"
              data-testid="import-mode-merge"
              @change="emit('mode-change', 'merge')"
            />
            <span>
              <span class="font-medium">合并到当前世界「{{ targetLabel }}」</span>
              <span class="block text-xs text-muted">
                节点与关系会追加到当前世界，同名节点不会自动合并。
              </span>
            </span>
          </label>
        </div>
        <p v-if="isGraph" class="mt-1.5 text-xs text-muted" data-testid="import-mode-graph-hint">
          图谱片段只能合并到已有世界。
        </p>
      </fieldset>

      <p v-if="analyzing" class="text-xs text-muted" data-testid="import-preview-analyzing">
        正在重新分析文件…
      </p>

      <section
        v-if="preview.errors.length > 0"
        class="rounded-lg border border-danger/40 bg-bg p-3"
        data-testid="import-preview-errors"
      >
        <p class="mb-1 text-xs font-medium text-danger">
          文件未通过校验（共 {{ preview.errors.length }} 项），修正后才能导入：
        </p>
        <ul class="max-h-40 space-y-1 overflow-y-auto text-xs text-muted">
          <li v-for="(error, index) in preview.errors" :key="index">{{ error }}</li>
        </ul>
      </section>

      <section
        v-if="preview.newTypes.length > 0"
        class="rounded-lg border border-border bg-bg p-3"
        data-testid="import-preview-new-types"
      >
        <p class="mb-1 text-xs font-medium text-muted">新建类型（{{ preview.newTypes.length }}）</p>
        <ul class="flex flex-wrap gap-x-3 gap-y-1">
          <li v-for="type in preview.newTypes" :key="`${type.scope}:${type.key}`">
            <TypeDot :color="type.color" :label="`${type.label}（${scopeLabel(type.scope)}）`" />
          </li>
        </ul>
      </section>

      <section
        v-if="preview.reusedTypes.length > 0"
        class="rounded-lg border border-border bg-bg p-3"
        data-testid="import-preview-reused-types"
      >
        <p class="mb-1 text-xs font-medium text-muted">
          复用现有类型（{{ preview.reusedTypes.length }}）
        </p>
        <ul class="flex flex-wrap gap-x-3 gap-y-1">
          <li v-for="type in preview.reusedTypes" :key="`${type.scope}:${type.key}`">
            <TypeDot :color="type.color" :label="`${type.label}（${scopeLabel(type.scope)}）`" />
          </li>
        </ul>
      </section>

      <section
        v-if="preview.typeConflicts.length > 0"
        class="rounded-lg border border-border bg-bg p-3"
        data-testid="import-preview-conflicts"
      >
        <p class="mb-1 text-xs font-medium text-muted">
          类型冲突（{{
            preview.typeConflicts.length
          }}）：同名类型的名称或颜色不同，导入后以现有类型为准。
        </p>
        <ul class="space-y-1.5">
          <li
            v-for="conflict in preview.typeConflicts"
            :key="`${conflict.scope}:${conflict.key}`"
            class="text-xs"
          >
            <span class="font-medium">{{ conflict.key }}</span>
            <span class="text-muted"> · {{ scopeLabel(conflict.scope) }}</span>
            <span class="ml-2 inline-flex items-center gap-1 text-muted">
              文件
              <span
                class="size-2.5 shrink-0 rounded-full"
                :style="{ backgroundColor: conflict.incoming.color }"
              />
              {{ conflict.incoming.label }}
              <span class="mx-1">→</span>
              现有
              <span
                class="size-2.5 shrink-0 rounded-full"
                :style="{ backgroundColor: conflict.existing.color }"
              />
              {{ conflict.existing.label }}
            </span>
          </li>
        </ul>
      </section>

      <section
        v-if="preview.duplicateNodeNames.length > 0"
        class="rounded-lg border border-border bg-bg p-3"
        data-testid="import-preview-duplicate-names"
      >
        <p class="mb-1 text-xs font-medium text-muted">
          重名节点（{{
            preview.duplicateNodeNames.length
          }}）：与目标世界已有节点同名，不会自动合并，会作为新节点导入。
        </p>
        <p class="text-xs text-muted">{{ preview.duplicateNodeNames.join('、') }}</p>
      </section>

      <section
        v-if="preview.warnings.length > 0"
        class="rounded-lg border border-border bg-bg p-3"
        data-testid="import-preview-warnings"
      >
        <p class="mb-1 text-xs font-medium text-muted">提示</p>
        <ul class="space-y-1 text-xs text-muted">
          <li v-for="(warning, index) in preview.warnings" :key="index">{{ warning }}</li>
        </ul>
      </section>

      <p
        v-if="failure"
        class="rounded-lg border border-danger/40 bg-bg p-3 text-xs text-danger"
        data-testid="import-preview-failure"
      >
        导入失败：{{ failure }}
      </p>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        size="sm"
        data-testid="import-preview-cancel-btn"
        @click="emit('close')"
      >
        取消
      </BaseButton>
      <BaseButton
        size="sm"
        :disabled="!canSubmit"
        data-testid="import-preview-confirm-btn"
        @click="onSubmit"
      >
        {{ submitting ? '导入中…' : '确认导入' }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, Download, PanelRightClose, Upload } from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import ImportPreviewDialog from '@/components/common/ImportPreviewDialog.vue'
import EdgeEditor from '@/components/editor/EdgeEditor.vue'
import NodeEditor from '@/components/editor/NodeEditor.vue'
import { useToast } from '@/composables/useToast'
import { LORE_GRAPH_FORMAT } from '@/models/export-format'
import { services } from '@/services'
import type { ImportMode, ImportOptions, ImportPreview, ImportResult } from '@/services/types'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUiStore } from '@/stores/ui'
import { useUniverseStore } from '@/stores/universe'

defineOptions({ name: 'AppInspector' })

const ui = useUiStore()
const graph = useGraphStore()
const types = useTypesStore()
const universe = useUniverseStore()
const toast = useToast()

const importInput = ref<HTMLInputElement | null>(null)
const importOpen = ref(false)
const importAnalyzing = ref(false)
const importRaw = ref('')
const importMode = ref<ImportMode>('new-universe')
const importPreview = ref<ImportPreview | null>(null)

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function onExport(): Promise<void> {
  const current = universe.current
  if (!current) {
    return
  }
  try {
    const data = await services.exporter.exportUniverse(current.id)
    services.exporter.download(data)
    toast.info('已导出世界 JSON')
  } catch (error) {
    toast.danger(`导出失败：${formatError(error)}`)
  }
}

function openImportPicker(): void {
  importInput.value?.click()
}

/** 读取文件后打开预览；图谱片段会自动切到合并模式再重新分析。 */
async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  try {
    importRaw.value = await file.text()
  } catch (error) {
    toast.danger(`读取文件失败：${formatError(error)}`)
    return
  }
  importMode.value = 'new-universe'
  importPreview.value = null
  importOpen.value = true
  await analyzeImport()
}

function importOptions(mode: ImportMode): ImportOptions {
  const targetUniverseId = universe.current?.id ?? graph.universeId ?? undefined
  return { mode, targetUniverseId: mode === 'merge' ? targetUniverseId : undefined }
}

async function analyzeImport(): Promise<void> {
  importAnalyzing.value = true
  try {
    const preview = await services.importer.analyzeImport(
      importRaw.value,
      importOptions(importMode.value),
    )
    // 图谱片段只能合并：直接切到合并并重新分析，避免先闪一条误导性的错误
    if (preview.format === LORE_GRAPH_FORMAT && importMode.value !== 'merge') {
      importMode.value = 'merge'
      importPreview.value = await services.importer.analyzeImport(
        importRaw.value,
        importOptions('merge'),
      )
      return
    }
    importPreview.value = preview
  } catch (error) {
    toast.danger(`导入分析失败：${formatError(error)}`)
    importPreview.value = null
    importOpen.value = false
  } finally {
    importAnalyzing.value = false
  }
}

async function onImportModeChange(mode: ImportMode): Promise<void> {
  if (mode === importMode.value) {
    return
  }
  importMode.value = mode
  await analyzeImport()
}

/** 导入成功后刷新当前世界（新建世界时只刷新列表）。 */
async function onImported(result: ImportResult): Promise<void> {
  importOpen.value = false
  importPreview.value = null
  try {
    if (result.createdUniverse) {
      await universe.loadAll()
      return
    }
    await Promise.all([
      graph.load(result.universeId),
      types.load(result.universeId),
      universe.loadAll(),
    ])
  } catch (error) {
    toast.danger(`刷新世界数据失败：${formatError(error)}`)
  }
}

function onImportClose(): void {
  importOpen.value = false
  importPreview.value = null
}

/** 从节点「所属关系」进入关系详情后，可返回来源节点；直接选边时始终为 false。 */
const canReturnToOrigin = computed(
  () =>
    graph.selectedEdgeId !== null &&
    graph.edgeOriginNodeId !== null &&
    graph.nodeById(graph.edgeOriginNodeId) !== null,
)

function onBackToOrigin(): void {
  const nodeId = graph.edgeOriginNodeId
  if (nodeId !== null) {
    graph.selectNode(nodeId)
  }
}
</script>

<template>
  <aside
    class="flex h-full w-full flex-col border-l border-border bg-surface text-fg"
    data-testid="inspector"
  >
    <header class="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
      <h2 class="text-sm font-semibold">检查器</h2>
      <div class="flex items-center gap-1">
        <button
          v-if="canReturnToOrigin"
          type="button"
          class="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
          title="返回节点检查器"
          aria-label="返回节点检查器"
          data-testid="inspector-back-to-node"
          @click="onBackToOrigin"
        >
          <ArrowLeft :size="16" />
        </button>
        <button
          type="button"
          class="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
          title="收起检查器"
          aria-label="收起检查器"
          data-testid="collapse-inspector"
          @click="ui.toggleInspector()"
        >
          <PanelRightClose :size="16" />
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <NodeEditor
        v-if="graph.selectedNode"
        :key="graph.selectedNode.id"
        :node="graph.selectedNode"
        data-testid="node-editor"
      />
      <EdgeEditor
        v-else-if="graph.selectedEdge"
        :key="graph.selectedEdge.id"
        :edge="graph.selectedEdge"
        data-testid="edge-editor"
      />
      <div v-else class="space-y-4" data-testid="inspector-empty">
        <section>
          <p class="text-xs font-medium tracking-wide text-muted uppercase">世界概览</p>
          <h3 class="mt-1 text-base font-semibold">
            {{ universe.current?.name ?? '未加载世界' }}
          </h3>
          <p v-if="universe.current?.description" class="mt-1 line-clamp-3 text-xs text-muted">
            {{ universe.current.description }}
          </p>
          <p v-else class="mt-1 text-xs text-muted">暂无描述</p>
        </section>

        <dl class="grid grid-cols-2 gap-2">
          <div class="rounded-lg border border-border bg-bg p-2.5">
            <dt class="text-xs text-muted">节点</dt>
            <dd class="text-lg font-semibold tabular-nums">{{ graph.nodes.length }}</dd>
          </div>
          <div class="rounded-lg border border-border bg-bg p-2.5">
            <dt class="text-xs text-muted">关系</dt>
            <dd class="text-lg font-semibold tabular-nums">{{ graph.edges.length }}</dd>
          </div>
          <div class="rounded-lg border border-border bg-bg p-2.5">
            <dt class="text-xs text-muted">节点类型</dt>
            <dd class="text-lg font-semibold tabular-nums">{{ types.nodeTypes.length }}</dd>
          </div>
          <div class="rounded-lg border border-border bg-bg p-2.5">
            <dt class="text-xs text-muted">关系类型</dt>
            <dd class="text-lg font-semibold tabular-nums">{{ types.relationTypes.length }}</dd>
          </div>
        </dl>

        <div class="space-y-1.5">
          <div class="grid grid-cols-2 gap-2">
            <BaseButton
              variant="secondary"
              size="sm"
              :disabled="!universe.current"
              data-testid="export-world-btn"
              @click="onExport"
            >
              <Download :size="14" />
              导出世界
            </BaseButton>
            <BaseButton
              variant="secondary"
              size="sm"
              :disabled="!universe.current"
              data-testid="import-world-btn"
              @click="openImportPicker"
            >
              <Upload :size="14" />
              导入世界
            </BaseButton>
          </div>
          <p class="text-xs text-muted">
            导出当前世界为 JSON 备份；导入时可选择新建世界或合并到当前世界。
          </p>
        </div>

        <p class="text-xs text-muted">选中画布中的节点或关系后，可在此编辑其名称、类型与属性。</p>
      </div>
    </div>

    <input
      ref="importInput"
      type="file"
      accept="application/json,.json"
      class="hidden"
      data-testid="inspector-import-input"
      @change="onImportFile"
    />

    <ImportPreviewDialog
      :open="importOpen"
      :preview="importPreview"
      :target-name="universe.current?.name ?? ''"
      selectable-mode
      :analyzing="importAnalyzing"
      @close="onImportClose"
      @mode-change="onImportModeChange"
      @imported="onImported"
    />
  </aside>
</template>

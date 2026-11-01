<script setup lang="ts">
import { Download, PanelRightClose } from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import EdgeEditor from '@/components/editor/EdgeEditor.vue'
import NodeEditor from '@/components/editor/NodeEditor.vue'
import { useToast } from '@/composables/useToast'
import { services } from '@/services'
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function onExport(): Promise<void> {
  const current = universe.current
  if (!current) {
    return
  }
  try {
    const data = await services.exporter.toExport(current.id)
    services.exporter.download(data)
    toast.info('已导出世界 JSON')
  } catch (error) {
    toast.danger(`导出失败：${formatError(error)}`)
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

        <div class="space-y-1">
          <BaseButton
            variant="secondary"
            class="w-full"
            :disabled="!universe.current"
            @click="onExport"
          >
            <Download :size="16" />
            导出 JSON
          </BaseButton>
          <p class="text-xs text-muted">导出当前世界为 JSON 备份或分享；导入请在世界列表页进行。</p>
        </div>

        <p class="text-xs text-muted">选中画布中的节点或关系后，可在此编辑其名称、类型与属性。</p>
      </div>
    </div>
  </aside>
</template>

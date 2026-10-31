<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import IconPicker from '@/components/common/IconPicker.vue'
import type { EntityScope, EntityType } from '@/models/type-def'
import { getIconComponent } from '@/models/icons'
import { TypeInUseError } from '@/services/errors'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (event: 'update:open', value: boolean): void }>()

const graph = useGraphStore()
const types = useTypesStore()
const ui = useUiStore()

/** 颜色需为 6 位十六进制，与 models/type-def 的 colorSchema 一致。 */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const TABS: { value: EntityScope; label: string }[] = [
  { value: 'node', label: '节点类型' },
  { value: 'relation', label: '关系类型' },
]

const scope = ref<EntityScope>('node')
const scopeLabel = computed(() => (scope.value === 'node' ? '节点类型' : '关系类型'))
const list = computed(() => (scope.value === 'node' ? types.nodeTypes : types.relationTypes))

const newLabel = ref('')
const newColor = ref('#6366f1')
const newIcon = ref<string | undefined>(undefined)
const creating = ref(false)

const editingId = ref<string | null>(null)
const editLabel = ref('')
const editColor = ref('#6366f1')
const editIcon = ref<string | undefined>(undefined)
const saving = ref(false)

/** 待确认删除的类型 id（二次确认内联在列表行里，避免嵌套对话框）。 */
const pendingDeleteId = ref<string | null>(null)
const deleting = ref(false)

/** 自动生成合法 key：仅小写字母与数字，形如 type-m8x2k1。 */
function makeKey(): string {
  const stamp = Date.now().toString(36)
  const suffix = Math.random().toString(36).slice(2, 5)
  return 'type-' + stamp + suffix
}

/** 切换类型作用域并重置新建表单。 */
function selectScope(value: EntityScope): void {
  scope.value = value
  resetNewForm()
}

function resetNewForm(): void {
  newLabel.value = ''
  newColor.value = '#6366f1'
  newIcon.value = undefined
  pendingDeleteId.value = null
  editingId.value = null
}

/** 原生取色器的值同步到十六进制文本输入。 */
function onNewColorPick(event: Event): void {
  newColor.value = (event.target as HTMLInputElement).value
}

function onEditColorPick(event: Event): void {
  editColor.value = (event.target as HTMLInputElement).value
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetNewForm()
    }
  },
)

/** 当前类型被多少个节点/关系引用。 */
function usageOf(type: EntityType): number {
  return scope.value === 'node'
    ? graph.nodes.filter((node) => node.type === type.key).length
    : graph.edges.filter((edge) => edge.relationType === type.key).length
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function onCreate(): Promise<void> {
  if (creating.value) {
    return
  }
  const label = newLabel.value.trim()
  if (label === '') {
    ui.notify('类型名称不能为空', { variant: 'danger' })
    return
  }
  if (!COLOR_PATTERN.test(newColor.value)) {
    ui.notify('颜色需为 6 位十六进制，例如 #6366f1', { variant: 'danger' })
    return
  }
  creating.value = true
  try {
    await types.create(scope.value, {
      key: makeKey(),
      label,
      color: newColor.value,
      icon: newIcon.value,
    })
    ui.notify('已新建' + scopeLabel.value + '「' + label + '」')
    newLabel.value = ''
    newIcon.value = undefined
  } catch (error) {
    ui.notify('新建失败：' + formatError(error), { variant: 'danger' })
  } finally {
    creating.value = false
  }
}

function startEdit(type: EntityType): void {
  editingId.value = type.id
  editLabel.value = type.label
  editColor.value = type.color
  editIcon.value = type.icon
  pendingDeleteId.value = null
}

function cancelEdit(): void {
  editingId.value = null
}

async function saveEdit(type: EntityType): Promise<void> {
  if (saving.value) {
    return
  }
  const label = editLabel.value.trim()
  if (label === '') {
    ui.notify('类型名称不能为空', { variant: 'danger' })
    return
  }
  if (!COLOR_PATTERN.test(editColor.value)) {
    ui.notify('颜色需为 6 位十六进制，例如 #6366f1', { variant: 'danger' })
    return
  }
  saving.value = true
  try {
    await types.update(type.id, {
      label,
      color: editColor.value,
      // 传空串表示清除图标（service 会丢弃 undefined 字段，无法删除已有图标）
      icon: editIcon.value ?? '',
    })
    ui.notify('已更新类型「' + label + '」')
    editingId.value = null
  } catch (error) {
    ui.notify('更新失败：' + formatError(error), { variant: 'danger' })
  } finally {
    saving.value = false
  }
}

function askDelete(type: EntityType): void {
  editingId.value = null
  pendingDeleteId.value = type.id
}

async function confirmDelete(type: EntityType): Promise<void> {
  if (deleting.value) {
    return
  }
  deleting.value = true
  try {
    await types.remove(type.id)
    ui.notify('已删除类型「' + type.label + '」')
    pendingDeleteId.value = null
  } catch (error) {
    if (error instanceof TypeInUseError) {
      ui.notify('类型「' + type.label + '」已被 ' + error.count + ' 处引用，无法删除', {
        variant: 'danger',
      })
    } else {
      ui.notify('删除失败：' + formatError(error), { variant: 'danger' })
    }
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <BaseDialog
    :open="open"
    title="类型管理"
    width="580px"
    data-testid="type-manager-dialog"
    @close="emit('update:open', false)"
  >
    <div class="space-y-4">
      <!-- 作用域切换 -->
      <div class="flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="类型作用域">
        <button
          v-for="tab in TABS"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="scope === tab.value"
          class="flex-1 rounded-md px-3 py-1.5 text-sm transition-colors"
          :class="scope === tab.value ? 'bg-bg text-fg shadow-sm' : 'text-muted hover:text-fg'"
          :data-testid="'type-tab-' + tab.value"
          @click="selectScope(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- 新建类型 -->
      <form
        class="space-y-2.5 rounded-lg border border-border bg-bg p-3"
        @submit.prevent="onCreate"
      >
        <p class="text-xs font-medium tracking-wide text-muted uppercase">新建{{ scopeLabel }}</p>
        <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <label class="block">
            <span class="mb-1 block text-sm text-muted">名称</span>
            <input
              v-model="newLabel"
              data-testid="type-label-input"
              type="text"
              maxlength="40"
              placeholder="例如：人物、地点、事件"
              class="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @keydown.enter.prevent="onCreate"
            />
          </label>
          <div class="block">
            <span class="mb-1 block text-sm text-muted">颜色</span>
            <span class="flex items-center gap-1.5">
              <input
                type="color"
                :value="newColor"
                aria-label="选择颜色"
                class="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-border bg-bg p-0.5"
                @input="onNewColorPick"
              />
              <input
                v-model="newColor"
                data-testid="type-color-input"
                type="text"
                maxlength="7"
                spellcheck="false"
                placeholder="#6366f1"
                class="w-24 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </span>
          </div>
        </div>
        <IconPicker v-model="newIcon" label="图标（可选）" />
        <div class="flex justify-end">
          <BaseButton type="submit" size="sm" data-testid="submit-type-btn" :disabled="creating">
            新建{{ scopeLabel }}
          </BaseButton>
        </div>
      </form>

      <!-- 类型列表 -->
      <ul class="space-y-1.5">
        <li
          v-for="type in list"
          :key="type.id"
          class="rounded-lg border border-border bg-bg px-2.5 py-2"
          :data-type-key="type.key"
        >
          <div v-if="editingId !== type.id" class="flex items-center gap-2">
            <span
              class="size-3 shrink-0 rounded-full"
              :style="{ backgroundColor: type.color }"
              aria-hidden="true"
            />
            <component :is="getIconComponent(type.icon)" :size="14" class="shrink-0 text-muted" />
            <span class="truncate text-sm font-medium text-fg">{{ type.label }}</span>
            <span class="shrink-0 font-mono text-xs text-muted">{{ type.key }}</span>
            <span class="ml-auto shrink-0 text-xs text-muted">{{ usageOf(type) }} 处引用</span>

            <template v-if="pendingDeleteId === type.id">
              <span class="shrink-0 text-xs text-danger">确认删除？</span>
              <BaseButton
                variant="danger"
                size="sm"
                data-testid="confirm-delete-type-btn"
                :disabled="deleting"
                @click="confirmDelete(type)"
              >
                删除
              </BaseButton>
              <BaseButton variant="ghost" size="sm" @click="pendingDeleteId = null">
                取消
              </BaseButton>
            </template>
            <template v-else>
              <BaseButton
                variant="ghost"
                size="sm"
                :data-testid="'edit-type-btn-' + type.key"
                @click="startEdit(type)"
              >
                编辑
              </BaseButton>
              <BaseButton
                variant="ghost"
                size="sm"
                :data-testid="'delete-type-btn-' + type.key"
                @click="askDelete(type)"
              >
                删除
              </BaseButton>
            </template>
          </div>

          <div v-else class="space-y-2">
            <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <label class="block">
                <span class="mb-1 block text-xs text-muted">名称</span>
                <input
                  v-model="editLabel"
                  :data-testid="'edit-type-label-' + type.key"
                  type="text"
                  maxlength="40"
                  class="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  @keydown.enter.prevent="saveEdit(type)"
                />
              </label>
              <div class="block">
                <span class="mb-1 block text-xs text-muted">颜色</span>
                <span class="flex items-center gap-1.5">
                  <input
                    type="color"
                    :value="editColor"
                    aria-label="修改类型颜色"
                    class="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-border bg-bg p-0.5"
                    @input="onEditColorPick"
                  />
                  <input
                    v-model="editColor"
                    :data-testid="'edit-type-color-' + type.key"
                    type="text"
                    maxlength="7"
                    spellcheck="false"
                    class="w-24 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </span>
              </div>
            </div>
            <IconPicker v-model="editIcon" label="图标" />
            <div class="flex justify-end gap-2">
              <BaseButton variant="secondary" size="sm" @click="cancelEdit">取消</BaseButton>
              <BaseButton
                size="sm"
                :data-testid="'save-type-btn-' + type.key"
                :disabled="saving"
                @click="saveEdit(type)"
              >
                保存
              </BaseButton>
            </div>
          </div>
        </li>

        <li v-if="list.length === 0" class="px-2 py-3 text-center text-xs text-muted">
          还没有{{ scopeLabel }}，先在上方新建一个。
        </li>
      </ul>

      <p class="text-xs text-muted">
        类型名称、颜色与图标会实时反映到画布的节点与连线上；被引用的类型不能删除。
      </p>
    </div>
  </BaseDialog>
</template>

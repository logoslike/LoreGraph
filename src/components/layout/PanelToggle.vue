<script setup lang="ts">
import { computed } from 'vue'
import { PanelLeftOpen, PanelRightOpen } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    side?: 'left' | 'right'
    label?: string
  }>(),
  {
    side: 'left',
    label: '',
  },
)

const emit = defineEmits<{ (event: 'toggle'): void }>()

const icon = computed(() => (props.side === 'left' ? PanelLeftOpen : PanelRightOpen))
</script>

<template>
  <button
    type="button"
    class="panel-toggle"
    :class="side === 'left' ? 'panel-toggle--left' : 'panel-toggle--right'"
    :title="label"
    :aria-label="label"
    @click="emit('toggle')"
  >
    <component :is="icon" :size="16" />
  </button>
</template>

<style scoped>
.panel-toggle {
  position: absolute;
  top: 12px;
  z-index: 50;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background-color: var(--surface);
  color: var(--muted);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.12);
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.panel-toggle:hover {
  color: var(--fg);
  background-color: var(--surface-2);
}

.panel-toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--ring);
}

.panel-toggle--left {
  left: 12px;
}

.panel-toggle--right {
  right: 12px;
}
</style>

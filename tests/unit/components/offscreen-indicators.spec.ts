import { describe, expect, it } from 'vitest'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import OffscreenIndicators from '@/components/graph/OffscreenIndicators.vue'
import type { CanvasSize, ViewportTransform } from '@/services/offscreen-indicators'

/** 组件只读 computedPosition / dimensions / data.name，其余字段与交互无关。 */
function fakeNode(id: string, name: string, x: number, y: number): GraphNode {
  return {
    id,
    computedPosition: { x, y },
    dimensions: { width: 180, height: 64 },
    data: { name },
  } as unknown as GraphNode
}

/**
 * 与 GraphCanvas 一样把 ref 传给浮层：平移缩放只替换 ref 的值，不重建组件。
 * 组件 props 带 Ref<GraphNode[]>，test-utils 的 mount 泛型会深到报 TS2589，
 * 这里只保留运行时校验，用 never 绕过它的类型推导。
 */
function mountLayer(
  viewport: ViewportTransform,
  nodes: GraphNode[],
): { wrapper: VueWrapper; viewportRef: Ref<ViewportTransform> } {
  const viewportRef = ref<ViewportTransform>(viewport)
  // 运行时只需要「一个装着节点的 ref」；写成 Ref<GraphNode[]> 会让 vue-tsc 递归过深
  const nodeRef: Ref<unknown[]> = ref(nodes)
  const sizeRef: Ref<CanvasSize> = ref({ width: 800, height: 600 })
  const wrapper = mount(OffscreenIndicators as never, {
    props: { nodes: nodeRef, viewport: viewportRef, size: sizeRef } as never,
  }) as VueWrapper
  return { wrapper, viewportRef }
}

function pillNodes(wrapper: VueWrapper): DOMWrapper<Element>[] {
  return wrapper.findAll('[data-testid="offscreen-indicator"]')
}

describe('OffscreenIndicators', () => {
  it('只为完全在画布外的节点渲染胶囊，并带出名称与所在边', () => {
    const { wrapper } = mountLayer({ x: 0, y: 0, zoom: 1 }, [
      fakeNode('n-west', '西邻', -300, 268),
      fakeNode('n-hub', '枢纽', 300, 250),
    ])

    const pills = pillNodes(wrapper)
    expect(pills).toHaveLength(1)
    expect(pills[0].attributes('data-node-id')).toBe('n-west')
    expect(pills[0].attributes('data-side')).toBe('left')
    expect(pills[0].text()).toContain('西邻')
    // 左侧胶囊避开左上工具栏、纵向居中并朝内展开
    const style = pills[0].attributes('style') ?? ''
    expect(style).toContain('left: 72px')
    expect(style).toContain('top: 300px')
    expect(style).toContain('translate(0, -50%)')
  })

  it('视口平移后跟着重算：原本在画布内的节点出界即补上胶囊', async () => {
    const { wrapper, viewportRef } = mountLayer({ x: 0, y: 0, zoom: 1 }, [
      fakeNode('n-hub', '枢纽', 300, 250),
    ])
    expect(pillNodes(wrapper)).toHaveLength(0)

    viewportRef.value = { x: 500, y: 0, zoom: 1 }
    await nextTick()

    const pills = pillNodes(wrapper)
    expect(pills).toHaveLength(1)
    expect(pills[0].attributes('data-node-id')).toBe('n-hub')
    expect(pills[0].attributes('data-side')).toBe('right')
  })

  it('没有屏外节点时容器仍在、但不渲染胶囊', () => {
    const { wrapper } = mountLayer({ x: 0, y: 0, zoom: 1 }, [fakeNode('n-hub', '枢纽', 300, 250)])
    expect(wrapper.get('[data-testid="offscreen-indicators"]')).toBeTruthy()
    expect(pillNodes(wrapper)).toHaveLength(0)
  })

  it('上侧多个标注按胶囊宽度排开，渲染位置不互相压住', () => {
    const { wrapper } = mountLayer({ x: 0, y: 0, zoom: 1 }, [
      fakeNode('n-a', '甲', 300, -200),
      fakeNode('n-b', '乙', 310, -200),
      fakeNode('n-c', '丙', 320, -200),
    ])

    const pills = pillNodes(wrapper)
    expect(pills).toHaveLength(3)
    expect(pills.every((pill) => pill.attributes('data-side') === 'top')).toBe(true)
    const xs = pills
      .map((pill) => Number(/left:\s*([\d.]+)px/.exec(pill.attributes('style') ?? '')?.[1]))
      .sort((left, right) => left - right)
    for (let index = 1; index < xs.length; index += 1) {
      // 间距至少一个胶囊宽度，横排的胶囊才不会叠在一起
      expect(xs[index] - xs[index - 1]).toBeGreaterThanOrEqual(128)
    }
  })
})

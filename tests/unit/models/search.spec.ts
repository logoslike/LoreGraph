import { describe, expect, it } from 'vitest'
import { searchNodes, visibleNodes } from '@/services/search'
import type { LoreNode } from '@/models/node'
import { makeNode } from './fixtures'

function nodes(...names: string[]): LoreNode[] {
  return names.map((name, index) =>
    makeNode({
      id: `node-${index + 1}`,
      name,
      // 名称匹配用例不引入描述干扰；描述匹配由下面的专门用例覆盖
      description: '',
      type: index % 2 === 0 ? 'character' : 'location',
    }),
  )
}

describe('searchNodes 节点搜索', () => {
  it('大小写不敏感：查询 lin 可以命中 Lin', () => {
    const list = nodes('Lin', '林澈')
    expect(searchNodes(list, 'lin').map((node) => node.name)).toEqual(['Lin'])
    expect(searchNodes(list, 'LIN').map((node) => node.name)).toEqual(['Lin'])
  })

  it('支持中文子串匹配', () => {
    const list = nodes('澜舟', '墨鸦', '潮汐教团')
    expect(searchNodes(list, '潮汐').map((node) => node.name)).toEqual(['潮汐教团'])
    expect(searchNodes(list, '舟').map((node) => node.name)).toEqual(['澜舟'])
    expect(searchNodes(list, '不存在')).toEqual([])
  })

  it('名称未命中时继续匹配描述关键词', () => {
    const list = [
      makeNode({ id: 'n1', name: '澜舟', description: '潮汐教团的引路人。' }),
      makeNode({ id: 'n2', name: '墨鸦', description: '沉钟湾的守望者。' }),
      makeNode({ id: 'n3', name: '沉钟湾', description: '' }),
    ]

    expect(searchNodes(list, '潮汐').map((node) => node.name)).toEqual(['澜舟'])
    expect(searchNodes(list, '守望').map((node) => node.name)).toEqual(['墨鸦'])
    // 名称与描述都命中时只返回一次，且保持原有顺序
    expect(searchNodes(list, '沉钟').map((node) => node.name)).toEqual(['墨鸦', '沉钟湾'])
    expect(searchNodes(list, '潮汐教团').map((node) => node.name)).toEqual(['澜舟'])
  })

  it('描述匹配同样不区分大小写', () => {
    const list = [makeNode({ id: 'n1', name: 'Ember', description: 'Keeper of the Tide' })]
    expect(searchNodes(list, 'keeper').map((node) => node.name)).toEqual(['Ember'])
    expect(searchNodes(list, 'TIDE').map((node) => node.name)).toEqual(['Ember'])
  })

  it('查询词前后空白会被 trim', () => {
    const list = nodes('澜舟', '墨鸦')
    expect(searchNodes(list, '  澜舟  ').map((node) => node.name)).toEqual(['澜舟'])
    expect(searchNodes(list, '  ').map((node) => node.name)).toEqual(['澜舟', '墨鸦'])
  })

  it('空查询返回全部节点，且返回新数组', () => {
    const list = nodes('澜舟', '墨鸦')
    const result = searchNodes(list, '')
    expect(result).toHaveLength(2)
    expect(result).not.toBe(list)
    result.pop()
    expect(list).toHaveLength(2)
  })

  it('不会修改输入数组与节点顺序', () => {
    const list = nodes('墨鸦', '澜舟')
    const snapshot = list.map((node) => node.name)
    searchNodes(list, '澜')
    expect(list.map((node) => node.name)).toEqual(snapshot)
  })
})

describe('visibleNodes 类型与搜索组合过滤', () => {
  it('不传选项时返回全部节点副本', () => {
    const list = nodes('澜舟', '沉钟湾', '墨鸦')
    const result = visibleNodes(list)
    expect(result).toHaveLength(3)
    expect(result).not.toBe(list)
  })

  it('先按类型过滤再按搜索词过滤', () => {
    const list = nodes('澜舟', '沉钟湾', '墨鸦')
    expect(visibleNodes(list, { activeTypeKeys: ['location'] }).map((node) => node.name)).toEqual([
      '沉钟湾',
    ])
    // 澜舟 / 墨鸦 是 character，沉钟湾是 location：类型过滤在搜索之前生效
    expect(
      visibleNodes(list, { activeTypeKeys: ['location'], searchQuery: '澜' }).map(
        (node) => node.name,
      ),
    ).toEqual([])
    expect(
      visibleNodes(list, { activeTypeKeys: ['character'], searchQuery: '墨' }).map(
        (node) => node.name,
      ),
    ).toEqual(['墨鸦'])
    expect(
      visibleNodes(list, { activeTypeKeys: ['character'], searchQuery: '澜' }).map(
        (node) => node.name,
      ),
    ).toEqual(['澜舟'])
  })

  it('空类型数组表示不过滤', () => {
    const list = nodes('澜舟', '沉钟湾')
    expect(visibleNodes(list, { activeTypeKeys: [], searchQuery: '沉' })).toHaveLength(1)
  })
})

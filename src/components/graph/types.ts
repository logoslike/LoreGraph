/** 传给自定义节点组件的业务数据（由 GraphCanvas 从 store 映射而来）。 */
export interface LoreNodeData {
  /** 节点名称。 */
  name: string
  /** 类型显示名（如「人物」）。 */
  typeLabel: string
  /** 类型颜色，用于色条与图标。 */
  color: string
  /** 类型图标名（models/icons 白名单）。 */
  iconName?: string
  /** 是否在 store 中选中（单一事实来源，不依赖 Vue Flow 内部选中态）。 */
  isSelected: boolean
  /** 是否命中当前搜索词。 */
  isMatch: boolean
  /** 是否因相邻高亮而变淡（有选中且不在 1 跳邻域内）。 */
  isDimmed: boolean
}

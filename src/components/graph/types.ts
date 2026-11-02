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
  /** 是否属于当前选中项的 1 跳邻域（不含选中项本身）。 */
  isNeighbor: boolean
  /** 是否命中当前搜索词。 */
  isMatch: boolean
  /** 是否因相邻高亮而变淡（有选中且不在 1 跳邻域内）。 */
  isDimmed: boolean
  /** 是否已收起它沿出边可达的下级节点。 */
  isCollapsed: boolean
  /** 被这个节点收起的下级节点数量，用于折叠态徽标。 */
  hiddenCount: number
  /** 是否存在沿出边可达的下级节点；为 false 时不渲染折叠按钮。 */
  hasChildren: boolean
  /** 切换折叠状态；具体状态与持久化由 GraphCanvas 负责。 */
  onToggleCollapse?: () => void
}

/** 传给自定义关系组件的业务数据。 */
export interface LoreEdgeData {
  /** 同一对节点之间的车道：0 表示唯一关系（使用连续平滑样条），正负表示绕到下方/上方分道。 */
  lane: number
}

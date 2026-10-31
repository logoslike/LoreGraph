/** 领域错误基类，便于上层统一识别。 */
export class LoreGraphError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LoreGraphError'
  }
}

/** 删除类型时仍有节点/关系引用它。 */
export class TypeInUseError extends LoreGraphError {
  /** 引用该类型的节点或关系数量。 */
  readonly count: number
  readonly typeKey: string

  constructor(typeKey: string, count: number) {
    super(`类型「${typeKey}」已被 ${count} 处引用，无法删除`)
    this.name = 'TypeInUseError'
    this.typeKey = typeKey
    this.count = count
  }
}

/** 图结构非法（自连、重复边、端点缺失等）。 */
export class GraphError extends LoreGraphError {
  constructor(message: string) {
    super(message)
    this.name = 'GraphError'
  }
}

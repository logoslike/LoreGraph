import { customAlphabet } from 'nanoid'

/** 仅使用大小写字母与数字，避免 id 中出现 - 与 _ 带来的歧义。 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const ID_LENGTH = 12
const generateId = customAlphabet(ALPHABET, ID_LENGTH)

/** 生成 12 位短 id（A-Za-z0-9）。 */
export function newId(): string {
  return generateId()
}

/** 统一的时间戳来源，便于测试中对时间打桩。 */
export function now(): number {
  return Date.now()
}

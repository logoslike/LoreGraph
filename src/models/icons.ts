import type { Component } from 'vue'
import {
  Book,
  Building2,
  CalendarClock,
  Castle,
  Compass,
  Crown,
  Flag,
  Flame,
  Gem,
  Globe,
  Heart,
  Key,
  Landmark,
  Lightbulb,
  MapPin,
  Moon,
  Mountain,
  Package,
  Scroll,
  Ship,
  Shield,
  Skull,
  Sparkles,
  Star,
  Sun,
  Sword,
  TreePine,
  UserRound,
  Users,
  Wand,
} from '@lucide/vue'

/** 节点/类型可选的图标白名单（精选自 lucide）。 */
export const LUCIDE_ICONS: Record<string, Component> = {
  'user-round': UserRound,
  users: Users,
  'map-pin': MapPin,
  'calendar-clock': CalendarClock,
  package: Package,
  lightbulb: Lightbulb,
  crown: Crown,
  sword: Sword,
  shield: Shield,
  book: Book,
  scroll: Scroll,
  globe: Globe,
  flame: Flame,
  sparkles: Sparkles,
  castle: Castle,
  'building-2': Building2,
  landmark: Landmark,
  mountain: Mountain,
  tree: TreePine,
  moon: Moon,
  sun: Sun,
  star: Star,
  heart: Heart,
  skull: Skull,
  wand: Wand,
  gem: Gem,
  key: Key,
  compass: Compass,
  flag: Flag,
  ship: Ship,
}

/** 未指定图标时使用的默认图标名。 */
export const DEFAULT_NODE_ICON = 'lightbulb'

/** 按图标名取组件，未知名称回退到默认图标。 */
export function getIconComponent(name?: string): Component {
  if (name && LUCIDE_ICONS[name]) {
    return LUCIDE_ICONS[name]
  }
  return LUCIDE_ICONS[DEFAULT_NODE_ICON]
}

/**
 * Relationship stage display configuration.
 *
 * Shared between server components (data.ts, memory-data.ts) and client
 * components (character-status.tsx, character profile page). Kept in its
 * own file so client bundles don't pull in better-sqlite3.
 */

export type RelationshipStage =
  | 'stranger'
  | 'acquaintance'
  | 'friend'
  | 'close_friend'
  | 'intimate'

export interface StageDisplayConfig {
  label: string
  badgeColor: string
  textColor: string
}

export const STAGE_DISPLAY: Record<RelationshipStage, StageDisplayConfig> = {
  stranger:     { label: 'Stranger',     badgeColor: 'bg-zinc-600',    textColor: 'text-zinc-400' },
  acquaintance: { label: 'Acquaintance', badgeColor: 'bg-blue-600',    textColor: 'text-blue-400' },
  friend:       { label: 'Friend',       badgeColor: 'bg-emerald-600', textColor: 'text-emerald-400' },
  close_friend: { label: 'Close Friend', badgeColor: 'bg-purple-600',  textColor: 'text-purple-400' },
  intimate:     { label: 'Intimate',     badgeColor: 'bg-pink-600',    textColor: 'text-pink-400' },
}

export const STAGE_ORDER: RelationshipStage[] = [
  'stranger',
  'acquaintance',
  'friend',
  'close_friend',
  'intimate',
]

export const STAGE_THRESHOLDS: Record<RelationshipStage, number> = {
  stranger: 0,
  acquaintance: 0.15,
  friend: 0.35,
  close_friend: 0.6,
  intimate: 0.85,
}

export const STAGE_LABELS: Record<RelationshipStage, string> = {
  stranger: 'Stranger',
  acquaintance: 'Acquaintance',
  friend: 'Friend',
  close_friend: 'Close Friend',
  intimate: 'Intimate',
}

/** Get display config for any stage value, with fallback for unknown stages. */
export function getStageDisplay(stage: string | null): StageDisplayConfig {
  if (!stage) return STAGE_DISPLAY.stranger
  if (stage in STAGE_DISPLAY) return STAGE_DISPLAY[stage as RelationshipStage]
  // Unknown/custom stage: title-case the value, use neutral styling
  const label = stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return { label, badgeColor: 'bg-zinc-600', textColor: 'text-zinc-400' }
}

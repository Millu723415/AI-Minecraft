/** Status effects of the 2011 potion system. */

export const Effect = {
  SPEED: 1,
  SLOWNESS: 2,
  STRENGTH: 5,
  INSTANT_HEALTH: 6,
  INSTANT_DAMAGE: 7,
  REGENERATION: 10,
  FIRE_RESISTANCE: 12,
  HUNGER: 17,
  WEAKNESS: 18,
  POISON: 19,
} as const;

export interface ActiveEffect {
  id: number;
  amplifier: number;
  /** Remaining ticks. */
  duration: number;
}

export const EFFECT_NAMES: Record<number, string> = {
  1: 'Speed', 2: 'Slowness', 5: 'Strength', 6: 'Instant Health', 7: 'Instant Damage',
  10: 'Regeneration', 12: 'Fire Resistance', 17: 'Hunger', 18: 'Weakness', 19: 'Poison',
};

export const EFFECT_COLORS: Record<number, string> = {
  1: '#7cafc6', 2: '#5a6c81', 5: '#932423', 6: '#f82423', 7: '#430a09',
  10: '#cd5cab', 12: '#e49a3a', 17: '#587653', 18: '#484d48', 19: '#4e9331',
};

export const BAD_EFFECTS = new Set<number>([Effect.SLOWNESS, Effect.INSTANT_DAMAGE, Effect.HUNGER, Effect.WEAKNESS, Effect.POISON]);

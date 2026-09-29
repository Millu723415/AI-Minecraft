/** Damage sources. */

import type { Entity } from './entity';

export type DamageType =
  | 'generic' | 'mob' | 'player' | 'arrow' | 'fireball' | 'fall' | 'lava' | 'fire' | 'onFire'
  | 'drown' | 'explosion' | 'cactus' | 'suffocation' | 'starve' | 'magic' | 'void' | 'thorns';

export interface DamageSource {
  type: DamageType;
  /** The entity responsible (mob, player, shooter). */
  attacker?: Entity | null;
  /** The projectile that hit, if any. */
  projectile?: Entity | null;
  /** Armor does not reduce this damage. */
  bypassArmor?: boolean;
  isFire?: boolean;
  isExplosion?: boolean;
}

export const DAMAGE: Record<string, DamageSource> = {
  fall: { type: 'fall', bypassArmor: true },
  lava: { type: 'lava', isFire: true },
  fire: { type: 'fire', isFire: true },
  onFire: { type: 'onFire', isFire: true, bypassArmor: true },
  drown: { type: 'drown', bypassArmor: true },
  cactus: { type: 'cactus' },
  suffocation: { type: 'suffocation', bypassArmor: true },
  starve: { type: 'starve', bypassArmor: true },
  void: { type: 'void', bypassArmor: true },
  magic: { type: 'magic', bypassArmor: true },
  generic: { type: 'generic', bypassArmor: true },
};

/** Death messages for the death screen (original wording). */
export function deathMessage(name: string, src: DamageSource): string {
  const who = src.attacker ? (src.attacker as { displayName?: string }).displayName ?? 'something' : '';
  switch (src.type) {
    case 'fall': return `${name} hit the ground too hard`;
    case 'lava': return `${name} tried to swim in lava`;
    case 'fire': return `${name} went up in flames`;
    case 'onFire': return `${name} burned to death`;
    case 'drown': return `${name} drowned`;
    case 'cactus': return `${name} was pricked to death`;
    case 'suffocation': return `${name} suffocated in a wall`;
    case 'starve': return `${name} starved to death`;
    case 'void': return `${name} fell out of the world`;
    case 'magic': return `${name} was killed by magic`;
    case 'explosion': return who ? `${name} was blown up by ${who}` : `${name} blew up`;
    case 'arrow': return `${name} was shot by ${who || 'an arrow'}`;
    case 'fireball': return `${name} was fireballed by ${who || 'a fireball'}`;
    case 'mob':
    case 'player': return `${name} was slain by ${who}`;
    default: return `${name} died`;
  }
}

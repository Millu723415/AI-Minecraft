import { describe, expect, it } from 'vitest';
import { MODEL_DEFS } from '../src/render/mobmodels';
import type { Entity } from '../src/entity/entity';

describe('mob models', () => {
  const fakeEntity = { type: 'x', age: 0, sheared: false, size: 2 } as unknown as Entity;
  for (const [type, make] of Object.entries(MODEL_DEFS)) {
    it(`${type}: every box UV region lies inside its skin`, () => {
      const def = make(fakeEntity);
      for (const part of def.parts) {
        for (const b of part.boxes) {
          const right = b.u + 2 * b.d + 2 * b.w;
          const bottom = b.v + b.d + b.h;
          expect(right, `${type}.${part.name} u-extent`).toBeLessThanOrEqual(def.texW);
          expect(bottom, `${type}.${part.name} v-extent`).toBeLessThanOrEqual(def.texH);
        }
      }
    });
  }
});

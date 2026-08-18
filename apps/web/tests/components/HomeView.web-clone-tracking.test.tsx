import { describe, expect, it } from 'vitest';

import {
  CREATE_RAIL_ORDER,
  HOME_HERO_CHIPS,
  findChip,
  orderedCreateChips,
} from '../../src/components/home-hero/chips';

describe('retired Website-clone create option', () => {
  it('is absent from every Home creation catalog surface', () => {
    expect(findChip('web-clone')).toBeUndefined();
    expect(HOME_HERO_CHIPS.map((chip) => chip.id)).not.toContain('web-clone');
    expect(CREATE_RAIL_ORDER).not.toContain('web-clone');
    expect(orderedCreateChips().map((chip) => chip.id)).not.toContain('web-clone');
  });
});

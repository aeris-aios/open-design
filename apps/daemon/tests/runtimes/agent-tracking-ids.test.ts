import { describe, expect, it } from 'vitest';
import { agentIdToTracking } from '@open-design/contracts/analytics';
import { AGENT_DEFS } from '../../src/runtimes/registry.js';

// `other` is the honest answer for an agent id analytics has never heard of.
// It is the wrong answer for one we ship: an agent that lands there is invisible
// to any breakdown or alert asking *which* CLI failed, which is the only
// question worth asking when a CLI someone installed cannot be used. Adding a
// runtime def without teaching the tracking enum about it fails here.
describe('every shipped agent has its own analytics id', () => {
  it('maps no registered agent to the catch-all bucket', () => {
    const collapsed = AGENT_DEFS.map((def) => def.id)
      .filter((id) => agentIdToTracking(id) === 'other')
      .sort();

    expect(collapsed).toEqual([]);
  });

  it('still buckets an unknown id as other', () => {
    expect(agentIdToTracking('not-a-shipped-agent')).toBe('other');
    expect(agentIdToTracking(null)).toBe('other');
  });
});

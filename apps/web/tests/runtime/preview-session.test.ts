import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_RUNTIME_PROTOCOL_VERSION } from '@open-design/contracts/runtime/preview-runtime';
import { PreviewSession, type PreviewSessionDocument } from '../../src/runtime/preview-session';

function document(version: string): PreviewSessionDocument {
  return {
    sessionId: 'session-1',
    documentVersion: version,
    url: `http://n-session.localhost/index.html?v=${version}`,
    target: { postMessage: vi.fn() },
  };
}

function event(
  document: PreviewSessionDocument,
  type: 'od:preview:hello' | 'od:preview:ready' | 'od:preview:visible-paint',
  overrides: Record<string, unknown> = {},
) {
  return {
    source: document.target,
    data: {
      type,
      protocolVersion: PREVIEW_RUNTIME_PROTOCOL_VERSION,
      sessionId: document.sessionId,
      documentVersion: document.documentVersion,
      ...(type === 'od:preview:hello' ? { availableCapabilities: ['scroll', 'edit'] } : {}),
      ...overrides,
    },
  };
}

describe('PreviewSession', () => {
  it('promotes the first document only after its exact visible-paint signal', () => {
    const promoted = vi.fn();
    const session = new PreviewSession({ callbacks: { onPromoted: promoted } });
    const first = document('v1');

    session.stageDocument(first);
    session.handleMessage(event(first, 'od:preview:ready'));
    expect(session.snapshot()).toMatchObject({ current: null, standbyReady: true });

    session.handleMessage(event(first, 'od:preview:visible-paint'));
    expect(session.snapshot()).toMatchObject({
      current: { sessionId: 'session-1', documentVersion: 'v1' },
      standby: null,
    });
    expect(promoted).toHaveBeenCalledWith(first, null);
  });

  it('retains last-good until a replacement visibly paints', () => {
    const promoted = vi.fn();
    const session = new PreviewSession({ callbacks: { onPromoted: promoted } });
    const first = document('v1');
    const second = document('v2');

    session.stageDocument(first);
    session.handleMessage(event(first, 'od:preview:visible-paint'));
    session.stageDocument(second);
    session.handleMessage(event(second, 'od:preview:ready'));

    expect(session.snapshot()).toMatchObject({
      current: { documentVersion: 'v1' },
      standby: { documentVersion: 'v2' },
      standbyReady: true,
    });

    session.handleMessage(event(second, 'od:preview:visible-paint'));
    expect(session.snapshot()).toMatchObject({ current: { documentVersion: 'v2' }, standby: null });
    expect(promoted).toHaveBeenLastCalledWith(second, first);
  });

  it('discards a failed standby without disturbing last-good', () => {
    const discarded = vi.fn();
    const session = new PreviewSession({ callbacks: { onStandbyDiscarded: discarded } });
    const first = document('v1');
    const second = document('v2');

    session.stageDocument(first);
    session.handleMessage(event(first, 'od:preview:visible-paint'));
    session.stageDocument(second);
    session.discardStandby(second);

    expect(session.snapshot()).toMatchObject({ current: { documentVersion: 'v1' }, standby: null });
    expect(discarded).toHaveBeenCalledWith(second);
  });

  it('rejects stale identities and foreign windows', () => {
    const session = new PreviewSession();
    const first = document('v1');
    session.stageDocument(first);

    session.handleMessage(event(first, 'od:preview:visible-paint', { documentVersion: 'stale' }));
    session.handleMessage({ ...event(first, 'od:preview:visible-paint'), source: {} });

    expect(session.snapshot().current).toBeNull();
    expect(session.snapshot().standby?.documentVersion).toBe('v1');
  });

  it('negotiates desired capabilities for standby and current documents', () => {
    const session = new PreviewSession({ enabledCapabilities: ['edit'] });
    const first = document('v1');
    session.stageDocument(first);
    session.handleMessage(event(first, 'od:preview:hello'));

    expect(first.target.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'od:preview:set-capabilities',
      enabledCapabilities: ['edit'],
    }), '*');

    session.handleMessage(event(first, 'od:preview:visible-paint'));
    session.setEnabledCapabilities(['scroll']);
    expect(first.target.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      enabledCapabilities: ['scroll'],
    }), '*');
  });

  it('suspends and resumes without messaging or replacing the document', () => {
    const snapshots = vi.fn();
    const session = new PreviewSession({ callbacks: { onSnapshotChanged: snapshots } });
    const first = document('v1');
    session.stageDocument(first);
    session.handleMessage(event(first, 'od:preview:visible-paint'));
    const callsBeforeSuspend = vi.mocked(first.target.postMessage).mock.calls.length;

    session.setSuspended(true);
    session.setSuspended(false);

    expect(session.snapshot()).toMatchObject({ current: { documentVersion: 'v1' }, suspended: false });
    expect(first.target.postMessage).toHaveBeenCalledTimes(callsBeforeSuspend);
    expect(snapshots).toHaveBeenCalled();
  });
});

/**
 * Prototype-path review demo (`/prototype-demo`).
 *
 * A clickable proposal for the end-to-end prototype journey, covering the
 * three segments the current product spreads thin:
 *
 *   1. Entry — today "I want a prototype" is split across a home chip, the new
 *      project modal, and its prototype tab, and the platform / fidelity /
 *      starting-point choices sit behind different surfaces. Here they collapse
 *      into one panel that also captures the flow the user cares about.
 *   2. Before generating — today a brief goes straight into a run and the user
 *      only learns what got built after paying for it. Here the brief first
 *      produces a SCREEN MAP: the screens, what each is for, and how they link.
 *      It is editable and cheap, and generation starts only once it is agreed.
 *   3. Preview & iterate — today a multi-screen prototype is one artifact with
 *      one preview and one "change it" box, so any tweak re-runs everything.
 *      Here each screen has its own status and its own iteration box, and the
 *      preview walks the real links between screens.
 *
 * MOCK ONLY. No daemon calls, no runs, no files — every transition below is a
 * setTimeout over fixture data (see `prototype-demo-data.ts`). The point is to
 * settle the shape of the flow before anything is built for real.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { MockScreen } from './MockScreen';
import {
  BRIEF_PRESETS,
  DEFAULT_BRIEF_PRESET,
  DEVICE_FRAMES,
  FIDELITY_LABELS,
  iterationReply,
  PLATFORM_LABELS,
  STARTING_POINT_LABELS,
  SUGGESTED_EXTRA_SCREENS,
  type DemoFidelity,
  type DemoPlatform,
  type DemoScreen,
  type DemoStartingPoint,
} from './prototype-demo-data';
import styles from './PrototypePathDemoView.module.css';

type Step = 'start' | 'map' | 'preview';

const STEPS: Array<{ id: Step; label: string; caption: string }> = [
  { id: 'start', label: 'Start', caption: 'One panel, every prototype choice' },
  { id: 'map', label: 'Screen map', caption: 'Agree the structure before spending a run' },
  { id: 'preview', label: 'Preview & iterate', caption: 'Per screen, not per artifact' },
];

const PLATFORMS: DemoPlatform[] = ['web', 'mobile', 'desktop'];
const FIDELITIES: DemoFidelity[] = ['wireframe', 'high'];
const STARTING_POINTS: DemoStartingPoint[] = ['blank', 'reference', 'url', 'design-system'];

interface IterationEntry {
  id: string;
  screenName: string;
  request: string;
  reply: string;
}

/**
 * Staggered fake generation. Each screen flips queued → generating → ready on
 * its own clock so the preview step can show per-screen progress instead of one
 * opaque spinner — which is the part of the proposal that makes per-screen
 * iteration believable later.
 */
function generationSchedule(count: number): Array<{ index: number; at: number; to: 'generating' | 'ready' }> {
  const events: Array<{ index: number; at: number; to: 'generating' | 'ready' }> = [];
  for (let i = 0; i < count; i += 1) {
    events.push({ index: i, at: 250 + i * 420, to: 'generating' });
    events.push({ index: i, at: 250 + i * 420 + 900, to: 'ready' });
  }
  return events;
}

export function PrototypePathDemoView() {
  const [step, setStep] = useState<Step>('start');

  // --- step 1 state -------------------------------------------------------
  const [presetId, setPresetId] = useState(DEFAULT_BRIEF_PRESET.id);
  const preset = useMemo(
    () => BRIEF_PRESETS.find((p) => p.id === presetId) ?? DEFAULT_BRIEF_PRESET,
    [presetId],
  );
  const [brief, setBrief] = useState(DEFAULT_BRIEF_PRESET.brief);
  const [platform, setPlatform] = useState<DemoPlatform>(DEFAULT_BRIEF_PRESET.platform);
  const [fidelity, setFidelity] = useState<DemoFidelity>('high');
  const [startingPoint, setStartingPoint] = useState<DemoStartingPoint>('blank');

  // --- step 2 / 3 state ---------------------------------------------------
  const [screens, setScreens] = useState<DemoScreen[]>([]);
  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);
  const [showHotspots, setShowHotspots] = useState(true);
  const [iterationInput, setIterationInput] = useState('');
  const [iterations, setIterations] = useState<IterationEntry[]>([]);
  const [mapping, setMapping] = useState(false);

  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const activeScreen = useMemo(
    () => screens.find((s) => s.id === activeScreenId) ?? screens[0] ?? null,
    [screens, activeScreenId],
  );

  const readyCount = screens.filter((s) => s.status === 'ready').length;
  const busy = screens.some((s) => s.status === 'generating' || s.status === 'queued');

  function selectPreset(id: string) {
    const next = BRIEF_PRESETS.find((p) => p.id === id);
    if (!next) return;
    setPresetId(id);
    setBrief(next.brief);
    setPlatform(next.platform);
  }

  /**
   * Step 1 → 2. The proposal's core claim is that the map arrives fast and
   * cheap (structure only, no artifact), so the demo shows a short think, not
   * a run-length wait.
   */
  function drawScreenMap() {
    clearTimers();
    setMapping(true);
    setStep('map');
    const id = window.setTimeout(() => {
      setScreens(preset.screens.map((s) => ({ ...s, status: 'queued' })));
      setMapping(false);
    }, 700);
    timers.current.push(id);
  }

  function addScreen(templateId: string) {
    const template = SUGGESTED_EXTRA_SCREENS.find((s) => s.id === templateId);
    if (!template) return;
    setScreens((prev) => {
      if (prev.some((s) => s.id === template.id)) return prev;
      const back = prev[0]?.id;
      return [
        ...prev,
        {
          ...template,
          hotspots: back ? [{ label: 'Back', to: back }] : [],
          status: 'queued',
        },
      ];
    });
  }

  function removeScreen(id: string) {
    setScreens((prev) => {
      const next = prev.filter((s) => s.id !== id);
      // Drop links that would now dead-end — a map that promises a jump the
      // prototype cannot make is exactly the confusion this step removes.
      return next.map((s) => ({ ...s, hotspots: s.hotspots.filter((h) => h.to !== id) }));
    });
  }

  function renameScreen(id: string, name: string) {
    setScreens((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }

  /** Step 2 → 3. Generation is per screen, and the UI says so while it runs. */
  function generate() {
    clearTimers();
    setStep('preview');
    setActiveScreenId(screens[0]?.id ?? null);
    setScreens((prev) => prev.map((s) => ({ ...s, status: 'queued' })));
    generationSchedule(screens.length).forEach((event) => {
      const id = window.setTimeout(() => {
        setScreens((prev) =>
          prev.map((s, i) => (i === event.index ? { ...s, status: event.to } : s)),
        );
      }, event.at);
      timers.current.push(id);
    });
  }

  /** Step 3. Re-runs exactly one screen and says which one, out loud. */
  function applyIteration() {
    const target = activeScreen;
    const request = iterationInput.trim();
    if (!target || !request) return;
    setIterationInput('');
    setScreens((prev) => prev.map((s) => (s.id === target.id ? { ...s, status: 'generating' } : s)));
    const reply = iterationReply(iterations.length);
    const id = window.setTimeout(() => {
      setScreens((prev) => prev.map((s) => (s.id === target.id ? { ...s, status: 'ready' } : s)));
      setIterations((prev) => [
        { id: `${Date.now()}`, screenName: target.name, request, reply },
        ...prev,
      ]);
    }, 1100);
    timers.current.push(id);
  }

  function restart() {
    clearTimers();
    setScreens([]);
    setIterations([]);
    setIterationInput('');
    setActiveScreenId(null);
    setStep('start');
  }

  const frame = DEVICE_FRAMES[platform];

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Prototype path</h1>
          <p className={styles.subtitle}>
            A proposed end-to-end journey for the prototype scenario: entry → screen map →
            per-screen preview and iteration.
          </p>
        </div>
        <button type="button" className={styles.ghostButton} onClick={restart}>
          <Icon name="reload" size={14} />
          Restart
        </button>
      </header>

      <p className={styles.banner}>
        <Icon name="info" size={14} />
        Review demo — every screen, status, and reply below is fixture data. Nothing here starts a
        run or writes a file.
      </p>

      <ol className={styles.stepRail}>
        {STEPS.map((s, i) => {
          const index = STEPS.findIndex((x) => x.id === step);
          const state = i < index ? 'done' : i === index ? 'current' : 'todo';
          return (
            <li key={s.id} className={`${styles.stepItem} ${styles[`step_${state}`]}`}>
              <span className={styles.stepBadge}>{state === 'done' ? <Icon name="check" size={12} /> : i + 1}</span>
              <span className={styles.stepLabels}>
                <span className={styles.stepLabel}>{s.label}</span>
                <span className={styles.stepCaption}>{s.caption}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {step === 'start' ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>What are you prototyping?</h2>
            <p className={styles.panelHint}>
              Today these choices are split across the home chip, the new-project modal, and its
              prototype tab. One panel, asked once.
            </p>
          </div>

          <label className={styles.fieldLabel} htmlFor="prototype-demo-brief">
            Brief
          </label>
          <textarea
            id="prototype-demo-brief"
            className={styles.textarea}
            value={brief}
            rows={3}
            onChange={(e) => setBrief(e.target.value)}
          />

          <div className={styles.presetRow}>
            <span className={styles.fieldLabel}>Try one</span>
            {BRIEF_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`${styles.chip} ${p.id === presetId ? styles.chipActive : ''}`}
                onClick={() => selectPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className={styles.optionGrid}>
            <div className={styles.optionGroup}>
              <span className={styles.fieldLabel}>Platform</span>
              <div className={styles.chipRow}>
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`${styles.chip} ${p === platform ? styles.chipActive : ''}`}
                    onClick={() => setPlatform(p)}
                  >
                    {PLATFORM_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.optionGroup}>
              <span className={styles.fieldLabel}>Fidelity</span>
              <div className={styles.chipRow}>
                {FIDELITIES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`${styles.chip} ${f === fidelity ? styles.chipActive : ''}`}
                    onClick={() => setFidelity(f)}
                  >
                    {FIDELITY_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.optionGroup}>
              <span className={styles.fieldLabel}>Starting point</span>
              <div className={styles.chipRow}>
                {STARTING_POINTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`${styles.chip} ${s === startingPoint ? styles.chipActive : ''}`}
                    onClick={() => setStartingPoint(s)}
                  >
                    {STARTING_POINT_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.panelFoot}>
            <span className={styles.footNote}>
              Next step is free: you will see the screen list before any generation starts.
            </span>
            <button type="button" className={styles.primaryButton} onClick={drawScreenMap}>
              Draw the screen map
              <Icon name="arrow-right" size={14} />
            </button>
          </div>
        </section>
      ) : null}

      {step === 'map' ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Screen map</h2>
            <p className={styles.panelHint}>
              Structure only — nothing has been generated yet. Cut what you do not need and add
              what is missing; this is the cheapest place to be wrong.
            </p>
          </div>

          {mapping ? (
            <div className={styles.mappingState}>
              <Icon name="spinner" size={16} className={styles.spin} />
              Reading the brief and proposing screens…
            </div>
          ) : (
            <>
              <div className={styles.mapGrid}>
                {screens.map((screen, i) => (
                  <article key={screen.id} className={styles.mapCard}>
                    <header className={styles.mapCardHead}>
                      <span className={styles.mapIndex}>{i + 1}</span>
                      <input
                        className={styles.mapNameInput}
                        value={screen.name}
                        aria-label={`Screen ${i + 1} name`}
                        onChange={(e) => renameScreen(screen.id, e.target.value)}
                      />
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Remove ${screen.name}`}
                        onClick={() => removeScreen(screen.id)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </header>
                    <p className={styles.mapPurpose}>{screen.purpose}</p>
                    {screen.hotspots.length > 0 ? (
                      <ul className={styles.mapLinks}>
                        {screen.hotspots.map((h) => (
                          <li key={`${h.label}-${h.to}`}>
                            <Icon name="arrow-right" size={12} />
                            {h.label} → {screens.find((s) => s.id === h.to)?.name ?? h.to}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.mapNoLinks}>No outgoing links.</p>
                    )}
                  </article>
                ))}
              </div>

              <div className={styles.addRow}>
                <span className={styles.fieldLabel}>Commonly missed</span>
                {SUGGESTED_EXTRA_SCREENS.map((s) => {
                  const added = screens.some((existing) => existing.id === s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={styles.chip}
                      disabled={added}
                      onClick={() => addScreen(s.id)}
                    >
                      <Icon name={added ? 'check' : 'plus'} size={12} />
                      {s.name}
                    </button>
                  );
                })}
              </div>

              <div className={styles.panelFoot}>
                <span className={styles.footNote}>
                  {screens.length} screens · {PLATFORM_LABELS[platform]} ·{' '}
                  {FIDELITY_LABELS[fidelity]} · {STARTING_POINT_LABELS[startingPoint]}
                </span>
                <div className={styles.footActions}>
                  <button type="button" className={styles.ghostButton} onClick={() => setStep('start')}>
                    <Icon name="arrow-left" size={14} />
                    Back
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={screens.length === 0}
                    onClick={generate}
                  >
                    Generate {screens.length} screens
                    <Icon name="arrow-right" size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      ) : null}

      {step === 'preview' ? (
        <section className={styles.previewPanel}>
          <aside className={styles.screenList}>
            <div className={styles.screenListHead}>
              <span className={styles.fieldLabel}>Screens</span>
              <span className={styles.progressPill}>
                {readyCount}/{screens.length} ready
              </span>
            </div>
            {screens.map((screen) => (
              <button
                key={screen.id}
                type="button"
                className={`${styles.screenRow} ${screen.id === activeScreen?.id ? styles.screenRowActive : ''}`}
                onClick={() => setActiveScreenId(screen.id)}
              >
                <span className={styles.screenRowName}>{screen.name}</span>
                <span className={`${styles.statusDot} ${styles[`status_${screen.status}`]}`} />
              </button>
            ))}
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setStep('map')}
              disabled={busy}
            >
              <Icon name="layout" size={14} />
              Edit the map
            </button>
          </aside>

          <div className={styles.stage}>
            <div className={styles.stageBar}>
              <span className={styles.stageTitle}>
                {activeScreen?.name ?? '—'}
                <span className={styles.stageMeta}>{frame.label}</span>
              </span>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={showHotspots}
                  onChange={(e) => setShowHotspots(e.target.checked)}
                />
                Show links
              </label>
            </div>

            <div className={styles.stageCanvas}>
              <div
                className={styles.deviceFrame}
                style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
                data-platform={platform}
              >
                {activeScreen && activeScreen.status === 'ready' ? (
                  <MockScreen
                    screen={activeScreen}
                    fidelity={fidelity}
                    showHotspots={showHotspots}
                    onFollowHotspot={(id) => setActiveScreenId(id)}
                  />
                ) : (
                  <div className={styles.screenPending}>
                    <Icon
                      name={activeScreen?.status === 'generating' ? 'spinner' : 'layout'}
                      size={18}
                      className={activeScreen?.status === 'generating' ? styles.spin : undefined}
                    />
                    {activeScreen?.status === 'generating'
                      ? `Building ${activeScreen.name}…`
                      : 'Queued — this screen has not been generated yet.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className={styles.iteratePane}>
            <span className={styles.fieldLabel}>Change this screen</span>
            <p className={styles.iterateScope}>
              <Icon name="info" size={12} />
              Applies to <strong>{activeScreen?.name ?? '—'}</strong> only. The other{' '}
              {Math.max(0, screens.length - 1)} screens are not re-run.
            </p>
            <textarea
              className={styles.textarea}
              rows={3}
              placeholder="e.g. move the filters into a left rail and show the status as a coloured pill"
              value={iterationInput}
              onChange={(e) => setIterationInput(e.target.value)}
            />
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!iterationInput.trim() || activeScreen?.status !== 'ready'}
              onClick={applyIteration}
            >
              <Icon name="sparkles" size={14} />
              Apply to this screen
            </button>

            {iterations.length > 0 ? (
              <div className={styles.iterationLog}>
                <span className={styles.fieldLabel}>History</span>
                {iterations.map((entry) => (
                  <div key={entry.id} className={styles.iterationEntry}>
                    <span className={styles.iterationScreen}>{entry.screenName}</span>
                    <p className={styles.iterationRequest}>{entry.request}</p>
                    <p className={styles.iterationReply}>{entry.reply}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </aside>
        </section>
      ) : null}
    </div>
  );
}

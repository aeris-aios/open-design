/**
 * Skeleton renderer for one mocked prototype screen.
 *
 * Paints a `DemoScreen`'s blocks as layout shapes rather than real UI. That is
 * deliberate: the review question is whether the JOURNEY works (map → generate
 * → per-screen iteration), so the screens need to read as plausible app
 * surfaces without anyone maintaining real designs behind the demo.
 *
 * Fidelity changes the paint, not the layout — wireframe stays grey and
 * outlined, high fidelity fills with the app's accent tints — so switching it
 * in step 1 visibly changes the preview later in the flow.
 */

import type { DemoBlock, DemoFidelity, DemoScreen } from './prototype-demo-data';
import styles from './PrototypePathDemoView.module.css';

function repeat(count: number | undefined, fallback: number): number[] {
  const n = Math.max(1, count ?? fallback);
  return Array.from({ length: n }, (_, i) => i);
}

function Block({ block, fidelity }: { block: DemoBlock; fidelity: DemoFidelity }) {
  const tone = fidelity === 'high' ? styles.toneHigh : styles.toneWire;

  switch (block.kind) {
    case 'appbar':
      return (
        <div className={`${styles.mockAppbar} ${tone}`}>
          <span className={styles.mockAppbarTitle}>{block.label ?? ''}</span>
          <span className={styles.mockAppbarDots}>
            <i /><i /><i />
          </span>
        </div>
      );
    case 'hero':
      return (
        <div className={`${styles.mockHero} ${tone}`}>
          <span className={styles.mockHeroTitle}>{block.label ?? ''}</span>
          <span className={styles.mockHeroSub} />
        </div>
      );
    case 'search':
      return <div className={`${styles.mockSearch} ${tone}`} />;
    case 'stat-row':
      return (
        <div className={styles.mockStatRow}>
          {repeat(block.rows, 3).map((i) => (
            <div key={i} className={`${styles.mockStat} ${tone}`}>
              <span className={styles.mockStatValue} />
              <span className={styles.mockStatLabel} />
            </div>
          ))}
        </div>
      );
    case 'list':
      return (
        <div className={styles.mockList}>
          {repeat(block.rows, 4).map((i) => (
            <div key={i} className={`${styles.mockListRow} ${tone}`}>
              <span className={styles.mockAvatar} />
              <span className={styles.mockLines}>
                <i style={{ width: `${72 - (i % 3) * 12}%` }} />
                <i style={{ width: `${44 - (i % 2) * 10}%` }} />
              </span>
            </div>
          ))}
        </div>
      );
    case 'card-grid':
      return (
        <div className={styles.mockGrid}>
          {repeat(block.rows, 4).map((i) => (
            <div key={i} className={`${styles.mockCard} ${tone}`} />
          ))}
        </div>
      );
    case 'table':
      return (
        <div className={`${styles.mockTable} ${tone}`}>
          <div className={styles.mockTableHead}>
            {repeat(4, 4).map((i) => <i key={i} />)}
          </div>
          {repeat(block.rows, 5).map((i) => (
            <div key={i} className={styles.mockTableRow}>
              {repeat(4, 4).map((c) => (
                <i key={c} style={{ width: c === 0 ? '30%' : undefined }} />
              ))}
            </div>
          ))}
        </div>
      );
    case 'chart':
      return (
        <div className={`${styles.mockChart} ${tone}`}>
          {[48, 66, 34, 78, 58, 88, 42].map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
      );
    case 'timeline':
      return (
        <div className={styles.mockTimeline}>
          {repeat(block.rows, 4).map((i) => (
            <div key={i} className={`${styles.mockTimelineStep} ${tone}`}>
              <span className={styles.mockDot} />
              <span className={styles.mockLines}>
                <i style={{ width: `${64 - (i % 3) * 14}%` }} />
              </span>
            </div>
          ))}
        </div>
      );
    case 'form':
      return (
        <div className={styles.mockForm}>
          {repeat(block.rows, 2).map((i) => (
            <div key={i} className={`${styles.mockField} ${tone}`} />
          ))}
        </div>
      );
    case 'cta':
      return (
        <div className={`${styles.mockCta} ${fidelity === 'high' ? styles.mockCtaHigh : ''}`}>
          {block.label ?? ''}
        </div>
      );
    case 'tabbar':
      return (
        <div className={`${styles.mockTabbar} ${tone}`}>
          {repeat(block.rows, 4).map((i) => (
            <span key={i} className={i === 0 ? styles.mockTabActive : undefined} />
          ))}
        </div>
      );
    case 'text':
    default:
      return (
        <div className={styles.mockText}>
          {repeat(block.rows, 2).map((i) => (
            <i key={i} style={{ width: `${88 - i * 18}%` }} />
          ))}
        </div>
      );
  }
}

export function MockScreen({
  screen,
  fidelity,
  showHotspots,
  onFollowHotspot,
}: {
  screen: DemoScreen;
  fidelity: DemoFidelity;
  /** Overlay the clickable regions so the flow is visible, not just walkable. */
  showHotspots: boolean;
  onFollowHotspot: (screenId: string) => void;
}) {
  return (
    <div className={styles.mockScreen}>
      <div className={styles.mockScreenBody}>
        {screen.blocks.map((block, i) => (
          <Block key={`${block.kind}-${i}`} block={block} fidelity={fidelity} />
        ))}
      </div>
      {showHotspots && screen.hotspots.length > 0 ? (
        <div className={styles.hotspotLayer}>
          {screen.hotspots.map((hotspot) => (
            <button
              key={`${hotspot.label}-${hotspot.to}`}
              type="button"
              className={styles.hotspot}
              onClick={() => onFollowHotspot(hotspot.to)}
            >
              {hotspot.label}
              <span aria-hidden="true"> →</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

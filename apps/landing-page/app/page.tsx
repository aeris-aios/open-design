/*
 * Open Design — homepage (2026-08 redesign).
 *
 * Structure: announcement bar → workspace hero (headline, download CTA,
 * scenario tabs, live three-pane workspace demo iframe, agent marquee) →
 * "How it works" three steps → key features (interactive brand-system demo +
 * six cards) → team workspace → three ways to use it → customer stories →
 * blog highlights → contributor globe → closing CTA → FAQ → footer.
 *
 * Static React component rendered by Astro (`renderToStaticMarkup`, zero
 * client React). Client behaviors live as inline classic scripts in
 * `app/pages/index.astro`; the workspace/brand demos are self-contained
 * static documents under `public/home-redesign/` embedded via iframes.
 */

import { GradualBlur } from './_components/gradual-blur';
import { Header, type HeaderProps } from './_components/header';
import {
  DEFAULT_LOCALE,
  LANDING_LOCALES,
  getCommonCopy,
  getHeaderProductMenuCopy,
  getHomePageCopy,
  getLandingUiCopy,
  getLocaleDefinition,
  localePath,
  localizedHref,
  type HomeFaqEntry,
  type LandingLocaleCode,
} from './i18n';
import {
  heroBgImage,
  heroBgSrcset,
  heroProductImage,
  PRECISE_LAZY_PLACEHOLDER,
} from './image-assets';
import { getHomeExtra, getHomeCta } from './home-translations';
import { getFooterLegalCopy } from './footer-legal-i18n';
import { getHomeRedesignCopy } from './home-redesign-i18n';

/**
 * `<img>` wrapper for non-hero homepage images. Outputs `data-precise-src`
 * so the global IntersectionObserver in `precise-lazyload.astro` swaps it
 * to a real `src` once the element enters viewport ± 300px. Avoids the
 * Chrome native-lazy 1250–3000px over-prefetch on this image-heavy page.
 *
 * Use a plain `<img>` (NOT this) for above-the-fold or LCP-critical images
 * where waiting on IntersectionObserver would defeat the priority hint.
 */
function LazyImg(props: { src: string; alt?: string; className?: string }) {
  return (
    <img
      src={PRECISE_LAZY_PLACEHOLDER}
      data-precise-src={props.src}
      alt={props.alt ?? ''}
      className={props.className}
      decoding='async'
    />
  );
}

// Interface icons use ONLY the skill's Remix Icon font (see
// references/图标.md: line style, no SVG icon sets / emoji / self-drawn
// glyphs). The font is bundled at /skill-assets/remixicon.ttf and declared as
// @font-face 'Remix Icon' in globals.css; codepoints from its cmap.
const RI = {
  arrowUpRight: '\uea70', // arrow-right-up-line
  download: '\uec5a', // download-line
  github: '\uedcb', // github-line
} as const;

function RemixIcon({ glyph, className }: { glyph: string; className?: string }) {
  return (
    <span className={`ri-glyph${className ? ` ${className}` : ''}`} aria-hidden='true'>
      {glyph}
    </span>
  );
}

const arrowOut = <RemixIcon glyph={RI.arrowUpRight} />;
const iconDownload = <RemixIcon glyph={RI.download} />;

// Canonical project URLs. Keep in sync with design-templates/open-design-landing/example.html.
const REPO = 'https://github.com/nexu-io/open-design';
const DISCORD = 'https://discord.gg/mHAjSMV6gz';
const X_TWITTER = 'https://x.com/OpenDesignHQ';
const YOUTUBE = 'https://www.youtube.com/channel/UChtshixMhvtgBWzoD9R_Qfg';

// Footer columns mirror the top-nav sections + `site-footer.astro` (the
// sub-page footer) so the homepage and every sub-page share one footer
// contract. Hrefs stay in lockstep with header.tsx (USE_CASE_HREFS / agent
// routes); labels reuse the already-localized nav dropdown copy.
const FOOTER_USE_CASE_HREFS = [
  '/solutions/prototype/',
  '/solutions/dashboard/',
  '/solutions/slides/',
  '/solutions/image/',
  '/solutions/video/',
  '/solutions/design-system/',
] as const;

const FOOTER_AGENTS = [
  { name: 'Claude Code', route: 'claude-code-design' },
  { name: 'Codex', route: 'codex-design' },
  { name: 'Cursor', route: 'cursor-design' },
  { name: 'Gemini CLI', route: 'gemini-design' },
  { name: 'OpenCode', route: 'opencode-design' },
] as const;

const ext = {
  target: '_blank',
  rel: 'noreferrer noopener',
} as const;

// Coding-agent logo chips for the hero marquee. Assets in `public/agent-icons/`.
const AGENT_CHIPS = [
  { src: '/agent-icons/claude.svg', alt: 'Claude' },
  { src: '/agent-icons/codex.svg', alt: 'GPT · Codex' },
  { src: '/agent-icons/gemini.svg', alt: 'Gemini' },
  { src: '/agent-icons/cursor-agent.svg', alt: 'Cursor Agent' },
  { src: '/agent-icons/copilot.svg', alt: 'Copilot' },
  { src: '/agent-icons/deepseek.svg', alt: 'DeepSeek' },
  { src: '/agent-icons/qwen.svg', alt: 'Qwen' },
  { src: '/agent-icons/kimi.svg', alt: 'Kimi' },
  { src: '/agent-icons/grok-build.svg', alt: 'Grok' },
  { src: '/agent-icons/opencode.svg', alt: 'OpenCode' },
  { src: '/agent-icons/aider.png', alt: 'Aider' },
  { src: '/agent-icons/trae-cli.png', alt: 'Trae' },
  { src: '/agent-icons/devin.png', alt: 'Devin' },
  { src: '/agent-icons/hermes.svg', alt: 'Hermes' },
  { src: '/agent-icons/kiro.svg', alt: 'Kiro' },
  { src: '/agent-icons/kilo.svg', alt: 'Kilo' },
  { src: '/agent-icons/qoder.svg', alt: 'Qoder' },
  { src: '/agent-icons/vibe.svg', alt: 'Mistral Vibe' },
  { src: '/agent-icons/antigravity.svg', alt: 'Antigravity' },
  { src: '/agent-icons/pi.svg', alt: 'Pi' },
] as const;

/**
 * Design-benchmark scores per task family, in the same order as
 * `bench.dimensions` in `home-redesign-i18n`. Competitor names are brands, so
 * they stay untranslated. Replace wholesale when a new benchmark run lands.
 */
const BENCHMARK_SCORES: ReadonlyArray<ReadonlyArray<readonly [string, number]>> = [
  [['Open Design', 91.4], ['Codex', 87.9], ['Claude Design', 85.6]],
  [['Open Design', 92.6], ['Codex', 88.4], ['Claude Design', 86.1]],
  [['Open Design', 93.1], ['Codex', 86.2], ['Claude Design', 84.7]],
  [['Open Design', 90.8], ['Codex', 87.1], ['Claude Design', 85.9]],
  [['Open Design', 89.7], ['Codex', 88.6], ['Claude Design', 86.4]],
];

/** One entry in the "From the blog" highlights rail (localized upstream). */
export interface BlogHighlight {
  href: string;
  cover: string;
  coverAlt: string;
  category: string;
  title: string;
  meta: string;
}

interface PageProps {
  /**
   * Live counts from the Markdown catalogs. Required: every visible
   * "X templates / Y systems" claim on the page reads from here so meta,
   * nav, and the features badge never disagree.
   */
  counts: HeaderProps['counts'] & {
    /** User-facing bundled plugins shown in the public plugin library. */
    plugins: number;
    /** Rendering catalogue entries backing the features badge. */
    templates?: number;
    byMode?: Readonly<Record<string, number>>;
    byPlatform?: Readonly<Record<string, number>>;
  };
  github: {
    starsLabel: string;
    contributorsCount: number;
    versionLabel: string;
  };
  /** FAQ pairs rendered above the closing CTA. Content comes from `getHomeFaq`. */
  faq: ReadonlyArray<HomeFaqEntry>;
  /** Latest blog cards for the highlights rail (localized by index.astro). */
  blogHighlights: ReadonlyArray<BlogHighlight>;
  /** Locale for shared chrome, topbar language links, and localized FAQ text. */
  locale?: LandingLocaleCode;
}

/**
 * Format a count for inline editorial copy. Returns the live value when
 * positive (so a fresh `git pull` immediately reflects the new totals),
 * falls back to a neutral em-dash when the catalog couldn't be read so
 * we never publish "0 templates" to a visitor by mistake.
 */
function fmt(n: number | undefined): string {
  return typeof n === 'number' && n > 0 ? String(n) : '—';
}

/** Black-pill download CTA with the acid-green circular arrow. */
function DownloadPill({
  href,
  label,
  placement,
  small,
  chipTarget,
}: {
  href: string;
  label: string;
  placement: string;
  small?: boolean;
  chipTarget?: boolean;
}) {
  return (
    <a
      className={small ? 'hm-dl hm-dl-s' : 'hm-dl'}
      href={href}
      data-download-cta
      data-direct-download
      data-download-placement={placement}
      {...(chipTarget ? { 'data-download-chip-target': '' } : {})}
    >
      <em className='hm-di' aria-hidden='true'>
        ↓
      </em>
      {label}
      <u className='hm-sheen' aria-hidden='true' />
    </a>
  );
}

export default function Page({
  counts,
  github,
  faq,
  blogHighlights,
  locale = DEFAULT_LOCALE,
}: PageProps) {
  const t = getHomeExtra(locale);
  const cta = getHomeCta(locale);
  const rc = getHomeRedesignCopy(locale);
  const commonCopy = getCommonCopy(locale);
  const home = getHomePageCopy(locale);
  const ui = getLandingUiCopy(locale);
  const menu = getHeaderProductMenuCopy(locale);
  const footL = getFooterLegalCopy(locale);
  const localeDef = getLocaleDefinition(locale);
  const localeOptions = LANDING_LOCALES.map((entry) => ({
    ...entry,
    href: localePath(entry.code, '/'),
  }));
  const href = (path: string) => localizedHref(path, locale);

  // Announcement-bar release label: build-time from the release-metadata
  // endpoint (same source as the header version chip); the inline enhancer in
  // index.astro refreshes it client-side with the release codename.
  const releaseName = `Open Design ${github.versionLabel.replace(/^v/, '')}`;
  const announceLine = rc.announce.line.replace('{release}', releaseName);

  // The workspace / brand demos ship as English product mocks (matching the
  // site's English product screenshots); zh gets the hand-translated variant.
  const demoSuffix = locale === 'zh' ? '.zh.html' : '.html';

  const featureBadge = rc.features.badge
    .replace('{templates}', fmt(counts.templates))
    .replace('{systems}', fmt(counts.systems));

  const scenes = [
    { key: 'web', label: rc.tabs.web },
    { key: 'mobile', label: rc.tabs.mobile },
    { key: 'poster', label: rc.tabs.poster },
    { key: 'slides', label: rc.tabs.slides },
    { key: 'video', label: rc.tabs.video },
  ] as const;

  const featureVisuals: ReadonlyArray<React.ReactNode> = [
    // 1 — template library: two stacked real artifacts + live counts badge.
    <div className='hm-fv' key='library'>
      <span className='hm-col2'>
        <LazyImg src='/home-redesign/art/deck-emerald.webp' />
        <LazyImg src='/home-redesign/art/proto-1.webp' />
      </span>
      <span className='hm-fv-badge'>{featureBadge}</span>
    </div>,
    // 2 — design to code: real page art under a deployed-URL bar.
    <div className='hm-fv' key='deploy'>
      <LazyImg className='hm-bgart' src='/home-redesign/art/velar-live.webp' />
      <span className='hm-urlbar'>launch.yourbrand.site</span>
      <span className='hm-livepill'>{rc.features.livePill}</span>
    </div>,
    // 3 — editable: selection box + mini toolbar over real slide art.
    <div className='hm-fv' key='edit'>
      <LazyImg className='hm-bgart' src='/home-redesign/art/slides-2.webp' />
      <span className='hm-selbox' aria-hidden='true'>
        <i className='c1' />
        <i className='c2' />
        <i className='c3' />
        <i className='c4' />
      </span>
      <span className='hm-minibar'>
        {rc.features.editChips.map((chip) => (
          <b key={chip}>{chip}</b>
        ))}
      </span>
    </div>,
    // 4 — self-evolving system: ONE focused artifact at its latest
    // revision plus the kernel-update capsule. (Earlier multi-thumbnail
    // strips read as clutter at card size.)
    <div className='hm-fv hm-fv-evo' key='evolve'>
      <span className='hm-evo-solo'>
        <LazyImg src='/home-redesign/art/slides-1.webp' />
        <b>v23</b>
      </span>
      <span className='hm-evo-loop'>
        {rc.features.evoLoopPre}
        <b>{rc.features.evoLoopBold}</b>
      </span>
    </div>,
    // 5 — multimodal: mode capsules (language-neutral product labels,
    // matching the hero marquee's chip language) — no collage.
    <div className='hm-fv' key='multimodal'>
      <span className='hm-modes' aria-hidden='true'>
        {['WEB', 'DECK', 'IMAGE', 'VIDEO', 'AUDIO'].map((mode) => (
          <span key={mode}>{mode}</span>
        ))}
      </span>
    </div>,
    // 6 — Codex plugin: minimal CSS plugin-card mock; the real screenshot
    // lives in the larger "ways to use it" card below.
    <div className='hm-fv hm-fv-lav' key='codex'>
      <span className='hm-cdxcard' aria-hidden='true'>
        <span className='h'>
          <img className='logo' src='/agent-icons/codex.svg' alt='' />
          <b>Open Design</b>
          <u className='try'>Try</u>
        </span>
        <span className='pill'>
          <b>@open-design</b> Make the launch deck, on brand…
        </span>
      </span>
    </div>,
  ];

  return (
    <>
      <div className='shell'>
        {/* ====== STICKY CHROME (announcement bar + nav) ====== */}
        {/* The chrome wrapper is position:fixed, so the announcement bar must
            live INSIDE it — left in normal flow it renders on top of the
            fixed nav and swallows its pointer events at scroll-top. It hides
            together with the bar via the headroom behavior. */}
        <div className='site-chrome' data-chrome-headroom>
        {/* [data-hm-release] is refreshed client-side with the release
            codename (index.astro enhancer); the build-time label is the
            no-JS fallback. */}
        <div className='hm-announce' data-od-id='announce'>
          <span data-hm-release data-hm-release-template={rc.announce.line}>
            {announceLine}
          </span>
          <a
            className='hm-announce-pill'
            href={href('/download/')}
            data-download-cta
            data-direct-download
            data-download-placement='announce'
          >
            {rc.announce.download}{' '}
            <em aria-hidden='true'>
              <svg viewBox='0 0 12 12' width='11' height='11' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M6 1.2v7.4M2.7 5.4 6 8.7l3.3-3.3' /></svg>
            </em>
          </a>
        </div>
        {/* ====== NAV ====== */}
        {/* Headroom slide handled by `.site-chrome` wrapper above. */}
        <Header
          counts={counts}
          github={github}
          locale={locale}
          localeSwitcher={{
            label: commonCopy.topbar.languageSwitcherLabel,
            prefix: commonCopy.topbar.languageSwitcherPrefix ?? 'Lang',
            shortLabel: localeDef.shortLabel,
            options: localeOptions,
          }}
        />
        </div>{/* /site-chrome */}

        {/* ====== HERO + WORKSPACE DEMO ====== */}
        <section className='hero hm-hero-section' id='top' data-od-id='hero'>
          {/* Full-bleed hero backdrop retained from the previous homepage. */}
          <img
            className='hero-bg'
            src={heroBgImage}
            srcSet={heroBgSrcset}
            sizes='100vw'
            width={2880}
            height={2608}
            alt=''
            aria-hidden='true'
            fetchPriority='high'
            decoding='async'
          />
          <div className='container hero-grid'>
            <div className='hm-hero'>
              <h1 data-reveal>
                {rc.hero.title}
                <br />
                <span className='hm-h1b'>
                  <em>{rc.hero.subEm}</em>
                  {rc.hero.subRest}
                </span>
              </h1>
              <div className='hm-hero-cta' data-reveal>
                {/* Platform-aware direct download: `enhanceDownloadCta` in
                    index.astro rewrites href to the matching release asset
                    and appends the detected chip label. */}
                <a
                  className='hm-dl hm-dl-hero'
                  href={href('/download/')}
                  data-download-cta
                  data-direct-download
                  data-download-chip-target
                  data-download-placement='hero'
                >
                  <em className='hm-di' aria-hidden='true'>
                    ↓
                  </em>
                  {rc.hero.download}
                  <u className='hm-sheen' aria-hidden='true' />
                </a>
              </div>
              <div className='hm-tabs' data-reveal role='tablist' data-od-id='demo-tabs'>
                {scenes.map((scene, index) => (
                  <button
                    className={index === 0 ? 'hm-tab on' : 'hm-tab'}
                    type='button'
                    role='tab'
                    aria-selected={index === 0 ? 'true' : 'false'}
                    data-hm-scene={scene.key}
                    key={scene.key}
                  >
                    {scene.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Live three-pane workspace demo (projects / agent chat / canvas).
                Self-contained document; scene switches arrive via postMessage
                from the tabs above, wheel events are relayed back out so the
                page never loses scroll (index.astro `enhanceWorkspaceDemo`). */}
            <div className='hm-frame' data-od-id='workspace-demo'>
              <iframe
                src={`/home-redesign/workspace${demoSuffix}`}
                title={rc.demo.iframeTitle}
                loading='eager'
                data-hm-workspace
              />
            </div>
            {/* Agent marquee — the 21-agents claim, as an infinite icon rail. */}
            <p className='hm-mq-label' data-od-id='agents'>
              {rc.agents.pre}
              <b>{rc.agents.bold}</b>
              {rc.agents.post}
            </p>
            <div className='hm-marquee' aria-hidden='true'>
              <div className='hm-mq-track'>
                {[0, 1].map((run) =>
                  AGENT_CHIPS.map((chip) => (
                    <span className='hm-mq-chip' key={`${run}-${chip.alt}`}>
                      <img src={chip.src} alt='' loading='lazy' decoding='async' />
                      {chip.alt}
                    </span>
                  )),
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ====== HOW IT WORKS ====== */}
        <section className='hm-sec hm-sec-warm' data-od-id='how'>
          <div className='container'>
            <p className='hm-kicker' data-reveal>
              {rc.how.kicker}
            </p>
            <h2 className='hm-h2serif' data-reveal>
              {rc.how.title}
              <em>{rc.how.titleEm}</em>
            </h2>
            <div className='hm-steps'>
              <div className='hm-step' data-reveal>
                <div className='hm-viz'>
                  <div className='hm-ingest' aria-hidden='true'>
                    <span className='hm-ing im ia'>
                      <LazyImg src='/home-redesign/art/slides-2.webp' />
                    </span>
                    <span className='hm-ing im ib'>
                      <LazyImg src='/home-redesign/art/proto-1.webp' />
                    </span>
                    <span className='hm-ing file ic2'>
                      <b>◆</b> deck.fig
                    </span>
                    <span className='hm-ing url id2'>yourbrand.com</span>
                    <span className='hm-ing doc ie'>
                      <b>voice.md</b>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className='hm-ing swa if2'>
                      <u style={{ background: '#262626' }} />
                      <u style={{ background: '#63fe13' }} />
                      <u style={{ background: '#f0f0ec', border: '1px solid #e4e4e0' }} />
                    </span>
                  </div>
                </div>
                <div className='hm-num'>01</div>
                <h3>{rc.how.steps[0].title}</h3>
                <p>{rc.how.steps[0].body}</p>
              </div>
              <div className='hm-step' data-reveal>
                <div className='hm-viz'>
                  <div className='hm-iso' aria-hidden='true'>
                    <div className='layer l1' />
                    <div className='layer l2' />
                    <div className='layer l3' />
                    <div className='layer l4' />
                    <div className='layer l5' />
                  </div>
                </div>
                <div className='hm-num'>02</div>
                <h3>
                  <u>{rc.how.steps[1].title}</u>
                </h3>
                <p>{rc.how.steps[1].body}</p>
              </div>
              <div className='hm-step' data-reveal>
                <div className='hm-viz'>
                  <div className='hm-atiles' aria-hidden='true'>
                    {(
                      [
                        ['/home-redesign/art/slides-1.webp', 'SLIDES'],
                        ['/home-redesign/art/proto-1.webp', 'WEB'],
                        ['/home-redesign/art/mkt-en.webp', 'EMAIL'],
                        ['/home-redesign/art/video-1.webp', 'VIDEO'],
                        ['/home-redesign/art/slides-2.webp', 'DECK'],
                        ['/home-redesign/art/proto-2.webp', 'SITE'],
                      ] as const
                    ).map(([src, tag]) => (
                      <span className='hm-atile' key={tag}>
                        <LazyImg src={src} />
                        <i>{tag}</i>
                      </span>
                    ))}
                  </div>
                </div>
                <div className='hm-num'>03</div>
                <h3>{rc.how.steps[2].title}</h3>
                <p>{rc.how.steps[2].body}</p>
              </div>
            </div>
            <div className='hm-sec-cta'>
              <DownloadPill
                href={href('/download/')}
                label={rc.hero.download}
                placement='how'
                small
              />
            </div>
          </div>
        </section>

        {/* ====== KEY FEATURES ====== */}
        <section className='hm-sec' data-od-id='features'>
          <div className='container'>
            <h2 className='hm-h2serif' data-reveal>
              {rc.features.title}
              <em>{rc.features.titleEm}</em>
            </h2>
            {/* Interactive brand-system demo: switch brand / radius, four
                artifacts recalculate live inside the iframe. */}
            <div className='hm-brandrow' data-reveal>
              <div className='hm-brandcopy'>
                <h3>{rc.features.brandTitle}</h3>
                <p>{rc.features.brandBody}</p>
                <p className='hm-brandtry'>{rc.features.brandTry}</p>
                <p className='hm-branddl'>
                  <DownloadPill
                    href={href('/download/')}
                    label={rc.hero.download}
                    placement='features-brand'
                    small
                  />
                </p>
              </div>
              <div className='hm-brandviz'>
                <iframe
                  src={`/home-redesign/brand${demoSuffix}`}
                  title={rc.features.brandIframeTitle}
                  loading='lazy'
                  data-hm-brand
                />
              </div>
            </div>
            <div className='hm-fgrid'>
              {rc.features.cards.map((card, index) => (
                <div className='hm-fcard' data-reveal key={card.title}>
                  {featureVisuals[index]}
                  <h4>{card.title}</h4>
                  <p>{card.body}</p>
                </div>
              ))}
            </div>
            {/* Benchmark band. Scores are the launch figures Joey signed off
                on (2026-08-06); update BENCHMARK_SCORES when the next run
                lands. Dimension switching is pure CSS (radio + sibling
                selectors) so it works before any script runs. */}
            <div className='hm-bench' data-reveal>
              <div className='hm-bench-copy'>
                <h4>
                  {rc.features.bench.titlePre}
                  <em>{rc.features.bench.titleEm}</em>
                  {rc.features.bench.titlePost}
                </h4>
                <p>{rc.features.bench.body}</p>
              </div>
              <div className='hm-bench-panel'>
                {rc.features.bench.dimensions.map((label, index) => (
                  <input
                    className='hm-bench-radio'
                    type='radio'
                    name='hm-bench'
                    id={`hm-bench-${index}`}
                    defaultChecked={index === 0}
                    key={`radio-${label}`}
                  />
                ))}
                <div className='hm-bench-tabs' role='tablist'>
                  {rc.features.bench.dimensions.map((label, index) => (
                    <label className='hm-bench-tab' htmlFor={`hm-bench-${index}`} key={label}>
                      {label}
                    </label>
                  ))}
                </div>
                <div className='hm-bench-sets'>
                  {BENCHMARK_SCORES.map((set, index) => (
                    <div className='hm-bench-set' key={`set-${index}`}>
                      {set.map(([name, score]) => (
                        <div className='hm-bar' key={name}>
                          <span>{name}</span>
                          <span className='hm-bar-track'>
                            <i style={{ width: `${score}%` }} />
                          </span>
                          <span className='hm-bar-value'>{score.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <p className='hm-bench-axis'>{rc.features.bench.scoreLabel}</p>
              </div>
            </div>
          </div>
        </section>

        {/* ====== TEAM WORKSPACE ====== */}
        <section className='hm-sec' data-od-id='team'>
          <div className='container'>
            <h2 className='hm-h2serif' data-reveal>
              {rc.team.title}
              <em>{rc.team.titleEm}</em>
            </h2>
            <div className='hm-teamgrid'>
              <div className='hm-teamcopy' data-reveal>
                <p>{rc.team.body}</p>
                <p className='hm-teamchips'>
                  {rc.team.chips.map((chip, index) => (
                    <span key={chip}>
                      {index > 0 ? ' · ' : ''}
                      <b>{chip}</b>
                    </span>
                  ))}
                </p>
                <div className='hm-teamdl'>
                  <DownloadPill
                    href={href('/download/')}
                    label={rc.hero.download}
                    placement='team'
                    small
                  />
                </div>
              </div>
              {/* Team workspace window mock (pure CSS, language-light). */}
              <div className='hm-teamwin' data-reveal='right'>
                <div className='hm-tb'>
                  <i />
                  <i />
                  <i />
                  <img
                    className='hm-tb-logo'
                    src='/android-chrome-192x192.png'
                    alt=''
                  />
                  {rc.team.winTitle}
                </div>
                <div className='hm-teambody'>
                  <div className='hm-teammembers'>
                    <span className='hm-avatars' aria-hidden='true'>
                      <i className='a1'>J</i>
                      <i className='a2'>M</i>
                      <i className='a3'>E</i>
                      <i className='a4'>+9</i>
                    </span>
                    <span className='hm-memberline'>
                      {rc.team.membersLine} <b>acme-2026</b>
                    </span>
                  </div>
                  <div className='hm-teamcards' aria-hidden='true'>
                    {(
                      [
                        ['46%', '32%', 'M · deck'],
                        ['52%', '40%', 'E · landing'],
                        ['40%', '28%', 'J · social'],
                      ] as const
                    ).map(([w1, w2, tag]) => (
                      <div className='hm-teamcard' key={tag}>
                        <span className='t1' style={{ width: w1 }} />
                        <span className='t2' style={{ width: w2 }} />
                        <span className='tag'>{tag}</span>
                      </div>
                    ))}
                  </div>
                  <div className='hm-teamactivity'>
                    <b aria-hidden='true'>✓</b> {rc.team.activityPre}
                    <b>{rc.team.activityBold}</b>
                    {rc.team.activityPost}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ====== THREE WAYS TO USE IT ====== */}
        <section className='hm-sec hm-sec-warm' data-od-id='ways'>
          <div className='container'>
            <p className='hm-kicker' data-reveal>
              {rc.ways.kicker}
            </p>
            <h2 className='hm-h2serif' data-reveal>
              {rc.ways.title}
              <em>{rc.ways.titleEm}</em>
            </h2>
            <div className='hm-steps'>
              <div className='hm-step' data-reveal>
                <div className='hm-viz hm-viz-full'>
                  <LazyImg className='hm-vfill' src={heroProductImage} alt='Open Design app' />
                  <span className='hm-vcomposer' aria-hidden='true'>
                    <span>Make the launch deck, on brand…</span>
                    <i><svg viewBox='0 0 12 12' width='11' height='11' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M6 10.8V3.4M2.7 6.6 6 3.3l3.3 3.3' /></svg></i>
                  </span>
                </div>
                <div className='hm-num'>{rc.ways.desktop.eyebrow}</div>
                <h3>{rc.ways.desktop.title}</h3>
                <p>{rc.ways.desktop.body}</p>
                <p className='hm-way-cta'>
                  <DownloadPill
                    href={href('/download/')}
                    label={rc.hero.download}
                    placement='ways'
                    small
                  />
                </p>
              </div>
              <div className='hm-step' data-reveal>
                <div className='hm-viz hm-viz-full'>
                  <LazyImg className='hm-vfill' src='/cta-bg.webp?v=3' />
                  {/* Terminal mock — the real local-lifecycle commands, not an
                      illustration. `pnpm tools-dev` is the repo's canonical
                      dev entry point. */}
                  <span className='hm-term' aria-hidden='true'>
                    <span className='hm-term-bar'>
                      <i />
                      <i />
                      <i />
                    </span>
                    <code>
                      <span className='ln'>
                        <b>$</b> git clone nexu-io/open-design
                      </span>
                      <span className='ln'>
                        <b>$</b> pnpm install && pnpm tools-dev
                      </span>
                      <span className='ln ok'>● daemon + web running · localhost</span>
                    </code>
                  </span>
                </div>
                <div className='hm-num'>{rc.ways.selfHosted.eyebrow}</div>
                <h3>{rc.ways.selfHosted.title}</h3>
                <p>{rc.ways.selfHosted.body}</p>
                <p className='hm-way-cta'>
                  <a className='hm-link' href={REPO} {...ext}>
                    {rc.ways.selfHosted.cta} →
                  </a>
                </p>
              </div>
              <div className='hm-step' data-reveal>
                <div className='hm-viz hm-viz-full'>
                  <LazyImg className='hm-vfill' src='/cta-bg.webp?v=3' />
                  <LazyImg
                    className='hm-ovcard hm-ovwide'
                    src='/home-redesign/shots/codex-card.webp'
                    alt='Open Design plugin in Codex'
                  />
                </div>
                <div className='hm-num'>{rc.ways.codex.eyebrow}</div>
                <h3>{rc.ways.codex.title}</h3>
                <p>
                  {rc.ways.codex.body}
                  <b>{rc.ways.codex.bodyBold}</b>
                  {rc.ways.codex.bodyPost}
                </p>
                <p className='hm-way-cta'>
                  <a className='hm-link' href={href('/codex-plugin/')}>
                    {rc.ways.codex.cta} →
                  </a>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ====== CUSTOMER STORIES ====== */}
        <section className='hm-sec hm-sec-warm' data-od-id='stories'>
          <div className='container'>
            <h2 className='hm-h2serif' data-reveal>
              {rc.stories.title}
              <em>{rc.stories.titleEm}</em>
            </h2>
            <div className='hm-stories'>
              {(
                [
                  ['/stories/seungki-kim/', '/stories/seungki-kim-cover.webp'],
                  ['/stories/stuart-gardoll/', '/stories/stuart-gardoll-cover.webp'],
                  ['/stories/ikigai-one/', '/stories/ikigai-one-og.jpg'],
                ] as const
              ).map(([storyHref, cover], index) => {
                const card = rc.stories.cards[index]!;
                return (
                  <a className='hm-story' href={href(storyHref)} key={storyHref} data-reveal>
                    <span className='hm-story-cover'>
                      <LazyImg src={cover} />
                    </span>
                    <span className='hm-story-q'>{card.quote}</span>
                    <span className='hm-story-who'>
                      <b>{card.name}</b> · {card.desc}
                    </span>
                    <span className='hm-story-rd'>{rc.stories.read} →</span>
                  </a>
                );
              })}
            </div>
            <div className='hm-sec-cta'>
              <DownloadPill
                href={href('/download/')}
                label={rc.hero.download}
                placement='stories'
                small
              />
            </div>
          </div>
        </section>

        {/* ====== BLOG HIGHLIGHTS ====== */}
        <section className='hm-sec' data-od-id='blog-highlights'>
          <div className='container'>
            <h2 className='hm-h2serif' data-reveal>
              {rc.blog.title}
            </h2>
            <div className='hm-bloggrid'>
              {blogHighlights.map((post) => (
                <a className='hm-bcard' href={post.href} key={post.href} data-reveal>
                  <span className='hm-bc-cover'>
                    <LazyImg src={post.cover} alt={post.coverAlt} />
                  </span>
                  <span className='hm-bc-meta'>{post.category}</span>
                  <span className='hm-bc-t'>{post.title}</span>
                  <span className='hm-bc-m'>{post.meta}</span>
                </a>
              ))}
            </div>
            <p className='hm-blogall'>
              <a className='hm-link' href={href('/blog/')}>
                {rc.blog.viewAll} →
              </a>
            </p>
          </div>
        </section>

        {/* ====== CONTRIBUTORS / GLOBE ====== */}
        <section className='testimonial' data-od-id='testimonial'>
          <div className='container'>
            <div className='testimonial-grid with-globe'>
              <div className='testimonial-copy' data-reveal>
                <h2 style={{ marginTop: 30 }}>
                  {t.testiPre}
                  <span data-github-contributors>{github.contributorsCount}</span>
                  {t.testiMid}
                  <br />
                  <span style={{ whiteSpace: 'nowrap' }}>{t.testiPost}</span>
                </h2>
                <div className='cta-pair' style={{ marginTop: 16 }}>
                  <a className='btn btn-ghost' href='/community/contributors/'>
                    {cta.contributors}
                    <span className='arrow'>{arrowOut}</span>
                  </a>
                  <a
                    className='btn btn-primary'
                    href={href('/download/')}
                    data-download-cta
                    data-download-chip-target
                    data-download-placement='contributors'
                  >
                    <span className='arrow'>{iconDownload}</span>
                    {home.hero.download}
                  </a>
                </div>
              </div>
              <div className='testimonial-globe' data-reveal='right' data-testimonial-globe>
                <canvas
                  aria-label='Open Design global contributor map'
                  className='testimonial-globe-canvas'
                  height={720}
                  width={720}
                />
                {/* Contributor avatars orbiting the globe (no spokes), populated
                    from the GitHub contributors API by `enhanceContributorOrbit`. */}
                <div
                  className='contributor-orbit'
                  data-contributor-orbit
                  aria-hidden='true'
                />
              </div>
            </div>
          </div>
        </section>

        {/* ====== CLOSING CTA ====== */}
        <section className='cta' id='contact' data-od-id='cta'>
          <div className='container'>
            <div className='cta-dance' data-precise-bg>
              {/* Open Design Home window floating over the mural — sits above the
                  painting (::before) but below the CTA copy. Bottom is clipped by
                  the block's overflow:hidden, matching the reference comp. */}
              <img
                className='cta-window'
                src='/cta-window.webp'
                alt='Open Design desktop home'
                width={2996}
                height={1870}
                decoding='async'
                loading='lazy'
                data-reveal
              />
              <div className='cta-dance-inner'>
                <h2 className='display'>{t.ctaTitle}</h2>
                <p className='lead'>{home.cta.lead}</p>
                <div className='cta-actions'>
                  <a
                    className='btn btn-primary'
                    href={href('/download/')}
                    data-download-cta
                    data-download-chip-target
                    data-download-placement='cta'
                  >
                    <span className='arrow'>{iconDownload}</span>
                    {home.hero.download}
                  </a>
                  <a className='btn btn-primary' href={REPO} {...ext}>
                    <span className='arrow'>{<RemixIcon glyph={RI.github} />}</span>
                    {home.cta.star}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ====== FAQ ====== */}
        <section className='faq' id='faq' data-od-id='faq'>
          <div className='container'>
            <div className='faq-layout'>
              <div className='faq-head' data-reveal>
                <h2 className='display faq-title-zh'>{t.faqTitle}</h2>
                {/* High-intent download CTA filling the FAQ left column's blank
                    space — readers here are evaluating. */}
                <div className='faq-download'>
                  <a
                    className='btn btn-primary'
                    href={href('/download/')}
                    data-download-cta
                    data-download-chip-target
                    data-download-placement='faq'
                  >
                    <span className='arrow'>{iconDownload}</span>
                    {home.hero.download}
                  </a>
                  <p className='faq-download-note'>
                    {cta.downloadProof.split('{stars}').map((part, index) => (
                      <span key={`${part}-${index}`}>
                        {index > 0 ? <span data-github-stars>{github.starsLabel}</span> : null}
                        {part}
                      </span>
                    ))}
                  </p>
                </div>
              </div>
              <ol className='faq-list'>
                {faq.map(({ q, a, href: faqHref }, idx) => (
                  <li className='faq-item' key={q} data-reveal>
                    <details>
                      <summary>
                        <span className='faq-index'>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className='faq-q'>{q}</span>
                        <span className='faq-toggle' aria-hidden='true'>
                          +
                        </span>
                      </summary>
                      <p className='faq-a'>{a}</p>
                      {faqHref ? (
                        <p className='faq-more'>
                          <a href={href(faqHref)}>{cta.learnMore}</a>
                        </p>
                      ) : null}
                    </details>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ====== FOOTER ====== */}
        <footer className='sub-footer' data-od-id='footer'>
          <div className='container sub-footer-inner'>
            <div className='sub-footer-grid'>
              <div className='sub-footer-col'>
                <h5>{menu.product}</h5>
                <ul>
                  <li><a href={href('/')}>Open Design</a></li>
                  <li><a href={href('/html-anything/')}>{ui.footer.htmlAnything}</a></li>
                  <li><a href={href('/html-video/')}>{ui.footer.htmlVideo}</a></li>
                  <li><a href={href('/codex-slides/')}>Codex Slides</a></li>
                </ul>
              </div>

              <div className='sub-footer-col'>
                <h5><a href={href('/solutions/')}>{menu.solution}</a></h5>
                <ul>
                  {menu.useCaseItems.map((name, i) => (
                    <li key={FOOTER_USE_CASE_HREFS[i]}>
                      <a href={href(FOOTER_USE_CASE_HREFS[i]!)}>{name}</a>
                    </li>
                  ))}
                </ul>
              </div>

              <div className='sub-footer-col'>
                <h5><a href={href('/agents/')}>{menu.agent}</a></h5>
                <ul>
                  {FOOTER_AGENTS.map((a) => (
                    <li key={a.route}>
                      <a href={href(`/agents/${a.route}/`)}>{a.name}</a>
                    </li>
                  ))}
                  <li><a href={href('/agents/')}>{footL.allAgents} →</a></li>
                </ul>
              </div>

              <div className='sub-footer-col'>
                <h5><a href={href('/plugins/')}>{commonCopy.header.nav.plugins}</a></h5>
                <ul>
                  <li><a href={href('/plugins/templates/')}>{commonCopy.header.nav.templates}</a></li>
                  <li><a href={href('/plugins/skills/')}>{commonCopy.header.nav.skills}</a></li>
                  <li><a href={href('/plugins/systems/')}>{commonCopy.header.nav.systems}</a></li>
                </ul>
              </div>

              <div className='sub-footer-col'>
                <h5><a href={href('/compare/')}>{ui.footer.compare}</a></h5>
                <ul>
                  <li><a href={href('/alternatives/claude-design/')}>Claude Design</a></li>
                  <li><a href={href('/alternatives/figma/')}>Figma</a></li>
                  <li><a href={href('/alternatives/lovable/')}>Lovable</a></li>
                  <li><a href={href('/alternatives/bolt/')}>Bolt</a></li>
                  <li><a href={href('/alternatives/v0/')}>v0</a></li>
                  <li><a href={href('/alternatives/framer/')}>Framer</a></li>
                </ul>
              </div>

              <div className='sub-footer-col'>
                <h5>{menu.resources}</h5>
                <ul>
                  <li><a href={href('/blog/')}>{menu.resourceItems.blog}</a></li>
                  <li><a href={href('/tutorials/')}>{menu.resourceItems.tutorials}</a></li>
                  <li><a href={href('/download/')}>{menu.resourceItems.download}</a></li>
                  <li><a href={href('/quickstart/')}>{ui.footer.quickstart}</a></li>
                  <li><a href={href('/official/')}>{ui.footer.official}</a></li>
                </ul>
              </div>

              <div className='sub-footer-col'>
                <h5>{footL.company}</h5>
                <ul>
                  <li><a href={href('/about/')}>{footL.about}</a></li>
                  <li><a href={href('/careers/')}>{footL.careers}</a></li>
                  <li><a href={href('/faq/')}>{footL.faq}</a></li>
                  <li><a href={href('/privacy/')}>{footL.privacy}</a></li>
                  <li><a href={href('/terms/')}>{footL.terms}</a></li>
                  <li><a href={REPO} target='_blank' rel='noopener'>{ui.footer.github}</a></li>
                  <li><a href={DISCORD} target='_blank' rel='noopener'>{ui.footer.discord}</a></li>
                </ul>
              </div>
            </div>

            <div className='foot-bar'>
              <div className='foot-bar-left'>
                <span className='foot-copy'>© 2026 Powerformer, Inc. · Apache-2.0</span>
                <a href={href('/privacy/')}>{footL.privacy}</a>
                <span className='foot-dot' aria-hidden='true'>·</span>
                <a href={href('/terms/')}>{footL.terms}</a>
              </div>
              <div className='foot-social'>
                <a href={X_TWITTER} target='_blank' rel='noopener' aria-label='X'>
                  <svg viewBox='0 0 24 24' width='18' height='18' fill='currentColor' aria-hidden='true'><path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.65l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25h6.815l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z' /></svg>
                </a>
                <a href={DISCORD} target='_blank' rel='noopener' aria-label='Discord'>
                  <svg viewBox='0 0 24 24' width='18' height='18' fill='currentColor' aria-hidden='true'><path d='M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127c-.598.349-1.22.645-1.873.891a.076.076 0 0 0-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.056c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z' /></svg>
                </a>
                <a href={REPO} target='_blank' rel='noopener' aria-label='GitHub'>
                  <svg viewBox='0 0 24 24' width='18' height='18' fill='currentColor' aria-hidden='true'><path d='M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.5 11.5 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' /></svg>
                </a>
                <a href={YOUTUBE} target='_blank' rel='noopener' aria-label='YouTube'>
                  <svg viewBox='0 0 24 24' width='18' height='18' fill='currentColor' aria-hidden='true'><path d='M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' /></svg>
                </a>
              </div>
            </div>
            {/* Masthead sign-off — same markup contract as
                `site-footer.astro` so the shared `.foot-masthead` styles
                in globals.css cover both footers. */}
            <div className='foot-masthead' data-od-id='footer-masthead'>
              <p className='foot-masthead-wordmark'>
                Open <span className='foot-masthead-accent'>Design</span><span className='foot-masthead-period'>.</span>
              </p>
            </div>
          </div>
        </footer>
      </div>
      {/*
        Page-level progressive Gaussian blur pinned to the bottom edge
        (React Bits "Gradual Blur", SSR port). Restores the backdrop blur
        that a plain `.page-bottom-fade` white gradient had replaced.
      */}
      <GradualBlur
        target='page'
        position='bottom'
        height='4rem'
        strength={3}
        divCount={10}
        opacity={1}
        curve='linear'
        exponential
      />
    </>
  );
}

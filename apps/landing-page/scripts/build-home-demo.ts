/*
 * Build the homepage workspace demo into `public/home-redesign/`.
 *
 * The demo makes the product's core claim tangible: ONE artifact, rendered
 * under a different design system on every click. So it must not carry
 * per-brand markup or screenshots. Instead:
 *
 *   1. This script reads the real token contract from
 *      `design-systems/<slug>/tokens.css` — the same files an agent hands to a
 *      model when it generates work against that brand.
 *   2. It emits `design-systems.json` (a compact token bundle), the artifact
 *      renderer, its token-only stylesheet, and one demo document per locale.
 *   3. The demo binds a system's tokens as `--ds-*` custom properties, so
 *      switching systems is a token swap, never a markup swap.
 *
 * Adding a design system to the demo = adding a slug to `FEATURED_SYSTEMS`.
 * A brand re-tuning its tokens upstream flows through on the next build.
 *
 * Output is generated on every dev/build run (see `package.json`) and is
 * git-ignored, matching the `vendor-enhancers.ts` convention for browser
 * assets that live under `public/`.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ARTIFACTS_RUNTIME_JS } from './home-demo/artifacts-runtime';
import { DEMO_CONTROLLER_JS } from './home-demo/controller';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
const SYSTEMS_DIR = path.join(REPO_ROOT, 'design-systems');
const TEMPLATE_DIR = path.join(SCRIPT_DIR, 'home-demo');
const OUT_DIR = path.join(APP_ROOT, 'public', 'home-redesign');

/**
 * Systems shown in the demo, ordered as the chips render.
 *
 * Chosen for maximum visual distance from each other — light/dark, serif/sans,
 * sharp/pill, restrained/loud — so a single click makes the re-render obvious.
 * Every slug must exist under `design-systems/` with a `tokens.css`.
 */
const FEATURED_SYSTEMS: ReadonlyArray<{ slug: string; label: string }> = [
  // First entry is what the demo opens on.
  { slug: 'claude', label: 'Claude' },
  { slug: 'apple', label: 'Apple' },
  { slug: 'spotify', label: 'Spotify' },
  { slug: 'brutalism', label: 'Brutalism' },
  { slug: 'duolingo', label: 'Duolingo' },
  { slug: 'ferrari', label: 'Ferrari' },
  { slug: 'xiaohongshu', label: 'Xiaohongshu' },
  { slug: 'linear-app', label: 'Linear' },
];

interface DemoSystem {
  slug: string;
  label: string;
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  accentOn: string;
  radius: string;
  radiusLg: string;
  radiusSm: string;
  fontDisplay: string;
  fontBody: string;
  tracking: string;
}

/** Read the `:root { … }` declarations out of a brand's `tokens.css`. */
function readTokens(slug: string): Map<string, string> {
  const file = path.join(SYSTEMS_DIR, slug, 'tokens.css');
  if (!existsSync(file)) {
    throw new Error(
      `design system "${slug}" has no tokens.css — remove it from FEATURED_SYSTEMS or add the file`,
    );
  }
  const css = readFileSync(file, 'utf8');
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!root) throw new Error(`design system "${slug}": tokens.css has no :root block`);
  // Font stacks wrap across lines; fold continuations back onto their property.
  const body = root[1]!.replace(/\n\s+(?![-}])/g, ' ');
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const value = match[2]!.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
    if (value) tokens.set(match[1]!, value);
  }
  return tokens;
}

function toDemoSystem(slug: string, label: string): DemoSystem {
  const t = readTokens(slug);
  const pick = (...names: string[]) => {
    for (const name of names) {
      const value = t.get(name);
      if (value) return value;
    }
    return undefined;
  };
  const radius = pick('--radius-md', '--radius') ?? '10px';
  const required = (name: string, value: string | undefined) => {
    if (!value) throw new Error(`design system "${slug}": missing ${name}`);
    return value;
  };
  return {
    slug,
    label,
    bg: required('--bg', pick('--bg')),
    surface: pick('--surface', '--surface-warm') ?? required('--bg', pick('--bg')),
    fg: required('--fg', pick('--fg')),
    muted: pick('--muted', '--fg-2', '--meta') ?? required('--fg', pick('--fg')),
    border: pick('--border', '--border-soft') ?? 'rgba(0,0,0,0.12)',
    accent: required('--accent', pick('--accent')),
    accentOn: pick('--accent-on') ?? '#ffffff',
    radius,
    radiusLg: pick('--radius-lg') ?? radius,
    radiusSm: pick('--radius-sm') ?? '6px',
    fontDisplay: pick('--font-display', '--font-body') ?? 'system-ui, sans-serif',
    fontBody: pick('--font-body', '--font-display') ?? 'system-ui, sans-serif',
    tracking: pick('--tracking-display') ?? '-0.01em',
  };
}

interface Scene {
  name: string;
  sub: string;
  prompt: string;
  steps: readonly string[];
}

interface DemoLocale {
  lang: string;
  locale: 'en' | 'zh';
  projects: string;
  newProject: string;
  ask: string;
  systemLabel: string;
  liveArtifact: string;
  renderedFrom: string;
  hint: string;
  hintLive: string;
  ready: string;
  reply: string;
  download: string;
  scenes: Record<'web' | 'mobile' | 'poster' | 'slides' | 'video', Scene>;
}

const LOCALES: ReadonlyArray<{ file: string; copy: DemoLocale }> = [
  {
    file: 'workspace.html',
    copy: {
      lang: 'en',
      locale: 'en',
      projects: 'My projects',
      newProject: '+ New project',
      ask: 'Ask Open Design anything…',
      systemLabel: 'Design system',
      liveArtifact: 'Live artifact',
      renderedFrom: 'rendered from tokens',
      hint: '✎ Click the canvas to interact',
      hintLive: '✎ Hover any text, click to edit',
      ready: '✦ Artifact ready. Hover text to edit.',
      reply:
        'This is a live demo. <b>Download the app for the full experience</b> - real generation, editing, and export all happen in the client.',
      download: 'Download free',
      scenes: {
        web: {
          name: 'Marketing site',
          sub: 'Web · landing',
          prompt: 'A landing page for the launch, in our design system.',
          steps: ['Reading design tokens', 'Laying out hero + cards', 'Writing copy', 'Rendering artifact'],
        },
        mobile: {
          name: 'Product app',
          sub: 'Mobile · product UI',
          prompt: 'The product app home screen, same design system.',
          steps: ['Reading design tokens', 'Laying out screens', 'Building components', 'Rendering artifact'],
        },
        poster: {
          name: 'Launch poster',
          sub: 'Marketing · poster',
          prompt: 'A launch poster, poster-grade typography from the kernel.',
          steps: ['Reading design tokens', 'Composing key visual', 'Typesetting', 'Rendering artifact'],
        },
        slides: {
          name: 'Quarterly deck',
          sub: 'Slides · review',
          prompt: 'The quarterly review deck, on brand.',
          steps: ['Reading design tokens', 'Outlining the story', 'Laying out data', 'Rendering artifact'],
        },
        video: {
          name: 'Launch film',
          sub: 'Video · HTML motion',
          prompt: 'The launch film title sequence, in our design system.',
          steps: ['Reading design tokens', 'Storyboarding 3 shots', 'Animating type', 'Rendering sequence'],
        },
      },
    },
  },
  {
    file: 'workspace.zh.html',
    copy: {
      lang: 'zh-CN',
      locale: 'zh',
      projects: '我的项目',
      newProject: '+ 新建项目',
      ask: '问 Open Design 任何问题…',
      systemLabel: '设计系统',
      liveArtifact: '实时产物',
      renderedFrom: '由 token 渲染',
      hint: '✎ 点击画布开始交互',
      hintLive: '✎ 悬停任意文字，点击即可编辑',
      ready: '✦ 产物已就绪，悬停文字可编辑。',
      reply:
        '这里是在线演示。<b>下载客户端去体验完整的功能</b>，真实生成、编辑、导出都在客户端里。',
      download: '免费下载',
      scenes: {
        web: {
          name: '营销官网',
          sub: '网页 · 落地页',
          prompt: '用我们的设计系统做一版发布落地页。',
          steps: ['读取设计 token', '排布首屏与卡片', '撰写文案', '渲染产物'],
        },
        mobile: {
          name: '产品 App',
          sub: '移动端 · 产品界面',
          prompt: '产品 App 首页，同一套设计系统。',
          steps: ['读取设计 token', '排布页面', '搭建组件', '渲染产物'],
        },
        poster: {
          name: '发布海报',
          sub: '营销 · 海报',
          prompt: '一张发布海报，字体层级来自品牌内核。',
          steps: ['读取设计 token', '构图主视觉', '排版', '渲染产物'],
        },
        slides: {
          name: '季度 Deck',
          sub: '演示 · 复盘',
          prompt: '季度复盘 Deck，保持品牌一致。',
          steps: ['读取设计 token', '梳理叙事', '排布数据页', '渲染产物'],
        },
        video: {
          name: '发布短片',
          sub: '视频 · HTML 动效',
          prompt: '发布短片的片头，用我们的设计系统。',
          steps: ['读取设计 token', '分镜 3 个镜头', '动效排版', '渲染序列'],
        },
      },
    },
  },
];

function template(name: string): string {
  return readFileSync(path.join(TEMPLATE_DIR, name), 'utf8');
}

const systems = FEATURED_SYSTEMS.map(({ slug, label }) => toDemoSystem(slug, label));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'design-systems.json'), `${JSON.stringify(systems, null, 2)}\n`);
writeFileSync(path.join(OUT_DIR, 'artifacts.css'), template('artifacts.template.css'));
writeFileSync(path.join(OUT_DIR, 'artifacts.js'), ARTIFACTS_RUNTIME_JS);

const shell = template('shell.template.html');
const controller = DEMO_CONTROLLER_JS;

for (const { file, copy } of LOCALES) {
  const strings = {
    ready: copy.ready,
    hint: copy.hint,
    hint2: copy.hintLive,
    reply: copy.reply,
    dl: copy.download,
    capname: copy.renderedFrom,
  };
  const head = shell
    .replaceAll('{{lang}}', copy.lang)
    .replaceAll('{{projects}}', copy.projects)
    .replaceAll('{{newProject}}', copy.newProject)
    .replaceAll('{{ask}}', copy.ask)
    .replaceAll('{{systemLabel}}', copy.systemLabel)
    .replaceAll('{{liveArtifact}}', copy.liveArtifact)
    .replaceAll('{{renderedFrom}}', copy.renderedFrom)
    .replaceAll('{{hint}}', copy.hint);
  const script = [
    '<script src="/home-redesign/artifacts.js"></script>',
    '<script>',
    `var LOCALE = ${JSON.stringify(copy.locale)};`,
    `var SCENES = ${JSON.stringify(copy.scenes)};`,
    `var STR = ${JSON.stringify(strings)};`,
    controller,
    '</script>',
    '</body></html>',
    '',
  ].join('\n');
  writeFileSync(path.join(OUT_DIR, file), head + script);
}

console.log(
  `[home-demo] ${systems.length} design systems -> ${LOCALES.length} demo documents ` +
    `(${systems.map((s) => s.label).join(', ')})`,
);

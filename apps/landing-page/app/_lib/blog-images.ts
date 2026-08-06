/**
 * Blog cover art, keyed by post id.
 *
 * Single source of truth for every surface that renders a blog card: the blog
 * index and the homepage "Recent highlights" rail. Filenames are NOT derivable
 * from the id (covers get re-cut as `-cover-v2.webp`, and some posts ship no
 * cover at all), so a post added here shows art everywhere at once — and a post
 * missing here is skipped rather than rendering a broken tile.
 */

export interface BlogImage {
  src: string;
  alt: string;
}

export const POST_IMAGES: Record<string, BlogImage> = {
  'claude-ppt-skills': {
    src: '/blog/claude-ppt-skills-cover.webp',
    alt: 'A clean editorial illustration of a fanned stack of presentation slides on a near-white desk, the top slide held in a green selection frame with corner handles, beside a soft matte 3D cursor and pen, with a dot grid and golden spiral',
  },
  'reveal-js': {
    src: '/blog/reveal-js-cover.webp',
    alt: 'A clean illustration of an HTML presentation slide in a browser with navigation arrows, held in a green selection frame with corner handles, on a near-white dot-grid ground',
  },
  'slidev': {
    src: '/blog/slidev-cover.webp',
    alt: 'A clean illustration of a Markdown document with code becoming a developer presentation slide, the slide held in a green selection frame with corner handles, on a near-white dot-grid ground',
  },
  'marp': {
    src: '/blog/marp-cover.webp',
    alt: 'A clean illustration of a Markdown text file turning into a stack of slides, the top slide held in a green selection frame with corner handles, on a near-white dot-grid ground',
  },
  'frontend-slides': {
    src: '/blog/frontend-slides-cover.webp',
    alt: 'A clean illustration of a coding-agent cursor assembling a web slide from layout blocks, the finished slide held in a green selection frame with corner handles, on a near-white dot-grid ground',
  },
  'guizang-ppt-skill': {
    src: '/blog/guizang-ppt-skill-cover.webp',
    alt: 'A clean illustration of an editorial, Swiss-grid presentation slide held in a green selection frame with a pen tool, on a near-white dot-grid ground',
  },
  'dashiai-ppt-skill': {
    src: '/blog/dashiai-ppt-skill-cover.webp',
    alt: 'A clean illustration of a presentation slide being edited with drag handles beside a row of theme swatches, the slide held in a green selection frame, on a near-white dot-grid ground',
  },
  'codex-ppt-skill': {
    src: '/blog/codex-ppt-skill-cover.webp',
    alt: 'A clean illustration of an image-forward presentation slide held in a green selection frame with a command-line caret, on a near-white dot-grid ground',
  },
  'ppt-master': {
    src: '/blog/ppt-master-cover.webp',
    alt: 'A clean illustration of a document turning into an editable slide made of native shape blocks, the slide held in a green selection frame with corner handles, on a near-white dot-grid ground',
  },
  'open-design-0-14-0-inspiration-time-machine': {
    src: '/blog/open-design-0-14-0-inspiration-time-machine-cover.webp',
    alt: 'A warm editorial illustration of a hand-drawn idea sketch with a lightbulb becoming a calm sage-green planning workspace with a structured outline and a version-history timeline, beside soft plants and a coffee mug',
  },
  'open-design-0-16-0-reliable-delivery': {
    src: '/blog/open-design-0-16-0-reliable-delivery-cover.webp',
    alt: 'A warm editorial illustration of a hand-drawn delivery sketch with a broken handoff line becoming a calm sage-green workspace handing a finished deliverable along an unbroken line, on a near-white paper desk with soft plants and a coffee mug',
  },
  'open-design-0-18-0-design-team-workspace-codex': {
    src: '/blog/open-design-0-18-0-design-team-workspace-codex-cover-v2.webp',
    alt: 'A warm editorial illustration of hand-drawn collaborator marks and rough design fragments becoming a calm sage-green shared workspace with organized project cards, comments, and completed artifacts, on a cream paper desk with a plant, coffee mug, notebook, pencil, and binder clips',
  },
  'open-design-0-17-0-open-design-for-codex': {
    src: '/blog/open-design-0-17-0-open-design-for-codex-cover-v2.webp',
    alt: 'A warm editorial illustration of hand-drawn Codex conversation bubbles and a rough interface sketch becoming a calm sage-green editable design workspace, on a cream paper desk with a plant, coffee mug, notebook, and pencil',
  },
  'open-design-0-15-1': {
    src: '/blog/open-design-0-15-1-cover.webp',
    alt: 'A warm editorial illustration of a coarse hand-drawn interface sketch under a magnifying loupe becoming a crisp, detailed sage-green workspace with an unbroken session thread running past a pause mark, on a near-white paper desk with soft plants and a coffee mug',
  },
  'open-design-0-15-0-cost-less-ship-faster': {
    src: '/blog/open-design-0-15-0-cost-less-ship-faster-cover.webp',
    alt: 'A warm editorial illustration of a hand-drawn deck sketch becoming a calm sage-green slide workspace shipping fast beside a timer, on a near-white paper desk with soft plants and a coffee mug',
  },
  'how-to-use-claude-code-for-frontend-design': {
    src: '/blog/how-to-use-claude-code-for-frontend-design-cover.webp',
    alt: 'A warm editorial illustration of a terminal prompt becoming a polished UI screen on a tablet, with a design-system file card (DESIGN.md) held in a green selection frame connecting the two, beside soft plants and a coffee mug',
  },
  'ai-design-agents': {
    src: '/blog/ai-design-agents-cover.webp',
    alt: 'A warm editorial illustration of three groups of AI design-agent cards on a desk — creative assets, task helpers, and an agent-native pipeline — with the design-to-code agent card lifted out and held in a green selection frame, beside soft plants and a coffee mug',
  },
  'ai-prototyping-tools': {
    src: '/blog/ai-prototyping-tools-cover.webp',
    alt: 'A warm editorial illustration of a clickable mockup prototype and a running code prototype side by side on a desk, with the code prototype that becomes the shipped product held in a green selection frame, beside soft plants and a coffee mug',
  },
  'figma-alternatives': {
    src: '/blog/figma-alternatives-cover.webp',
    alt: 'A warm editorial illustration of several design-tool windows grouped into camps — an open-source canvas, a native app, an AI generator — with one option, a plain-text design-to-code pipeline, lifted out and held in a green selection frame, on a near-white paper desk with soft plants and a coffee mug',
  },
  'v0-alternatives': {
    src: '/blog/v0-alternatives-cover.webp',
    alt: 'A warm editorial illustration of a row of AI UI-generator cards on a desk, with one card — a UI component lifted into a code repo with no usage meter — held in a green selection frame, beside soft plants and a coffee mug',
  },
  'best-ai-design-tools': {
    src: '/blog/best-ai-design-tools-cover.webp',
    alt: 'A warm editorial illustration of a row of AI design-tool cards on a scorecard, with one card — a plain-text design file you can keep — lifted out and held in a green selection frame, on a near-white paper ground with soft plants and a coffee mug',
  },
  'bolt-new-alternatives': {
    src: '/blog/bolt-new-alternatives-cover.webp',
    alt: 'A warm editorial illustration of a row of AI app-builder cards on a desk, with one card — an open folder of portable files you own — lifted out and held in a green selection frame, beside soft plants and a coffee mug',
  },
  'design-to-code-tools': {
    src: '/blog/design-to-code-tools-cover.webp',
    alt: 'A warm editorial illustration of a design mockup flowing through an arrow into clean code, with the connecting design-system file card held in a green selection frame, on a near-white paper desk with soft plants and a coffee mug',
  },
  'lovable-alternatives': {
    src: '/blog/lovable-alternatives-cover.webp',
    alt: 'A warm editorial illustration of a row of prompt-to-app tool cards on a desk, with one card — plain files with no usage meter — lifted out and held in a green selection frame, beside soft plants and a coffee mug',
  },
  'open-design-0-13-0-stay-in-flow': {
    src: '/blog/open-design-0-13-0-stay-in-flow-cover.webp',
    alt: 'A clean editorial illustration of a design session that stays in flow — a row of wireframe workspace panels connected by one continuous unbroken thread, one panel held in a green selection frame with corner handles, on a near-white ground with a dot grid and a soft matte cursor',
  },
  'open-design-0-12-0-brand-backed-design-system': {
    src: '/blog/open-design-0-12-0-brand-backed-design-system-cover.webp',
    alt: 'A warm editorial illustration of a website becoming a design system — a browser window, a design-system kit card with color swatch dots and type samples, and a finished document — on a cream paper ground with soft plants and a coffee mug',
  },
  'open-design-0-11-0-the-bazaar': {
    src: '/blog/open-design-0-11-0-the-bazaar-cover.webp',
    alt: 'A warm editorial illustration of an open gallery of design template cards, each a small thumbnail with a play triangle, with a hand reaching to pick one, on a cream paper ground with soft plants and a coffee mug',
  },
  'open-design-osaka-kyoto-meetup': {
    src: '/blog/open-design-osaka-kyoto-meetup-cover.webp',
    alt: 'Open Design Osaka / Kyoto meetup cover showing Osaka and Kyoto landmarks built from code-like line art',
  },
  'open-design-shanghai-ai-workshop': {
    src: '/blog/open-design-shanghai-ai-workshop-cover.webp',
    alt: 'Open Design Shanghai AI Workshop cover showing Shanghai landmarks built from code-like line art',
  },
  'what-is-vibe-design': {
    src: '/blog/what-is-vibe-design-cover.webp',
    alt: 'A hand-drawn pencil sketch of a planner app wishing for a calm space transforming, via an arrow, into a polished rendered planner UI, on a warm paper editorial ground',
  },
  'vibe-design-tools': {
    src: '/blog/vibe-design-tools-cover.webp',
    alt: 'A hand-drawn pencil wireframe transforming, via an arrow, into a polished design app showing a row of tool cards to choose from, on a warm paper editorial ground',
  },
  'vibe-design-vs-vibe-coding': {
    src: '/blog/vibe-design-vs-vibe-coding-cover.webp',
    alt: 'A single sketched interface splitting into a visual design mockup and a code window, both arrows converging on one shared design-system file card, on a warm paper editorial ground',
  },
  'vibe-design-with-stitch': {
    src: '/blog/vibe-design-with-stitch-cover.webp',
    alt: 'A handwritten prompt note becoming a rendered mobile app screen, then exported outward through an opening in a low garden wall, on a warm paper editorial ground',
  },
  'open-design-0-10-0-all-in-one-workspace': {
    src: '/blog/open-design-0-10-0-all-in-one-workspace-cover.webp',
    alt: 'A single unified design-workspace window — composer, canvas, and comment rail in one frame — held inside a green selection box on a near-white editorial ground',
  },
  'open-design-0-9-0-design-for-everyone': {
    src: '/blog/open-design-0-9-0-design-for-everyone-cover.webp',
    alt: 'An onboarding panel with a one-click sign-in and a bundled engine, selected in a green frame on a near-white editorial ground',
  },
  'open-design-0-8-0-everything-is-a-plugin': {
    src: '/blog/open-design-0-8-0-everything-is-a-plugin-cover.webp',
    alt: 'A central engine hub with plugin tiles docking into it, selected in a green frame on a near-white editorial ground',
  },
  'layout-layer-canvas-used-to-hide': {
    src: '/blog/layout-layer-canvas-used-to-hide-cover.webp',
    alt: 'A wireframe layout skeleton lifting out from beneath a canvas as its own layer, in a green selection frame on a near-white editorial ground',
  },
  'port-figma-workflow-open-design-plugin': {
    src: '/blog/port-figma-workflow-open-design-plugin-cover.webp',
    alt: 'A design frame being lifted out of a canvas and packaged into a portable plugin module, in a green selection frame on a near-white editorial ground',
  },
  'figma-alternative-open-design': {
    src: '/blog/figma-alternative-open-design-cover.webp',
    alt: 'A locked canvas window beside an open fanned stack of portable file sheets, in a green selection frame on a near-white editorial ground',
  },
  'open-source-alternative-to-claude-design': {
    src: '/blog/open-source-alternative-to-claude-design-cover.webp',
    alt: 'A hosted cloud chained to a lock beside an open folder of portable plain-text files, in a green selection frame on a near-white editorial ground',
  },
  '31-skills-72-systems-how-the-library-works': {
    src: '/blog/31-skills-72-systems-how-the-library-works-cover.webp',
    alt: 'An organized library grid of modular skill and system cards, selected in a green frame on a near-white editorial ground',
  },
  'byok-design-workflow-claude-codex-qwen': {
    src: '/blog/byok-design-workflow-claude-codex-qwen-cover.webp',
    alt: 'A single key wired to a row of interchangeable model engines with a provider toggle, in a green selection frame on a near-white editorial ground',
  },
  'byok-reality-check-5-things-that-break': {
    src: '/blog/byok-reality-check-5-things-that-break-cover.webp',
    alt: 'A workflow pipeline of connected nodes with a few break marks on the connectors, in a green selection frame on a near-white editorial ground',
  },
  'why-we-built-open-design-as-a-skill-layer': {
    src: '/blog/why-we-built-open-design-as-a-skill-layer-cover.webp',
    alt: 'A thin layer sheet wrapping around an existing agent core, in a green selection frame on a near-white editorial ground',
  },
};

export function getBlogImage(id: string): BlogImage | undefined {
  return POST_IMAGES[id];
}

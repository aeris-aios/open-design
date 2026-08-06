/**
 * Copy for the redesigned homepage modules (2026-08 homepage overhaul):
 * announcement bar, workspace hero + scenario demo, agent marquee,
 * "How it works" steps, key-features grid, team workspace, ways to use,
 * customer stories, and the blog-highlights rail.
 *
 * Same contract as `home-translations.ts` (`getHomeExtra`): a typed shape,
 * one const per landing locale, English as the universal fallback. Structural
 * strings that read as product-UI mock chrome (all-caps artifact labels like
 * `SLIDES`, avatar initials, `deck.fig`) stay hardcoded in `page.tsx` — they
 * are language-neutral by design, matching the site's English product shots.
 */

import type { LandingLocaleCode } from './i18n';

export interface HomeRedesignStep {
  title: string;
  body: string;
}

export interface HomeRedesignFeatureCard {
  title: string;
  body: string;
}

export interface HomeRedesignWayCard {
  /** All-caps eyebrow, e.g. "FULL WORKSPACE". */
  eyebrow: string;
  title: string;
  body: string;
  /** Secondary link label (arrow appended in markup); empty = download CTA. */
  cta: string;
}

export interface HomeRedesignStoryCard {
  /** Verbatim quotation — keep the original English quote in every locale. */
  quote: string;
  name: string;
  desc: string;
}

export interface HomeRedesignCopy {
  announce: {
    /** `{release}` is substituted with the release label (e.g. "Open Design 0.17.0"). */
    line: string;
    download: string;
  };
  hero: {
    title: string;
    /** Second headline line: highlighted lead-in + remainder. */
    subEm: string;
    subRest: string;
    download: string;
  };
  tabs: {
    web: string;
    mobile: string;
    poster: string;
    slides: string;
    video: string;
  };
  demo: {
    getApp: string;
    iframeTitle: string;
  };
  agents: {
    /** "Works with <b>21 coding agents</b>, plug in and use directly" split around the bold run. */
    pre: string;
    bold: string;
    post: string;
  };
  how: {
    kicker: string;
    title: string;
    titleEm: string;
    steps: readonly [HomeRedesignStep, HomeRedesignStep, HomeRedesignStep];
  };
  features: {
    kicker: string;
    title: string;
    titleEm: string;
    brandTitle: string;
    brandBody: string;
    brandTry: string;
    brandIframeTitle: string;
    /** `{templates}` / `{systems}` substituted with live catalog counts. */
    badge: string;
    livePill: string;
    editChips: readonly [string, string, string];
    evoLoopPre: string;
    evoLoopBold: string;
    cards: readonly [
      HomeRedesignFeatureCard,
      HomeRedesignFeatureCard,
      HomeRedesignFeatureCard,
      HomeRedesignFeatureCard,
      HomeRedesignFeatureCard,
      HomeRedesignFeatureCard,
    ];
    /** Dark benchmark band under the card grid ("Leads the *Design benchmark*"). */
    bench: {
      titlePre: string;
      titleEm: string;
      titlePost: string;
      body: string;
      /** Score-axis caption, e.g. "Design quality score". */
      scoreLabel: string;
      /** Task families the benchmark scores, rendered as switchable tabs. */
      dimensions: readonly [string, string, string, string, string];
    };
  };
  team: {
    kicker: string;
    title: string;
    titleEm: string;
    body: string;
    chips: readonly [string, string, string];
    winTitle: string;
    /** "12 members · brand kernel" (the kernel id chip follows in markup). */
    membersLine: string;
    activityPre: string;
    activityBold: string;
    activityPost: string;
  };
  ways: {
    kicker: string;
    title: string;
    titleEm: string;
    desktop: HomeRedesignWayCard;
    selfHosted: HomeRedesignWayCard;
    codex: HomeRedesignWayCard & {
      /** Body splits around the bold `@open-design` mention. */
      bodyBold: string;
      bodyPost: string;
    };
  };
  stories: {
    kicker: string;
    title: string;
    titleEm: string;
    read: string;
    cards: readonly [HomeRedesignStoryCard, HomeRedesignStoryCard, HomeRedesignStoryCard];
  };
  blog: {
    kicker: string;
    title: string;
    viewAll: string;
  };
}

const en: HomeRedesignCopy = {
  announce: {
    line: '{release} is out',
    download: 'Download free',
  },
  hero: {
    title: 'The Vibe Design Workspace for your brand.',
    subEm: 'One design system',
    subRest: ' across everything you ship.',
    download: 'Download free',
  },
  tabs: {
    web: 'Web prototypes',
    mobile: 'Mobile apps',
    poster: 'Marketing posters',
    slides: 'Slides & PPT',
    video: 'Video',
  },
  demo: {
    getApp: 'Get the app',
    iframeTitle: 'Open Design workspace demo',
  },
  agents: {
    pre: 'Works with ',
    bold: '21 coding agents',
    post: ', plug in and use directly',
  },
  how: {
    kicker: 'How it works',
    title: 'From one design system. ',
    titleEm: 'To every scene.',
    steps: [
      {
        title: 'Ingest from any source.',
        body: 'Feed in everything that defines your brand: decks, sites, Figma, images, docs.',
      },
      {
        title: 'Systemise your brand.',
        body: 'Open Design unifies it into one brand kernel: colors, type, voice, imagery, rules.',
      },
      {
        title: 'Create every scene.',
        body: 'Slides, prototypes, marketing visuals, video. One canonical brand, called from anywhere.',
      },
    ],
  },
  features: {
    kicker: 'Key features',
    title: 'Everything design needs. ',
    titleEm: 'Built in.',
    brandTitle: 'Hundreds of brand systems, built in.',
    brandBody:
      'Start from a curated design system or systemise your own. Colors, type, radius, voice: change one thing and every artifact recalculates.',
    brandTry: 'Try it: switch the brand or tap a radius step. The four artifacts recalculate live.',
    brandIframeTitle: 'Brand system demo',
    badge: '{templates} templates · {systems} systems',
    livePill: '● LIVE',
    editChips: ['✎ Edit', '⇲ Resize', '⧉ Variants'],
    evoLoopPre: '↺ brand kernel updated: ',
    evoLoopBold: 'minimal layouts · radius 8px · your tone',
    cards: [
      {
        title: 'A loaded template library',
        body: 'Decks, sites, cards, film frames. Fork any of them and they take your brand.',
      },
      {
        title: 'Design to code, live in one click',
        body: 'Design is code here: every artifact is real HTML, not a mockup. It deploys straight to a live URL. No handoff, no rebuild.',
      },
      {
        title: 'Everything stays editable',
        body: 'Nothing is a flat image. Tweak layout, copy, and style freely after generation.',
      },
      {
        title: 'A brand system that self-evolves',
        body: 'Every choice feeds back into your brand system and memory, so each artifact lands more on-brand than the last.',
      },
      {
        title: 'Multimodal by default',
        body: 'Pages, decks, images, video, audio. Generated together, under one brand.',
      },
      {
        title: 'Plugins, right inside Codex',
        body: 'Call Open Design from Codex and get a real, editable artifact back in the flow.',
      },
    ],
    bench: {
      titlePre: 'Leads the ',
      titleEm: 'Design benchmark',
      titlePost: '',
      body: 'Best-in-class output quality on design tasks, measured against Codex and Claude Design on the public benchmark.',
      scoreLabel: 'Design quality score',
      dimensions: [
        'Overall',
        'Web design',
        'Slides & PPT',
        'Marketing visuals',
        'Mobile UI',
      ],
    },
  },
  team: {
    kicker: 'Team Workspace',
    title: 'One workspace. ',
    titleEm: 'The whole team, on brand.',
    body: "Share the brand system, templates, and projects across your team. Everyone generates with the same kernel, every artifact lands in one library, and a change to the system recalculates everyone's work.",
    chips: ['Shared brand kernel', 'Team template library', 'Review before publish'],
    winTitle: 'Open Design · Team workspace',
    membersLine: '12 members · brand kernel',
    activityPre: 'Mason updated the kernel: ',
    activityBold: '3 artifacts recalculated',
    activityPost: ', review requested',
  },
  ways: {
    kicker: 'Three ways to use it',
    title: 'Desktop, self-hosted, ',
    titleEm: 'or inside Codex.',
    desktop: {
      eyebrow: 'FULL WORKSPACE',
      title: 'The desktop app.',
      body: 'Studio, brand center, library, memory. Everything on your machine.',
      cta: '',
    },
    selfHosted: {
      eyebrow: 'RUN IT YOURSELF',
      title: 'Self-hosted.',
      body: 'Apache-2.0, local daemon and web. Deploy inside your own network.',
      cta: 'View the repo',
    },
    codex: {
      eyebrow: 'STAY IN YOUR FLOW',
      title: 'The Codex plugin.',
      body: 'Install once, then call ',
      bodyBold: '@open-design',
      bodyPost: ' from any Codex conversation.',
      cta: 'Install in Codex',
    },
  },
  stories: {
    kicker: 'Customer stories',
    title: 'Built with Open Design. ',
    titleEm: 'By real teams.',
    read: 'Read the story',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: 'KAIST-trained designer, founder of FABOR. Brand site and social card-news, built in parallel with his 3D-print craft.',
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: 'AI engineer, founder of Connect I/O. Apps and motion graphics, on whatever model he chooses.',
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: "US cybersecurity company. A whole team's design output from one workspace.",
      },
    ],
  },
  blog: {
    kicker: 'From the blog',
    title: 'Recent highlights.',
    viewAll: 'View all blog posts',
  },
};

const zh: HomeRedesignCopy = {
  announce: {
    line: '{release} 已发布',
    download: '免费下载',
  },
  hero: {
    title: '为你的品牌而生的 Vibe Design Workspace。',
    subEm: '一套设计系统',
    subRest: '，构建你的全场景视觉。',
    download: '免费下载',
  },
  tabs: {
    web: '网站原型',
    mobile: '移动端 APP',
    poster: '营销海报',
    slides: 'PPT · 演示',
    video: '视频',
  },
  demo: {
    getApp: '下载客户端',
    iframeTitle: 'Open Design 工作台演示',
  },
  agents: {
    pre: '支持 ',
    bold: '21 种 coding agent',
    post: '，接入即用',
  },
  how: {
    kicker: '工作方式',
    title: '一套设计系统。',
    titleEm: '生成每一个场景。',
    steps: [
      {
        title: '喂入任何品牌素材。',
        body: '把定义你品牌的一切喂进来：Deck、网站、Figma、图片、文档。',
      },
      {
        title: '沉淀成品牌系统。',
        body: 'Open Design 把它们统一成一个品牌内核：颜色、字体、语气、影像、规则。',
      },
      {
        title: '生成每一个场景。',
        body: '演示、原型、营销物料、视频。同一个品牌，在任何地方调用。',
      },
    ],
  },
  features: {
    kicker: '核心能力',
    title: '设计需要的一切。',
    titleEm: '开箱即用。',
    brandTitle: '数百套品牌设计系统，内置直用。',
    brandBody:
      '从精选设计系统起步，或沉淀你自己的。颜色、字体、圆角、语气：改一处，所有作品一起重算。',
    brandTry: '试一试：切换品牌或点圆角档位，右侧 4 件成品实时重算。',
    brandIframeTitle: '品牌系统演示',
    badge: '{templates} 套模板 · {systems} 套设计系统',
    livePill: '● LIVE',
    editChips: ['✎ 编辑', '⇲ 缩放', '⧉ 变体'],
    evoLoopPre: '↺ 品牌内核已更新：',
    evoLoopBold: '极简版式 · 圆角 8px · 你的语气',
    cards: [
      {
        title: '满载的模板库',
        body: 'Deck、网站、卡片、视频帧。任意 fork，自动套上你的品牌。',
      },
      {
        title: '设计即代码，一键上线',
        body: 'Design to code：每件产物都是真实 HTML 代码，而不是效果图，直接部署成线上链接。不用交接，不用重写。',
      },
      {
        title: '一切皆可编辑',
        body: '没有一张是死图。生成之后，版式、文案、样式随便改。',
      },
      {
        title: '会自进化的品牌系统',
        body: '每次选择都会回馈到品牌系统和记忆里，下一件作品比上一件更 on-brand。',
      },
      {
        title: '天生多模态',
        body: '网页、Deck、图片、视频、音频。同一个品牌下，一起生成。',
      },
      {
        title: '插件直进 Codex',
        body: '在 Codex 里调用 Open Design，拿回真实可编辑的设计产物。',
      },
    ],
    bench: {
      titlePre: '',
      titleEm: 'Design benchmark',
      titlePost: ' 领先',
      body: '设计任务输出质量业内领先，公开 benchmark 对比 Codex 与 Claude Design。',
      scoreLabel: '设计质量得分',
      dimensions: [
        '综合',
        '网页设计',
        'PPT · 演示',
        '营销物料',
        '移动端 UI',
      ],
    },
  },
  team: {
    kicker: '团队协作',
    title: '一个工作台。',
    titleEm: '整个团队，都在品牌上。',
    body: '品牌系统、模板和项目全团队共享。所有人用同一个内核生成，作品进同一个库，系统一改，全员作品一起重算。',
    chips: ['共享品牌内核', '团队模板库', '发布前 Review'],
    winTitle: 'Open Design 团队工作台',
    membersLine: '12 名成员 · 品牌内核',
    activityPre: 'Mason 更新了内核：',
    activityBold: '3 件作品已重算',
    activityPost: '，已发起 review',
  },
  ways: {
    kicker: '三种使用方式',
    title: '桌面客户端、本地部署，',
    titleEm: '或在 Codex 里。',
    desktop: {
      eyebrow: '完整工作台',
      title: '桌面客户端。',
      body: 'Studio、品牌中心、作品库、记忆。全部在你自己的机器上。',
      cta: '',
    },
    selfHosted: {
      eyebrow: '自己部署',
      title: '本地部署。',
      body: 'Apache-2.0，本地 daemon 和 Web。部署在你自己的内网里。',
      cta: '查看仓库',
    },
    codex: {
      eyebrow: '不打断心流',
      title: 'Codex 插件。',
      body: '装一次，之后在任何 Codex 对话里 ',
      bodyBold: '@open-design',
      bodyPost: '。',
      cta: '在 Codex 安装',
    },
  },
  stories: {
    kicker: '客户故事',
    title: '真实团队，',
    titleEm: '用 Open Design 交付。',
    read: '阅读故事',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: 'KAIST 出身设计师，FABOR 创始人。品牌站和社媒 card-news 都在 Open Design 里做，3D 打印手艺一点没耽误。',
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: 'AI 工程师，Connect I/O 创始人。App 和动效都在这做，模型随他挑。',
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: '美国网络安全公司。整个团队的设计产出，来自一个工作台。',
      },
    ],
  },
  blog: {
    kicker: '来自博客',
    title: '近期亮点。',
    viewAll: '查看全部博客',
  },
};

const ja: HomeRedesignCopy = {
  announce: {
    line: '{release} リリース',
    download: '無料ダウンロード',
  },
  hero: {
    title: 'あなたのブランドのための Vibe Design Workspace。',
    subEm: 'ひとつのデザインシステム',
    subRest: 'が、届けるすべてを貫く。',
    download: '無料ダウンロード',
  },
  tabs: {
    web: 'Web プロトタイプ',
    mobile: 'モバイルアプリ',
    poster: 'マーケ用ポスター',
    slides: 'スライド · PPT',
    video: '動画',
  },
  demo: {
    getApp: 'アプリを入手',
    iframeTitle: 'Open Design ワークスペースのデモ',
  },
  agents: {
    pre: '計 ',
    bold: '21 の coding agent',
    post: ' に対応、つないでそのまま使えます',
  },
  how: {
    kicker: '使い方',
    title: 'ひとつのデザインシステムから。',
    titleEm: 'あらゆるシーンへ。',
    steps: [
      {
        title: 'どんなソースからでも取り込む。',
        body: 'デッキ、サイト、Figma、画像、ドキュメント。ブランドを定義するすべてを投げ込めます。',
      },
      {
        title: 'ブランドをシステム化する。',
        body: 'Open Design がそれらをひとつのブランドカーネルに統合します：色、タイポグラフィ、ボイス、イメージ、ルール。',
      },
      {
        title: 'あらゆるシーンを生成する。',
        body: 'スライド、プロトタイプ、マーケティングビジュアル、動画。同じブランドを、どこからでも呼び出せます。',
      },
    ],
  },
  features: {
    kicker: '主な機能',
    title: 'デザインに必要なすべて。',
    titleEm: 'はじめから内蔵。',
    brandTitle: '数百のブランドシステムを標準搭載。',
    brandBody: '厳選されたデザインシステムから始めても、自分のブランドをシステム化してもいい。色、タイポグラフィ、角丸、ボイス：ひとつ変えれば、すべての成果物が再計算されます。',
    brandTry: '試してみてください：ブランドを切り替えるか、角丸のステップをタップ。4 つの成果物がリアルタイムで再計算されます。',
    brandIframeTitle: 'ブランドシステムのデモ',
    badge: '{templates} テンプレート · {systems} システム',
    livePill: '● LIVE',
    editChips: [
      '✎ 編集',
      '⇲ リサイズ',
      '⧉ バリアント',
    ],
    evoLoopPre: '↺ ブランドカーネル更新：',
    evoLoopBold: 'ミニマルなレイアウト · 角丸 8px · あなたのトーン',
    cards: [
      {
        title: '満載のテンプレートライブラリ',
        body: 'デッキ、サイト、カード、映像フレーム。どれを fork しても、あなたのブランドをまといます。',
      },
      {
        title: 'デザインからコードへ、ワンクリックで公開',
        body: 'ここではデザインはコードです：すべての成果物はモックアップではなく本物の HTML。そのままライブ URL にデプロイでき、ハンドオフも作り直しも不要です。',
      },
      {
        title: 'すべてが編集可能なまま',
        body: '一枚絵は一つもありません。生成後も、レイアウト、コピー、スタイルを自由に調整できます。',
      },
      {
        title: '自己進化するブランドシステム',
        body: 'あなたの選択はすべてブランドシステムとメモリに還元され、成果物は一つごとに、より on-brand に仕上がります。',
      },
      {
        title: 'デフォルトでマルチモーダル',
        body: 'ページ、デッキ、画像、動画、音声。ひとつのブランドの下で、まとめて生成します。',
      },
      {
        title: 'Codex の中で動くプラグイン',
        body: 'Codex から Open Design を呼び出し、フローの中で本物の編集可能な成果物を受け取れます。',
      },
    ],
    bench: {
      titlePre: '',
      titleEm: 'Design benchmark',
      titlePost: ' をリード',
      body: '公開ベンチマークで Codex や Claude Design と比較し、デザインタスクの出力品質は業界トップクラスです。',
      scoreLabel: 'デザイン品質スコア',
      dimensions: [
        '総合',
        'Web デザイン',
        'スライド・PPT',
        'マーケティング素材',
        'モバイル UI',
      ],
    },
  },
  team: {
    kicker: 'Team Workspace',
    title: 'ひとつのワークスペース。',
    titleEm: 'チーム全員が、ブランドの上に。',
    body: 'ブランドシステム、テンプレート、プロジェクトをチーム全体で共有。全員が同じカーネルで生成し、成果物はひとつのライブラリに集まり、システムをひとつ変えれば全員の作業が再計算されます。',
    chips: [
      '共有ブランドカーネル',
      'チームテンプレートライブラリ',
      '公開前レビュー',
    ],
    winTitle: 'Open Design · チームワークスペース',
    membersLine: '12 メンバー · ブランドカーネル',
    activityPre: 'Mason がカーネルを更新：',
    activityBold: '3 件の成果物を再計算',
    activityPost: '、レビューを依頼',
  },
  ways: {
    kicker: '3 つの使い方',
    title: 'デスクトップ、セルフホスト、',
    titleEm: 'そして Codex の中で。',
    desktop: {
      eyebrow: 'フルワークスペース',
      title: 'デスクトップアプリ。',
      body: 'Studio、ブランドセンター、ライブラリ、メモリ。すべてあなたのマシン上に。',
      cta: '',
    },
    selfHosted: {
      eyebrow: '自分で動かす',
      title: 'セルフホスト。',
      body: 'Apache-2.0、ローカル daemon と Web。自社ネットワーク内にデプロイできます。',
      cta: 'repo を見る',
    },
    codex: {
      eyebrow: 'フローを止めない',
      title: 'Codex プラグイン。',
      body: '一度インストールすれば、どの Codex 会話からでも ',
      bodyBold: '@open-design',
      bodyPost: ' を呼び出せます。',
      cta: 'Codex にインストール',
    },
  },
  stories: {
    kicker: '導入事例',
    title: 'Open Design で作られた。',
    titleEm: '実在のチームの手で。',
    read: 'ストーリーを読む',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: 'KAIST 出身のデザイナー、FABOR 創業者。3D プリントのクラフトと並行して、ブランドサイトと SNS カードニュースを制作。',
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: 'AI エンジニア、Connect I/O 創業者。好きなモデルを選んで、アプリもモーショングラフィックスもここで。',
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: '米国のサイバーセキュリティ企業。チーム全体のデザイン成果を、ひとつのワークスペースから。',
      },
    ],
  },
  blog: {
    kicker: 'ブログから',
    title: '最近のハイライト。',
    viewAll: 'ブログ記事をすべて見る',
  },
};

const ko: HomeRedesignCopy = {
  announce: {
    line: '{release} 출시',
    download: '무료 다운로드',
  },
  hero: {
    title: '당신의 브랜드를 위한 Vibe Design Workspace.',
    subEm: '하나의 디자인 시스템',
    subRest: '이 당신이 선보이는 모든 것을 관통합니다.',
    download: '무료 다운로드',
  },
  tabs: {
    web: '웹 프로토타입',
    mobile: '모바일 앱',
    poster: '마케팅 포스터',
    slides: '슬라이드 · PPT',
    video: '비디오',
  },
  demo: {
    getApp: '앱 다운로드',
    iframeTitle: 'Open Design 워크스페이스 데모',
  },
  agents: {
    pre: '총 ',
    bold: '21종 coding agent',
    post: ' 지원, 연결하면 바로 사용',
  },
  how: {
    kicker: '작동 방식',
    title: '하나의 디자인 시스템에서. ',
    titleEm: '모든 장면으로.',
    steps: [
      {
        title: '어떤 소스든 불러오세요.',
        body: '브랜드를 정의하는 모든 것을 넣으세요: 덱, 웹사이트, Figma, 이미지, 문서.',
      },
      {
        title: '브랜드를 시스템으로 만드세요.',
        body: 'Open Design이 이를 하나의 브랜드 커널로 통합합니다: 컬러, 타이포, 보이스, 이미지, 규칙.',
      },
      {
        title: '모든 장면을 생성하세요.',
        body: '슬라이드, 프로토타입, 마케팅 비주얼, 비디오. 하나의 기준 브랜드를 어디서든 호출합니다.',
      },
    ],
  },
  features: {
    kicker: '핵심 기능',
    title: '디자인에 필요한 모든 것. ',
    titleEm: '기본 내장.',
    brandTitle: '수백 개의 브랜드 시스템, 기본 내장.',
    brandBody: '엄선된 디자인 시스템에서 시작하거나 나만의 시스템을 만드세요. 컬러, 타이포, 라운드, 보이스: 하나만 바꾸면 모든 산출물이 다시 계산됩니다.',
    brandTry: '직접 해보세요: 브랜드를 바꾸거나 라운드 단계를 눌러 보세요. 네 개의 산출물이 실시간으로 다시 계산됩니다.',
    brandIframeTitle: '브랜드 시스템 데모',
    badge: '{templates}개 템플릿 · {systems}개 시스템',
    livePill: '● LIVE',
    editChips: [
      '✎ 편집',
      '⇲ 크기 조절',
      '⧉ 배리언트',
    ],
    evoLoopPre: '↺ 브랜드 커널 업데이트: ',
    evoLoopBold: '미니멀 레이아웃 · 라운드 8px · 당신의 톤',
    cards: [
      {
        title: '꽉 채운 템플릿 라이브러리',
        body: '덱, 웹사이트, 카드, 필름 프레임. 무엇이든 fork하면 당신의 브랜드가 입혀집니다.',
      },
      {
        title: '디자인에서 코드로, 클릭 한 번에 라이브',
        body: '여기서 디자인은 곧 코드입니다: 모든 산출물이 목업이 아닌 진짜 HTML이며, 바로 라이브 URL로 배포됩니다. 핸드오프도, 재작업도 없습니다.',
      },
      {
        title: '모든 것이 계속 편집 가능',
        body: '그 무엇도 납작한 이미지가 아닙니다. 생성 후에도 레이아웃, 카피, 스타일을 자유롭게 다듬으세요.',
      },
      {
        title: '스스로 진화하는 브랜드 시스템',
        body: '모든 선택이 브랜드 시스템과 메모리에 반영되어, 산출물이 만들 때마다 더 브랜드다워집니다.',
      },
      {
        title: '기본이 멀티모달',
        body: '페이지, 덱, 이미지, 비디오, 오디오. 하나의 브랜드 아래 함께 생성됩니다.',
      },
      {
        title: 'Codex 안에서 바로, 플러그인',
        body: 'Codex에서 Open Design을 호출하고, 흐름을 벗어나지 않은 채 편집 가능한 진짜 산출물을 받아 보세요.',
      },
    ],
    bench: {
      titlePre: '',
      titleEm: 'Design benchmark',
      titlePost: ' 선두',
      body: '공개 벤치마크에서 Codex, Claude Design과 비교해 디자인 작업의 출력 품질이 최고 수준입니다.',
      scoreLabel: '디자인 품질 점수',
      dimensions: [
        '종합',
        '웹 디자인',
        '슬라이드 · PPT',
        '마케팅 비주얼',
        '모바일 UI',
      ],
    },
  },
  team: {
    kicker: '팀 협업',
    title: '하나의 워크스페이스. ',
    titleEm: '팀 전체가 온브랜드로.',
    body: '브랜드 시스템, 템플릿, 프로젝트를 팀 전체가 공유합니다. 모두가 같은 커널로 생성하고, 산출물은 하나의 라이브러리에 모이며, 시스템을 바꾸면 팀 전원의 작업이 다시 계산됩니다.',
    chips: [
      '공유 브랜드 커널',
      '팀 템플릿 라이브러리',
      '게시 전 리뷰',
    ],
    winTitle: 'Open Design · 팀 워크스페이스',
    membersLine: '멤버 12명 · 브랜드 커널',
    activityPre: 'Mason이 커널을 업데이트: ',
    activityBold: '산출물 3개 재계산됨',
    activityPost: ', 리뷰 요청됨',
  },
  ways: {
    kicker: '세 가지 사용 방식',
    title: '데스크톱, 셀프호스팅, ',
    titleEm: '또는 Codex 안에서.',
    desktop: {
      eyebrow: '완전한 워크스페이스',
      title: '데스크톱 앱.',
      body: 'Studio, 브랜드 센터, 라이브러리, 메모리. 전부 내 컴퓨터에서.',
      cta: '',
    },
    selfHosted: {
      eyebrow: '직접 운영',
      title: '셀프호스팅.',
      body: 'Apache-2.0, 로컬 daemon과 웹. 내 네트워크 안에 직접 배포하세요.',
      cta: '저장소 보기',
    },
    codex: {
      eyebrow: '흐름은 그대로',
      title: 'Codex 플러그인.',
      body: '한 번 설치하면, 어떤 Codex 대화에서든 ',
      bodyBold: '@open-design',
      bodyPost: '을 호출할 수 있습니다.',
      cta: 'Codex에 설치',
    },
  },
  stories: {
    kicker: '고객 스토리',
    title: 'Open Design으로 만들었습니다. ',
    titleEm: '진짜 팀들이.',
    read: '스토리 읽기',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: 'KAIST 출신 디자이너, FABOR 창업자. 브랜드 사이트와 소셜 카드뉴스를 3D 프린팅 작업과 나란히 만듭니다.',
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: 'AI 엔지니어, Connect I/O 창업자. 앱과 모션 그래픽을 원하는 모델로 만듭니다.',
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: '미국 사이버보안 기업. 팀 전체의 디자인 산출물이 하나의 워크스페이스에서 나옵니다.',
      },
    ],
  },
  blog: {
    kicker: '블로그에서',
    title: '최근 하이라이트.',
    viewAll: '블로그 전체 보기',
  },
};

const de: HomeRedesignCopy = {
  announce: {
    line: '{release} ist da',
    download: 'Kostenlos laden',
  },
  hero: {
    title: 'Der Vibe Design Workspace für deine Marke.',
    subEm: 'Ein Designsystem',
    subRest: ' für alles, was du veröffentlichst.',
    download: 'Kostenlos laden',
  },
  tabs: {
    web: 'Web-Prototypen',
    mobile: 'Mobile Apps',
    poster: 'Marketing-Poster',
    slides: 'Slides & PPT',
    video: 'Video',
  },
  demo: {
    getApp: 'App herunterladen',
    iframeTitle: 'Open Design Workspace-Demo',
  },
  agents: {
    pre: 'Funktioniert mit ',
    bold: '21 Coding-Agents',
    post: ' – anschließen und direkt loslegen',
  },
  how: {
    kicker: 'So funktioniert es',
    title: 'Aus einem Designsystem. ',
    titleEm: 'In jedes Szenario.',
    steps: [
      {
        title: 'Speise jede Quelle ein.',
        body: 'Füttere alles ein, was deine Marke definiert: Decks, Websites, Figma, Bilder, Dokumente.',
      },
      {
        title: 'Systematisiere deine Marke.',
        body: 'Open Design vereint alles zu einem Marken-Kernel: Farben, Typografie, Tonalität, Bildwelt, Regeln.',
      },
      {
        title: 'Erstelle jedes Szenario.',
        body: 'Slides, Prototypen, Marketing-Visuals, Video. Eine kanonische Marke, überall abrufbar.',
      },
    ],
  },
  features: {
    kicker: 'Kernfunktionen',
    title: 'Alles, was Design braucht. ',
    titleEm: 'Eingebaut.',
    brandTitle: 'Hunderte Markensysteme, direkt eingebaut.',
    brandBody: 'Starte mit einem kuratierten Designsystem oder systematisiere dein eigenes. Farben, Typografie, Radius, Tonalität: Ändere eine Sache, und jedes Artefakt wird neu berechnet.',
    brandTry: 'Probier es aus: Wechsle die Marke oder tippe auf eine Radius-Stufe. Die vier Artefakte werden live neu berechnet.',
    brandIframeTitle: 'Markensystem-Demo',
    badge: '{templates} Templates · {systems} Systeme',
    livePill: '● LIVE',
    editChips: [
      '✎ Bearbeiten',
      '⇲ Skalieren',
      '⧉ Varianten',
    ],
    evoLoopPre: '↺ Marken-Kernel aktualisiert: ',
    evoLoopBold: 'minimale Layouts · Radius 8px · deine Tonalität',
    cards: [
      {
        title: 'Eine prall gefüllte Template-Bibliothek',
        body: 'Decks, Websites, Karten, Filmframes. Forke ein beliebiges Template, und es übernimmt deine Marke.',
      },
      {
        title: 'Design to Code, live mit einem Klick',
        body: 'Design ist hier Code: Jedes Artefakt ist echtes HTML, kein Mockup. Es deployt direkt auf eine Live-URL. Kein Handoff, kein Neubau.',
      },
      {
        title: 'Alles bleibt editierbar',
        body: 'Nichts ist ein flaches Bild. Passe Layout, Text und Stil nach der Generierung frei an.',
      },
      {
        title: 'Ein Markensystem, das sich selbst weiterentwickelt',
        body: 'Jede Entscheidung fließt zurück in dein Markensystem und dein Gedächtnis, sodass jedes Artefakt noch mehr on-brand landet als das letzte.',
      },
      {
        title: 'Multimodal von Haus aus',
        body: 'Seiten, Decks, Bilder, Video, Audio. Gemeinsam generiert, unter einer Marke.',
      },
      {
        title: 'Plugins, direkt in Codex',
        body: 'Rufe Open Design aus Codex auf und erhalte ein echtes, editierbares Artefakt zurück in deinem Flow.',
      },
    ],
    bench: {
      titlePre: 'Führend im ',
      titleEm: 'Design benchmark',
      titlePost: '',
      body: 'Klassenbeste Ausgabequalität bei Designaufgaben, gemessen am öffentlichen Benchmark gegen Codex und Claude Design.',
      scoreLabel: 'Design-Qualitätsscore',
      dimensions: [
        'Gesamt',
        'Webdesign',
        'Slides & PPT',
        'Marketing-Visuals',
        'Mobile UI',
      ],
    },
  },
  team: {
    kicker: 'Team Workspace',
    title: 'Ein Workspace. ',
    titleEm: 'Das ganze Team, on-brand.',
    body: 'Teile Markensystem, Templates und Projekte im ganzen Team. Alle generieren mit demselben Kernel, jedes Artefakt landet in einer Bibliothek, und eine Änderung am System berechnet die Arbeit aller neu.',
    chips: [
      'Gemeinsamer Marken-Kernel',
      'Team-Template-Bibliothek',
      'Review vor der Veröffentlichung',
    ],
    winTitle: 'Open Design · Team-Workspace',
    membersLine: '12 Mitglieder · Marken-Kernel',
    activityPre: 'Mason hat den Kernel aktualisiert: ',
    activityBold: '3 Artefakte neu berechnet',
    activityPost: ', Review angefragt',
  },
  ways: {
    kicker: 'Drei Wege, es zu nutzen',
    title: 'Desktop, self-hosted ',
    titleEm: 'oder direkt in Codex.',
    desktop: {
      eyebrow: 'VOLLER WORKSPACE',
      title: 'Die Desktop-App.',
      body: 'Studio, Brand Center, Bibliothek, Gedächtnis. Alles auf deinem Rechner.',
      cta: '',
    },
    selfHosted: {
      eyebrow: 'SELBST BETREIBEN',
      title: 'Self-hosted.',
      body: 'Apache-2.0, lokaler Daemon und Web. Deploye im eigenen Netzwerk.',
      cta: 'Repo ansehen',
    },
    codex: {
      eyebrow: 'BLEIB IM FLOW',
      title: 'Das Codex-Plugin.',
      body: 'Einmal installieren, dann ',
      bodyBold: '@open-design',
      bodyPost: ' in jeder Codex-Konversation aufrufen.',
      cta: 'In Codex installieren',
    },
  },
  stories: {
    kicker: 'Kundengeschichten',
    title: 'Gebaut mit Open Design. ',
    titleEm: 'Von echten Teams.',
    read: 'Geschichte lesen',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: 'Designer mit KAIST-Ausbildung, Gründer von FABOR. Markenseite und Social-Card-News, gebaut parallel zu seinem 3D-Druck-Handwerk.',
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: 'AI-Engineer, Gründer von Connect I/O. Apps und Motion Graphics, mit dem Modell seiner Wahl.',
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: 'US-Cybersecurity-Unternehmen. Der Design-Output eines ganzen Teams aus einem Workspace.',
      },
    ],
  },
  blog: {
    kicker: 'Aus dem Blog',
    title: 'Aktuelle Highlights.',
    viewAll: 'Alle Blogposts ansehen',
  },
};

const fr: HomeRedesignCopy = {
  announce: {
    line: '{release} est disponible',
    download: 'Télécharger gratuitement',
  },
  hero: {
    title: 'Le Vibe Design Workspace pour votre marque.',
    subEm: 'Un seul design system',
    subRest: ' pour tout ce que vous livrez.',
    download: 'Télécharger gratuitement',
  },
  tabs: {
    web: 'Prototypes web',
    mobile: 'Apps mobiles',
    poster: 'Affiches marketing',
    slides: 'Slides & PPT',
    video: 'Vidéo',
  },
  demo: {
    getApp: "Télécharger l'app",
    iframeTitle: 'Démo du workspace Open Design',
  },
  agents: {
    pre: 'Compatible avec ',
    bold: '21 agents de code',
    post: ', à brancher et utiliser directement',
  },
  how: {
    kicker: 'Comment ça marche',
    title: "D'un seul design system. ",
    titleEm: 'À toutes vos scènes.',
    steps: [
      {
        title: "Importez depuis n'importe quelle source.",
        body: 'Nourrissez-le de tout ce qui définit votre marque : decks, sites, Figma, images, docs.',
      },
      {
        title: 'Systématisez votre marque.',
        body: 'Open Design unifie le tout en un seul noyau de marque : couleurs, typographie, ton, imagerie, règles.',
      },
      {
        title: 'Créez chaque scène.',
        body: "Slides, prototypes, visuels marketing, vidéo. Une seule marque canonique, appelée depuis n'importe où.",
      },
    ],
  },
  features: {
    kicker: 'Fonctionnalités clés',
    title: 'Tout ce dont le design a besoin. ',
    titleEm: 'Déjà intégré.',
    brandTitle: 'Des centaines de systèmes de marque, intégrés.',
    brandBody: "Partez d'un design system sélectionné ou systématisez le vôtre. Couleurs, typographie, arrondis, ton : changez un élément et chaque artifact se recalcule.",
    brandTry: "Essayez : changez de marque ou touchez un cran d'arrondi. Les quatre artifacts se recalculent en direct.",
    brandIframeTitle: 'Démo du système de marque',
    badge: '{templates} templates · {systems} systèmes',
    livePill: '● LIVE',
    editChips: [
      '✎ Modifier',
      '⇲ Redimensionner',
      '⧉ Variantes',
    ],
    evoLoopPre: '↺ noyau de marque mis à jour : ',
    evoLoopBold: 'layouts minimaux · radius 8px · votre ton',
    cards: [
      {
        title: 'Une bibliothèque de templates bien remplie',
        body: 'Decks, sites, cartes, frames vidéo. Forkez-en un : il adopte votre marque.',
      },
      {
        title: 'Du design au code, en ligne en un clic',
        body: 'Ici, le design est du code : chaque artifact est du vrai HTML, pas une maquette. Il se déploie directement sur une URL live. Pas de handoff, pas de reconstruction.',
      },
      {
        title: 'Tout reste éditable',
        body: "Rien n'est une image figée. Ajustez librement layout, textes et style après génération.",
      },
      {
        title: 'Un système de marque qui évolue tout seul',
        body: 'Chaque choix alimente votre système de marque et sa mémoire : chaque artifact est plus fidèle à la marque que le précédent.',
      },
      {
        title: 'Multimodal par défaut',
        body: 'Pages, decks, images, vidéo, audio. Générés ensemble, sous une seule marque.',
      },
      {
        title: 'Des plugins, directement dans Codex',
        body: 'Appelez Open Design depuis Codex et récupérez un artifact réel et éditable, sans quitter votre flux.',
      },
    ],
    bench: {
      titlePre: 'En tête du ',
      titleEm: 'Design benchmark',
      titlePost: '',
      body: 'Qualité de sortie de premier plan sur les tâches de design, mesurée face à Codex et Claude Design sur le benchmark public.',
      scoreLabel: 'Score de qualité design',
      dimensions: [
        'Global',
        'Design web',
        'Slides & PPT',
        'Visuels marketing',
        'UI mobile',
      ],
    },
  },
  team: {
    kicker: "Team Workspace · Travail d'équipe",
    title: 'Un seul workspace. ',
    titleEm: "Toute l'équipe, fidèle à la marque.",
    body: "Partagez le système de marque, les templates et les projets avec toute l'équipe. Chacun génère avec le même noyau, chaque artifact atterrit dans une seule bibliothèque, et une modification du système recalcule le travail de tous.",
    chips: [
      'Noyau de marque partagé',
      "Bibliothèque de templates d'équipe",
      'Relecture avant publication',
    ],
    winTitle: "Open Design · Workspace d'équipe",
    membersLine: '12 membres · noyau de marque',
    activityPre: 'Mason a mis à jour le noyau : ',
    activityBold: '3 artifacts recalculés',
    activityPost: ', relecture demandée',
  },
  ways: {
    kicker: "Trois façons de l'utiliser",
    title: 'Desktop, auto-hébergé, ',
    titleEm: 'ou dans Codex.',
    desktop: {
      eyebrow: 'WORKSPACE COMPLET',
      title: "L'app desktop.",
      body: 'Studio, centre de marque, bibliothèque, mémoire. Tout sur votre machine.',
      cta: '',
    },
    selfHosted: {
      eyebrow: 'HÉBERGEZ-LE VOUS-MÊME',
      title: 'Auto-hébergé.',
      body: 'Apache-2.0, daemon local et web. Déployez dans votre propre réseau.',
      cta: 'Voir le repo',
    },
    codex: {
      eyebrow: 'RESTEZ DANS VOTRE FLUX',
      title: 'Le plugin Codex.',
      body: 'Installez-le une fois, puis appelez ',
      bodyBold: '@open-design',
      bodyPost: " depuis n'importe quelle conversation Codex.",
      cta: 'Installer dans Codex',
    },
  },
  stories: {
    kicker: 'Témoignages clients',
    title: 'Construit avec Open Design. ',
    titleEm: 'Par de vraies équipes.',
    read: 'Lire le témoignage',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: "Designer formé au KAIST, fondateur de FABOR. Site de marque et card-news pour les réseaux sociaux, menés en parallèle de son artisanat d'impression 3D.",
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: 'Ingénieur IA, fondateur de Connect I/O. Apps et motion design, avec le modèle de son choix.',
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: 'Entreprise américaine de cybersécurité. La production design de toute une équipe depuis un seul workspace.',
      },
    ],
  },
  blog: {
    kicker: 'Sur le blog',
    title: 'Derniers temps forts.',
    viewAll: 'Voir tous les articles du blog',
  },
};

const ru: HomeRedesignCopy = {
  announce: {
    line: '{release} уже доступен',
    download: 'Скачать бесплатно',
  },
  hero: {
    title: 'Vibe Design Workspace для вашего бренда.',
    subEm: 'Одна дизайн-система',
    subRest: ' — для всего, что вы выпускаете.',
    download: 'Скачать бесплатно',
  },
  tabs: {
    web: 'Веб-прототипы',
    mobile: 'Мобильные приложения',
    poster: 'Маркетинговые постеры',
    slides: 'Слайды и PPT',
    video: 'Видео',
  },
  demo: {
    getApp: 'Скачать приложение',
    iframeTitle: 'Демо воркспейса Open Design',
  },
  agents: {
    pre: 'Работает с ',
    bold: '21 кодинг-агентом',
    post: ' — подключайте и пользуйтесь',
  },
  how: {
    kicker: 'Как это работает',
    title: 'Из одной дизайн-системы. ',
    titleEm: 'В каждую сцену.',
    steps: [
      {
        title: 'Загрузите из любого источника.',
        body: 'Скормите всё, что определяет ваш бренд: презентации, сайты, Figma, изображения, документы.',
      },
      {
        title: 'Систематизируйте бренд.',
        body: 'Open Design объединяет всё в одно ядро бренда: цвета, шрифты, голос, изображения, правила.',
      },
      {
        title: 'Создавайте каждую сцену.',
        body: 'Слайды, прототипы, маркетинговые визуалы, видео. Один канонический бренд, доступный откуда угодно.',
      },
    ],
  },
  features: {
    kicker: 'Ключевые возможности',
    title: 'Всё, что нужно дизайну. ',
    titleEm: 'Уже встроено.',
    brandTitle: 'Сотни бренд-систем — уже внутри.',
    brandBody: 'Начните с готовой дизайн-системы из подборки или систематизируйте свою. Цвета, шрифты, скругления, голос: измените одно — и каждый артефакт пересчитается.',
    brandTry: 'Попробуйте: переключите бренд или шаг скругления. Четыре артефакта пересчитаются вживую.',
    brandIframeTitle: 'Демо бренд-системы',
    badge: '{templates} шаблонов · {systems} систем',
    livePill: '● LIVE',
    editChips: [
      '✎ Правка',
      '⇲ Размер',
      '⧉ Варианты',
    ],
    evoLoopPre: '↺ ядро бренда обновлено: ',
    evoLoopBold: 'минималистичные макеты · скругление 8px · ваш тон',
    cards: [
      {
        title: 'Полная библиотека шаблонов',
        body: 'Презентации, сайты, карточки, кадры видео. Сделайте форк любого — и он примет ваш бренд.',
      },
      {
        title: 'Дизайн в код, вживую, в один клик',
        body: 'Дизайн здесь и есть код: каждый артефакт — настоящий HTML, а не макет. Он деплоится сразу на живой URL. Без передачи в разработку, без пересборки.',
      },
      {
        title: 'Всё остаётся редактируемым',
        body: 'Здесь нет плоских картинок. Свободно меняйте макет, текст и стиль после генерации.',
      },
      {
        title: 'Бренд-система, которая эволюционирует сама',
        body: 'Каждый выбор возвращается в бренд-систему и память, и каждый следующий артефакт получается более on-brand, чем предыдущий.',
      },
      {
        title: 'Мультимодальность по умолчанию',
        body: 'Страницы, презентации, изображения, видео, аудио. Генерируются вместе, под одним брендом.',
      },
      {
        title: 'Плагины прямо в Codex',
        body: 'Вызовите Open Design из Codex и получите настоящий редактируемый артефакт, не выходя из потока.',
      },
    ],
    bench: {
      titlePre: 'Лидер ',
      titleEm: 'Design benchmark',
      titlePost: '',
      body: 'Лучшее качество результата в дизайн-задачах — по публичному бенчмарку в сравнении с Codex и Claude Design.',
      scoreLabel: 'Оценка качества дизайна',
      dimensions: [
        'Итого',
        'Веб-дизайн',
        'Слайды и PPT',
        'Маркетинговые визуалы',
        'Мобильный UI',
      ],
    },
  },
  team: {
    kicker: 'Team Workspace · для команды',
    title: 'Один воркспейс. ',
    titleEm: 'Вся команда — в бренде.',
    body: 'Бренд-система, шаблоны и проекты — общие для всей команды. Все генерируют с одним ядром, каждый артефакт попадает в одну библиотеку, а изменение системы пересчитывает работу каждого.',
    chips: [
      'Общее ядро бренда',
      'Командная библиотека шаблонов',
      'Ревью перед публикацией',
    ],
    winTitle: 'Open Design · Командный воркспейс',
    membersLine: '12 участников · ядро бренда',
    activityPre: 'Mason обновил ядро: ',
    activityBold: '3 артефакта пересчитаны',
    activityPost: ', запрошено ревью',
  },
  ways: {
    kicker: 'Три способа использования',
    title: 'Десктоп, self-hosted ',
    titleEm: 'или внутри Codex.',
    desktop: {
      eyebrow: 'ПОЛНЫЙ ВОРКСПЕЙС',
      title: 'Десктоп-приложение.',
      body: 'Studio, центр бренда, библиотека, память. Всё на вашей машине.',
      cta: '',
    },
    selfHosted: {
      eyebrow: 'ЗАПУСТИТЕ У СЕБЯ',
      title: 'Self-hosted.',
      body: 'Apache-2.0, локальный daemon и веб. Разворачивайте внутри своей сети.',
      cta: 'Открыть репозиторий',
    },
    codex: {
      eyebrow: 'ОСТАВАЙТЕСЬ В ПОТОКЕ',
      title: 'Плагин для Codex.',
      body: 'Установите один раз, затем вызывайте ',
      bodyBold: '@open-design',
      bodyPost: ' из любого диалога в Codex.',
      cta: 'Установить в Codex',
    },
  },
  stories: {
    kicker: 'Истории клиентов',
    title: 'Сделано в Open Design. ',
    titleEm: 'Настоящими командами.',
    read: 'Читать историю',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: 'Дизайнер со школой KAIST, основатель FABOR. Бренд-сайт и карточки для соцсетей — параллельно с его ремеслом 3D-печати.',
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: 'AI-инженер, основатель Connect I/O. Приложения и моушн-графика — на любой модели по его выбору.',
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: 'Американская компания в сфере кибербезопасности. Дизайн всей команды — из одного воркспейса.',
      },
    ],
  },
  blog: {
    kicker: 'Из блога',
    title: 'Свежие материалы.',
    viewAll: 'Все посты блога',
  },
};

const es: HomeRedesignCopy = {
  announce: {
    line: '{release} ya está disponible',
    download: 'Descárgalo gratis',
  },
  hero: {
    title: 'El Vibe Design Workspace para tu marca.',
    subEm: 'Un solo sistema de diseño',
    subRest: ' para todo lo que publicas.',
    download: 'Descárgalo gratis',
  },
  tabs: {
    web: 'Prototipos web',
    mobile: 'Apps móviles',
    poster: 'Pósteres de marketing',
    slides: 'Slides y PPT',
    video: 'Vídeo',
  },
  demo: {
    getApp: 'Descargar la app',
    iframeTitle: 'Demo del workspace de Open Design',
  },
  agents: {
    pre: 'Funciona con ',
    bold: '21 coding agents',
    post: ', conéctalos y úsalos directamente',
  },
  how: {
    kicker: 'Cómo funciona',
    title: 'De un solo sistema de diseño. ',
    titleEm: 'A cada escena.',
    steps: [
      {
        title: 'Importa desde cualquier fuente.',
        body: 'Introduce todo lo que define tu marca: decks, sitios web, Figma, imágenes, documentos.',
      },
      {
        title: 'Sistematiza tu marca.',
        body: 'Open Design lo unifica en un solo kernel de marca: colores, tipografía, tono, imágenes, reglas.',
      },
      {
        title: 'Crea cada escena.',
        body: 'Slides, prototipos, visuales de marketing, vídeo. Una sola marca canónica, invocada desde cualquier lugar.',
      },
    ],
  },
  features: {
    kicker: 'Funciones clave',
    title: 'Todo lo que el diseño necesita. ',
    titleEm: 'Integrado.',
    brandTitle: 'Cientos de sistemas de marca, integrados.',
    brandBody: 'Empieza desde un sistema de diseño curado o sistematiza el tuyo. Colores, tipografía, radios, tono: cambia una cosa y cada artifact se recalcula.',
    brandTry: 'Pruébalo: cambia la marca o toca un paso de radio. Los cuatro artifacts se recalculan en vivo.',
    brandIframeTitle: 'Demo del sistema de marca',
    badge: '{templates} plantillas · {systems} sistemas',
    livePill: '● LIVE',
    editChips: [
      '✎ Editar',
      '⇲ Redimensionar',
      '⧉ Variantes',
    ],
    evoLoopPre: '↺ kernel de marca actualizado: ',
    evoLoopBold: 'layouts minimalistas · radio 8px · tu tono',
    cards: [
      {
        title: 'Una biblioteca de plantillas bien surtida',
        body: 'Decks, sitios, tarjetas, fotogramas. Haz fork de cualquiera y adoptan tu marca.',
      },
      {
        title: 'De diseño a código, en vivo con un clic',
        body: 'Aquí el diseño es código: cada artifact es HTML real, no un mockup. Se despliega directo a una URL en vivo. Sin handoff, sin reconstruir.',
      },
      {
        title: 'Todo sigue siendo editable',
        body: 'Nada es una imagen plana. Ajusta layout, textos y estilo con libertad después de generar.',
      },
      {
        title: 'Un sistema de marca que se autoevoluciona',
        body: 'Cada decisión vuelve a alimentar tu sistema de marca y tu memoria, así cada artifact sale más on-brand que el anterior.',
      },
      {
        title: 'Multimodal por defecto',
        body: 'Páginas, decks, imágenes, vídeo, audio. Generados juntos, bajo una sola marca.',
      },
      {
        title: 'Plugins, dentro de Codex',
        body: 'Llama a Open Design desde Codex y recibe un artifact real y editable sin salir del flujo.',
      },
    ],
    bench: {
      titlePre: 'Líder en el ',
      titleEm: 'Design benchmark',
      titlePost: '',
      body: 'Calidad de salida líder en tareas de diseño, medida frente a Codex y Claude Design en el benchmark público.',
      scoreLabel: 'Puntuación de calidad de diseño',
      dimensions: [
        'Global',
        'Diseño web',
        'Slides y PPT',
        'Visuales de marketing',
        'UI móvil',
      ],
    },
  },
  team: {
    kicker: 'Team Workspace',
    title: 'Un solo workspace. ',
    titleEm: 'Todo el equipo, on-brand.',
    body: 'Comparte el sistema de marca, las plantillas y los proyectos con todo tu equipo. Todos generan con el mismo kernel, cada artifact llega a una sola biblioteca y un cambio en el sistema recalcula el trabajo de todos.',
    chips: [
      'Kernel de marca compartido',
      'Biblioteca de plantillas del equipo',
      'Review antes de publicar',
    ],
    winTitle: 'Open Design · Workspace de equipo',
    membersLine: '12 miembros · kernel de marca',
    activityPre: 'Mason actualizó el kernel: ',
    activityBold: '3 artifacts recalculados',
    activityPost: ', review solicitada',
  },
  ways: {
    kicker: 'Tres formas de usarlo',
    title: 'Escritorio, autoalojado, ',
    titleEm: 'o dentro de Codex.',
    desktop: {
      eyebrow: 'WORKSPACE COMPLETO',
      title: 'La app de escritorio.',
      body: 'Studio, centro de marca, biblioteca, memoria. Todo en tu máquina.',
      cta: '',
    },
    selfHosted: {
      eyebrow: 'EJECÚTALO TÚ MISMO',
      title: 'Autoalojado.',
      body: 'Apache-2.0, daemon local y web. Despliégalo dentro de tu propia red.',
      cta: 'Ver el repo',
    },
    codex: {
      eyebrow: 'SIGUE EN TU FLUJO',
      title: 'El plugin de Codex.',
      body: 'Instálalo una vez y luego llama a ',
      bodyBold: '@open-design',
      bodyPost: ' desde cualquier conversación de Codex.',
      cta: 'Instalar en Codex',
    },
  },
  stories: {
    kicker: 'Historias de clientes',
    title: 'Hecho con Open Design. ',
    titleEm: 'Por equipos reales.',
    read: 'Leer la historia',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: 'Diseñador formado en KAIST, fundador de FABOR. Sitio de marca y card-news para redes, en paralelo con su oficio de impresión 3D.',
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: 'Ingeniero de IA, fundador de Connect I/O. Apps y motion graphics, con el modelo que él elija.',
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: 'Empresa de ciberseguridad de EE. UU. La producción de diseño de todo un equipo desde un solo workspace.',
      },
    ],
  },
  blog: {
    kicker: 'Del blog',
    title: 'Lo más reciente.',
    viewAll: 'Ver todas las entradas del blog',
  },
};

const ptBr: HomeRedesignCopy = {
  announce: {
    line: '{release} já está disponível',
    download: 'Baixe grátis',
  },
  hero: {
    title: 'O Vibe Design Workspace para a sua marca.',
    subEm: 'Um único design system',
    subRest: ' em tudo que você entrega.',
    download: 'Baixe grátis',
  },
  tabs: {
    web: 'Protótipos web',
    mobile: 'Apps mobile',
    poster: 'Pôsteres de marketing',
    slides: 'Slides e PPT',
    video: 'Vídeo',
  },
  demo: {
    getApp: 'Baixar o app',
    iframeTitle: 'Demonstração do workspace Open Design',
  },
  agents: {
    pre: 'Funciona com ',
    bold: '21 coding agents',
    post: ', conecte e use na hora',
  },
  how: {
    kicker: 'Como funciona',
    title: 'De um único design system. ',
    titleEm: 'Para cada cenário.',
    steps: [
      {
        title: 'Alimente com qualquer fonte.',
        body: 'Traga tudo o que define a sua marca: decks, sites, Figma, imagens, documentos.',
      },
      {
        title: 'Sistematize sua marca.',
        body: 'O Open Design unifica tudo em um único kernel de marca: cores, tipografia, voz, imagens, regras.',
      },
      {
        title: 'Crie todos os cenários.',
        body: 'Slides, protótipos, peças de marketing, vídeo. Uma única marca canônica, chamada de qualquer lugar.',
      },
    ],
  },
  features: {
    kicker: 'Principais recursos',
    title: 'Tudo que o design precisa. ',
    titleEm: 'Já integrado.',
    brandTitle: 'Centenas de sistemas de marca, prontos para usar.',
    brandBody: 'Comece com um design system curado ou sistematize o seu. Cores, tipografia, raio, voz: mude uma coisa e todo artifact é recalculado.',
    brandTry: 'Experimente: troque a marca ou toque em um passo de raio. Os quatro artifacts recalculam ao vivo.',
    brandIframeTitle: 'Demonstração de sistema de marca',
    badge: '{templates} templates · {systems} sistemas',
    livePill: '● LIVE',
    editChips: [
      '✎ Editar',
      '⇲ Redimensionar',
      '⧉ Variantes',
    ],
    evoLoopPre: '↺ kernel de marca atualizado: ',
    evoLoopBold: 'layouts minimalistas · raio 8px · seu tom de voz',
    cards: [
      {
        title: 'Uma biblioteca cheia de templates',
        body: 'Decks, sites, cards, frames de vídeo. Faça fork de qualquer um e ele assume a sua marca.',
      },
      {
        title: 'Do design ao código, no ar em um clique',
        body: 'Aqui, design é código: cada artifact é HTML de verdade, não um mockup. Publica direto em uma URL ao vivo. Sem handoff, sem retrabalho.',
      },
      {
        title: 'Tudo continua editável',
        body: 'Nada é uma imagem estática. Ajuste layout, texto e estilo à vontade depois da geração.',
      },
      {
        title: 'Um sistema de marca que evolui sozinho',
        body: 'Cada escolha realimenta seu sistema de marca e a memória, então cada artifact sai mais on-brand que o anterior.',
      },
      {
        title: 'Multimodal por padrão',
        body: 'Páginas, decks, imagens, vídeo, áudio. Gerados juntos, sob uma única marca.',
      },
      {
        title: 'Plugins, direto no Codex',
        body: 'Chame o Open Design de dentro do Codex e receba de volta um artifact real e editável, sem sair do fluxo.',
      },
    ],
    bench: {
      titlePre: 'Líder no ',
      titleEm: 'Design benchmark',
      titlePost: '',
      body: 'Qualidade de saída líder em tarefas de design, medida contra Codex e Claude Design no benchmark público.',
      scoreLabel: 'Pontuação de qualidade de design',
      dimensions: [
        'Geral',
        'Design web',
        'Slides e PPT',
        'Visuais de marketing',
        'UI mobile',
      ],
    },
  },
  team: {
    kicker: 'Team Workspace',
    title: 'Um único workspace. ',
    titleEm: 'O time inteiro, on-brand.',
    body: 'Compartilhe o sistema de marca, os templates e os projetos com todo o time. Todos geram com o mesmo kernel, cada artifact vai para uma única biblioteca e uma mudança no sistema recalcula o trabalho de todo mundo.',
    chips: [
      'Kernel de marca compartilhado',
      'Biblioteca de templates do time',
      'Review antes de publicar',
    ],
    winTitle: 'Open Design · Workspace do time',
    membersLine: '12 membros · kernel de marca',
    activityPre: 'Mason atualizou o kernel: ',
    activityBold: '3 artifacts recalculados',
    activityPost: ', review solicitado',
  },
  ways: {
    kicker: 'Três formas de usar',
    title: 'Desktop, self-hosted, ',
    titleEm: 'ou dentro do Codex.',
    desktop: {
      eyebrow: 'WORKSPACE COMPLETO',
      title: 'O app desktop.',
      body: 'Studio, central de marca, biblioteca, memória. Tudo na sua máquina.',
      cta: '',
    },
    selfHosted: {
      eyebrow: 'RODE VOCÊ MESMO',
      title: 'Self-hosted.',
      body: 'Apache-2.0, daemon local e web. Faça deploy dentro da sua própria rede.',
      cta: 'Ver o repo',
    },
    codex: {
      eyebrow: 'SEM SAIR DO FLUXO',
      title: 'O plugin para Codex.',
      body: 'Instale uma vez, depois chame ',
      bodyBold: '@open-design',
      bodyPost: ' em qualquer conversa do Codex.',
      cta: 'Instalar no Codex',
    },
  },
  stories: {
    kicker: 'Histórias de clientes',
    title: 'Feito com Open Design. ',
    titleEm: 'Por times reais.',
    read: 'Ler a história',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: 'Designer formado no KAIST, fundador da FABOR. Site da marca e card-news para redes sociais, feitos em paralelo com seu trabalho artesanal de impressão 3D.',
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: 'Engenheiro de IA, fundador da Connect I/O. Apps e motion graphics, com o modelo que ele escolher.',
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: 'Empresa americana de cibersegurança. A produção de design de um time inteiro saindo de um único workspace.',
      },
    ],
  },
  blog: {
    kicker: 'Do blog',
    title: 'Destaques recentes.',
    viewAll: 'Ver todos os posts do blog',
  },
};

const it: HomeRedesignCopy = {
  announce: {
    line: '{release} è disponibile',
    download: 'Scarica gratis',
  },
  hero: {
    title: 'Il Vibe Design Workspace per il tuo brand.',
    subEm: 'Un solo design system',
    subRest: ' per tutto ciò che pubblichi.',
    download: 'Scarica gratis',
  },
  tabs: {
    web: 'Prototipi web',
    mobile: 'App mobile',
    poster: 'Poster marketing',
    slides: 'Slide e PPT',
    video: 'Video',
  },
  demo: {
    getApp: "Scarica l'app",
    iframeTitle: 'Demo del workspace Open Design',
  },
  agents: {
    pre: 'Funziona con ',
    bold: '21 coding agent',
    post: ': collegali e usali subito',
  },
  how: {
    kicker: 'Come funziona',
    title: 'Da un solo design system. ',
    titleEm: 'A ogni scena.',
    steps: [
      {
        title: 'Importa da qualsiasi fonte.',
        body: 'Dai in pasto tutto ciò che definisce il tuo brand: deck, siti, Figma, immagini, documenti.',
      },
      {
        title: 'Sistematizza il tuo brand.',
        body: 'Open Design unifica tutto in un unico kernel del brand: colori, tipografia, voce, immagini, regole.',
      },
      {
        title: 'Crea ogni scena.',
        body: 'Slide, prototipi, visual di marketing, video. Un solo brand canonico, richiamabile ovunque.',
      },
    ],
  },
  features: {
    kicker: 'Funzionalità chiave',
    title: 'Tutto ciò che serve al design. ',
    titleEm: 'Già integrato.',
    brandTitle: 'Centinaia di brand system, già integrati.',
    brandBody: 'Parti da un design system curato o sistematizza il tuo. Colori, tipografia, raggi, voce: cambia una cosa e ogni artifact si ricalcola.',
    brandTry: 'Provalo: cambia brand o tocca un livello di raggio. I quattro artifact si ricalcolano in tempo reale.',
    brandIframeTitle: 'Demo del brand system',
    badge: '{templates} template · {systems} sistemi',
    livePill: '● LIVE',
    editChips: [
      '✎ Modifica',
      '⇲ Ridimensiona',
      '⧉ Varianti',
    ],
    evoLoopPre: '↺ kernel del brand aggiornato: ',
    evoLoopBold: 'layout minimali · raggio 8px · il tuo tono',
    cards: [
      {
        title: 'Una libreria di template ben fornita',
        body: 'Deck, siti, card, fotogrammi video. Fai fork di uno qualsiasi e prende il tuo brand.',
      },
      {
        title: 'Dal design al codice, live in un clic',
        body: 'Qui il design è codice: ogni artifact è vero HTML, non un mockup. Si deploya direttamente su un URL live. Niente handoff, niente rifacimenti.',
      },
      {
        title: 'Tutto resta modificabile',
        body: "Niente è un'immagine piatta. Dopo la generazione ritocchi layout, testi e stile in libertà.",
      },
      {
        title: 'Un brand system che si auto-evolve',
        body: 'Ogni scelta torna nel tuo brand system e nella memoria, così ogni artifact è più on-brand del precedente.',
      },
      {
        title: 'Multimodale di default',
        body: 'Pagine, deck, immagini, video, audio. Generati insieme, sotto un unico brand.',
      },
      {
        title: 'Plugin, direttamente dentro Codex',
        body: 'Chiama Open Design da Codex e ricevi un artifact reale e modificabile senza uscire dal flusso.',
      },
    ],
    bench: {
      titlePre: 'In testa al ',
      titleEm: 'Design benchmark',
      titlePost: '',
      body: 'Qualità di output ai vertici nei task di design, misurata rispetto a Codex e Claude Design sul benchmark pubblico.',
      scoreLabel: 'Punteggio di qualità del design',
      dimensions: [
        'Totale',
        'Web design',
        'Slide e PPT',
        'Visual di marketing',
        'UI mobile',
      ],
    },
  },
  team: {
    kicker: 'Team Workspace',
    title: 'Un solo workspace. ',
    titleEm: 'Tutto il team, on-brand.',
    body: "Condividi brand system, template e progetti con tutto il team. Tutti generano con lo stesso kernel, ogni artifact finisce in un'unica libreria e una modifica al sistema ricalcola il lavoro di tutti.",
    chips: [
      'Kernel del brand condiviso',
      'Libreria template del team',
      'Review prima della pubblicazione',
    ],
    winTitle: 'Open Design · Workspace del team',
    membersLine: '12 membri · kernel del brand',
    activityPre: 'Mason ha aggiornato il kernel: ',
    activityBold: '3 artifact ricalcolati',
    activityPost: ', review richiesta',
  },
  ways: {
    kicker: 'Tre modi per usarlo',
    title: 'Desktop, self-hosted ',
    titleEm: 'o dentro Codex.',
    desktop: {
      eyebrow: 'WORKSPACE COMPLETO',
      title: "L'app desktop.",
      body: 'Studio, centro brand, libreria, memoria. Tutto sulla tua macchina.',
      cta: '',
    },
    selfHosted: {
      eyebrow: 'FALLO GIRARE TU',
      title: 'Self-hosted.',
      body: 'Apache-2.0, daemon locale e web. Fai il deploy nella tua rete.',
      cta: 'Vedi il repo',
    },
    codex: {
      eyebrow: 'RESTA NEL TUO FLUSSO',
      title: 'Il plugin per Codex.',
      body: 'Installa una volta, poi chiama ',
      bodyBold: '@open-design',
      bodyPost: ' da qualsiasi conversazione Codex.',
      cta: 'Installa in Codex',
    },
  },
  stories: {
    kicker: 'Storie dei clienti',
    title: 'Costruito con Open Design. ',
    titleEm: 'Da team reali.',
    read: 'Leggi la storia',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: 'Designer formato al KAIST, fondatore di FABOR. Sito del brand e card-news per i social, costruiti in parallelo al suo artigianato di stampa 3D.',
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: 'Ingegnere AI, fondatore di Connect I/O. App e motion graphics, con il modello che preferisce.',
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: 'Azienda statunitense di cybersecurity. La produzione di design di un intero team da un solo workspace.',
      },
    ],
  },
  blog: {
    kicker: 'Dal blog',
    title: 'Ultimi highlight.',
    viewAll: 'Vedi tutti gli articoli del blog',
  },
};

const tr: HomeRedesignCopy = {
  announce: {
    line: '{release} yayında',
    download: 'Ücretsiz indir',
  },
  hero: {
    title: 'Markan için Vibe Design Workspace.',
    subEm: 'Tek bir tasarım sistemi',
    subRest: ', teslim ettiğin her şeyde.',
    download: 'Ücretsiz indir',
  },
  tabs: {
    web: 'Web prototipleri',
    mobile: 'Mobil uygulamalar',
    poster: 'Pazarlama afişleri',
    slides: 'Slayt & PPT',
    video: 'Video',
  },
  demo: {
    getApp: 'Uygulamayı indir',
    iframeTitle: 'Open Design çalışma alanı demosu',
  },
  agents: {
    pre: 'Desteklenen ',
    bold: '21 coding agent',
    post: ', tak ve doğrudan kullan',
  },
  how: {
    kicker: 'Nasıl çalışır',
    title: 'Tek bir tasarım sisteminden. ',
    titleEm: 'Her sahneye.',
    steps: [
      {
        title: 'Her kaynaktan içeri al.',
        body: "Markanı tanımlayan her şeyi içeri at: deck'ler, siteler, Figma, görseller, dokümanlar.",
      },
      {
        title: 'Markanı sisteme dönüştür.',
        body: 'Open Design hepsini tek bir marka çekirdeğinde birleştirir: renkler, tipografi, ses tonu, görsel dil, kurallar.',
      },
      {
        title: 'Her sahneyi üret.',
        body: 'Slaytlar, prototipler, pazarlama görselleri, video. Tek bir kanonik marka, her yerden çağrılır.',
      },
    ],
  },
  features: {
    kicker: 'Temel özellikler',
    title: 'Tasarımın ihtiyacı olan her şey. ',
    titleEm: 'Yerleşik.',
    brandTitle: 'Yüzlerce marka sistemi, yerleşik olarak hazır.',
    brandBody: "Seçilmiş bir tasarım sisteminden başla ya da kendi markanı sisteme dönüştür. Renkler, tipografi, köşe yarıçapı, ses tonu: bir şeyi değiştir, tüm artifact'ler yeniden hesaplanır.",
    brandTry: 'Dene: markayı değiştir ya da bir yarıçap adımına dokun. Dört artifact canlı olarak yeniden hesaplanır.',
    brandIframeTitle: 'Marka sistemi demosu',
    badge: '{templates} şablon · {systems} sistem',
    livePill: '● LIVE',
    editChips: [
      '✎ Düzenle',
      '⇲ Boyutlandır',
      '⧉ Varyantlar',
    ],
    evoLoopPre: '↺ marka çekirdeği güncellendi: ',
    evoLoopBold: 'minimal düzenler · yarıçap 8px · senin ses tonun',
    cards: [
      {
        title: 'Dolu bir şablon kütüphanesi',
        body: "Deck'ler, siteler, kartlar, film kareleri. Herhangi birini fork'la, markana bürünsün.",
      },
      {
        title: 'Tasarımdan koda, tek tıkla canlıda',
        body: "Burada tasarım koddur: her artifact gerçek HTML'dir, mockup değil. Doğrudan canlı bir URL'ye deploy olur. Devir teslim yok, yeniden yazmak yok.",
      },
      {
        title: 'Her şey düzenlenebilir kalır',
        body: 'Hiçbir şey düz bir görsel değil. Üretimden sonra düzeni, metni ve stili dilediğin gibi değiştir.',
      },
      {
        title: 'Kendi kendine evrilen bir marka sistemi',
        body: 'Her seçim marka sistemine ve hafızaya geri beslenir; her yeni artifact markana bir öncekinden daha çok oturur.',
      },
      {
        title: 'Varsayılan olarak multimodal',
        body: "Sayfalar, deck'ler, görseller, video, ses. Tek bir marka altında, birlikte üretilir.",
      },
      {
        title: 'Eklentiler, doğrudan Codex içinde',
        body: "Codex'ten Open Design'ı çağır, akışın içinde gerçek, düzenlenebilir bir artifact geri al.",
      },
    ],
    bench: {
      titlePre: '',
      titleEm: 'Design benchmark',
      titlePost: ' lideri',
      body: 'Tasarım görevlerinde sınıfının en iyi çıktı kalitesi; herkese açık benchmark üzerinde Codex ve Claude Design ile karşılaştırıldı.',
      scoreLabel: 'Tasarım kalite puanı',
      dimensions: [
        'Genel',
        'Web tasarımı',
        'Slayt ve PPT',
        'Pazarlama görselleri',
        'Mobil UI',
      ],
    },
  },
  team: {
    kicker: 'Team Workspace · Ekip çalışması',
    title: 'Tek bir çalışma alanı. ',
    titleEm: 'Bütün ekip, marka çizgisinde.',
    body: 'Marka sistemini, şablonları ve projeleri tüm ekiple paylaş. Herkes aynı çekirdekle üretir, her artifact tek bir kütüphaneye düşer ve sistemde yapılan bir değişiklik herkesin işini yeniden hesaplar.',
    chips: [
      'Paylaşılan marka çekirdeği',
      'Ekip şablon kütüphanesi',
      'Yayından önce review',
    ],
    winTitle: 'Open Design · Ekip çalışma alanı',
    membersLine: '12 üye · marka çekirdeği',
    activityPre: 'Mason çekirdeği güncelledi: ',
    activityBold: '3 artifact yeniden hesaplandı',
    activityPost: ', review istendi',
  },
  ways: {
    kicker: 'Üç kullanım yolu',
    title: 'Masaüstü, self-hosted, ',
    titleEm: "ya da Codex'in içinde.",
    desktop: {
      eyebrow: 'TAM ÇALIŞMA ALANI',
      title: 'Masaüstü uygulaması.',
      body: 'Studio, marka merkezi, kütüphane, hafıza. Hepsi kendi makinende.',
      cta: '',
    },
    selfHosted: {
      eyebrow: 'KENDİN ÇALIŞTIR',
      title: 'Self-hosted.',
      body: 'Apache-2.0, yerel daemon ve web. Kendi ağının içine deploy et.',
      cta: "Repo'ya göz at",
    },
    codex: {
      eyebrow: 'AKIŞINDAN ÇIKMA',
      title: 'Codex eklentisi.',
      body: 'Bir kez kur, sonra herhangi bir Codex konuşmasında ',
      bodyBold: '@open-design',
      bodyPost: ' yaz.',
      cta: "Codex'e kur",
    },
  },
  stories: {
    kicker: 'Müşteri hikâyeleri',
    title: 'Open Design ile üretildi. ',
    titleEm: 'Gerçek ekipler tarafından.',
    read: 'Hikâyeyi oku',
    cards: [
      {
        quote: '“My hands stay on the craft”',
        name: 'Seungki Kim',
        desc: "KAIST mezunu tasarımcı, FABOR'un kurucusu. Marka sitesi ve sosyal medya card-news'leri, 3D baskı zanaatıyla paralel yürüyor.",
      },
      {
        quote: '“I go to Open Design first”',
        name: 'Stuart Gardoll',
        desc: "AI mühendisi, Connect I/O'nun kurucusu. Uygulamalar ve motion graphics, seçtiği herhangi bir modelle.",
      },
      {
        quote: '“Open Design is our unfair advantage”',
        name: 'Ikigai One',
        desc: "ABD'li siber güvenlik şirketi. Bütün bir ekibin tasarım üretimi, tek bir çalışma alanından.",
      },
    ],
  },
  blog: {
    kicker: 'Blogdan',
    title: 'Son öne çıkanlar.',
    viewAll: 'Tüm blog yazılarını gör',
  },
};

const TABLE: Partial<Record<LandingLocaleCode, HomeRedesignCopy>> = {
  en,
  zh,
  ja,
  ko,
  de,
  fr,
  ru,
  es,
  'pt-br': ptBr,
  it,
  tr,
};

export function getHomeRedesignCopy(locale: LandingLocaleCode): HomeRedesignCopy {
  return TABLE[locale] ?? en;
}

/*
 * Browser runtime for the workspace demo's artifacts, emitted verbatim to
 * `public/home-redesign/artifacts.js` by `../build-home-demo.ts`.
 *
 * It lives here as a TypeScript module exporting its source, rather than as a
 * loose `.js` file, because everything project-owned in this repo is
 * TypeScript-first (see `scripts/guard.ts`). The body below is plain ES5-era
 * browser JavaScript on purpose: the demo document loads it as a classic
 * script, with no bundler in the path.
 */

export const ARTIFACTS_RUNTIME_JS = String.raw`/*
 * Token-driven artifacts for the homepage workspace demo.
 *
 * The demo has to carry the product's core claim: one design system, every
 * artifact. So each layout below is a real composition of its kind - a poster
 * that fills its sheet, an app screen with a tab bar, a deck slide with a data
 * panel - built ONLY from design tokens (--ds-bg / --ds-fg / --ds-accent /
 * --ds-radius / --ds-font-*). No brand-specific markup, no images: switching
 * the design system re-renders the same piece in that brand's language.
 *
 * Tokens come from 'design-systems/<slug>/tokens.css' in this repo, the same
 * files an agent hands a model when it generates real work.
 */

(function (global) {
  var COPY = {
    en: {
      web: {
        eyebrow: 'Spring release',
        title: 'Everything you ship,\non brand.',
        body: 'One design system drives the site, the deck, the campaign and the app.',
        cta: 'Start free',
        ghost: 'Book a demo',
        nav: ['Product', 'Systems', 'Pricing', 'Docs'],
        stats: [['4.9k', 'teams'], ['128', 'systems'], ['12m', 'artifacts']],
        trust: 'Trusted by design teams at',
        panel: 'Brand kernel',
        panelMeta: 'colour · type · radius · voice',
      },
      mobile: {
        brand: 'Studio',
        greeting: 'Good morning, Mia',
        heroLabel: 'Today',
        heroTitle: 'Launch deck',
        heroMeta: '12 slides · updated 2m ago',
        segments: ['Recent', 'Shared', 'Drafts'],
        rows: [
          ['Campaign page', 'Web · in review'],
          ['Story cards', 'Social · 6 items'],
        ],
        cta: 'New artifact',
        tabs: ['Home', 'Library', 'Brand', 'You'],
      },
      poster: {
        edition: 'Edition 01',
        kicker: 'Open Design presents',
        title: 'ONE\nSYSTEM.\nEVERY\nSCENE.',
        body: 'Web, decks, posters and product UI - rendered from a single brand kernel.',
        meta: [['Fri 12 Sep', 'Doors 19:00'], ['Warehouse 5', 'Shanghai'], ['Free', 'RSVP required']],
        cta: 'Get a ticket',
        side: 'open-design.ai',
      },
      video: {
        kicker: 'Open Design',
        sub: 'Launch film · 2026',
        badge: 'REC',
        track: ['Type in', 'Logo wipe', 'End card'],
        shots: [
          { timecode: '00:02:04', title: 'EVERY SCENE.\nONE SYSTEM.' },
          { timecode: '00:04:18', wordmark: 'Open Design', tagline: 'The Vibe Design Workspace' },
          { timecode: '00:06:22', title: 'START FREE', url: 'open-design.ai', cta: 'Download' },
        ],
      },
      slides: {
        kicker: 'Q3 review',
        title: 'Where the brand\ngoes next',
        bullets: [
          ['One kernel', 'Every surface renders from the same tokens.'],
          ['Tokens over screenshots', 'Design ships as code, not as a picture.'],
          ['No handoff', 'The artifact is the deliverable.'],
        ],
        statValue: '3.4x',
        statLabel: 'faster to ship',
        chartLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
        footer: 'Open Design · Q3 2026',
        note: '04 / 12',
      },
    },
    zh: {
      web: {
        eyebrow: '春季版本',
        title: '你交付的一切，\n都在品牌上。',
        body: '一套设计系统，驱动官网、Deck、营销与 App。',
        cta: '免费开始',
        ghost: '预约演示',
        nav: ['产品', '设计系统', '价格', '文档'],
        stats: [['4.9k', '团队'], ['128', '设计系统'], ['12m', '作品']],
        trust: '这些设计团队在用',
        panel: '品牌内核',
        panelMeta: '色彩 · 字体 · 圆角 · 语气',
      },
      mobile: {
        brand: 'Studio',
        greeting: '早上好，Mia',
        heroLabel: '今天',
        heroTitle: '发布 Deck',
        heroMeta: '12 页 · 2 分钟前更新',
        segments: ['最近', '共享', '草稿'],
        rows: [
          ['活动落地页', '网页 · 审核中'],
          ['故事卡片', '社媒 · 6 张'],
        ],
        cta: '新建产物',
        tabs: ['首页', '作品库', '品牌', '我的'],
      },
      poster: {
        edition: '第 01 期',
        kicker: 'Open Design 呈现',
        title: '一套系统。\n所有场景。',
        body: '网页、Deck、海报、产品界面，全部由同一个品牌内核渲染。',
        meta: [['9 月 12 日 周五', '19:00 入场'], ['5 号仓库', '上海'], ['免费', '需预约']],
        cta: '领取入场券',
        side: 'open-design.ai',
      },
      video: {
        kicker: 'Open Design',
        sub: '发布短片 · 2026',
        badge: 'REC',
        track: ['字幕入场', 'Logo 擦除', '尾板'],
        shots: [
          { timecode: '00:02:04', title: '所有场景。\n一套系统。' },
          { timecode: '00:04:18', wordmark: 'Open Design', tagline: 'Vibe Design Workspace' },
          { timecode: '00:06:22', title: '免费开始', url: 'open-design.ai', cta: '下载' },
        ],
      },
      slides: {
        kicker: 'Q3 复盘',
        title: '品牌的\n下一步',
        bullets: [
          ['一个内核', '所有触点都由同一套 token 渲染。'],
          ['用 token，不用截图', '设计以代码交付，而不是图片。'],
          ['无需交接', '产物本身就是交付物。'],
        ],
        statValue: '3.4x',
        statLabel: '交付提速',
        chartLabels: ['Q1', 'Q2', 'Q3', 'Q4'],
        footer: 'Open Design · 2026 Q3',
        note: '04 / 12',
      },
    },
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function lines(host, value) {
    String(value).split('\n').forEach(function (line, i) {
      if (i) host.appendChild(document.createElement('br'));
      host.appendChild(document.createTextNode(line));
    });
    return host;
  }

  /* Marketing site: hero with a kernel panel, stat strip, trust row. */
  function web(t) {
    var root = el('div', 'af af-web');

    var nav = el('div', 'af-nav');
    nav.appendChild(el('span', 'af-logo', 'ACME'));
    var links = el('span', 'af-links');
    t.nav.forEach(function (n) { links.appendChild(el('i', null, n)); });
    nav.appendChild(links);
    nav.appendChild(el('span', 'af-btn af-btn-sm', t.cta));
    root.appendChild(nav);

    var hero = el('div', 'af-hero');
    var copy = el('div', 'af-hero-copy');
    copy.appendChild(el('span', 'af-eyebrow', t.eyebrow));
    copy.appendChild(lines(el('h1', 'af-h1'), t.title));
    copy.appendChild(el('p', 'af-body', t.body));
    var row = el('div', 'af-row');
    row.appendChild(el('span', 'af-btn', t.cta));
    row.appendChild(el('span', 'af-ghost', t.ghost));
    copy.appendChild(row);
    hero.appendChild(copy);

    /* The hero visual is the brand kernel itself: swatches, type ramp and a
       radius sample, so the artifact shows the tokens it was built from. */
    var panel = el('div', 'af-panel');
    var head = el('div', 'af-panel-head');
    head.appendChild(el('b', null, t.panel));
    head.appendChild(el('span', 'af-panel-dot'));
    panel.appendChild(head);
    var sw = el('div', 'af-swatches');
    ['accent', 'fg', 'surface'].forEach(function (role) {
      sw.appendChild(el('i', 'af-sw af-sw-' + role));
    });
    panel.appendChild(sw);
    var ramp = el('div', 'af-ramp');
    ['Aa', 'Aa', 'Aa'].forEach(function (a, i) {
      ramp.appendChild(el('span', 'af-ramp-' + (i + 1), a));
    });
    panel.appendChild(ramp);
    panel.appendChild(el('span', 'af-panel-meta', t.panelMeta));
    hero.appendChild(panel);
    root.appendChild(hero);

    var stats = el('div', 'af-stats');
    t.stats.forEach(function (s) {
      var cell = el('div', 'af-stat-cell');
      cell.appendChild(el('b', null, s[0]));
      cell.appendChild(el('span', null, s[1]));
      stats.appendChild(cell);
    });
    root.appendChild(stats);

    var trust = el('div', 'af-trust');
    trust.appendChild(el('span', 'af-trust-label', t.trust));
    ['◆', '●', '▲', '■'].forEach(function (mark) {
      trust.appendChild(el('i', 'af-mark', mark));
    });
    root.appendChild(trust);
    return root;
  }

  /* Product UI: status bar, hero card, segmented control, list, tab bar. */
  function mobile(t) {
    var root = el('div', 'af af-mobile');
    var phone = el('div', 'af-phone');

    var status = el('div', 'af-status');
    status.appendChild(el('span', null, '9:41'));
    status.appendChild(el('span', 'af-status-dots'));
    phone.appendChild(status);

    var head = el('div', 'af-app-head');
    var headCopy = el('div', null);
    headCopy.appendChild(el('span', 'af-app-brand', t.brand));
    headCopy.appendChild(el('b', 'af-app-greet', t.greeting));
    head.appendChild(headCopy);
    head.appendChild(el('span', 'af-avatar'));
    phone.appendChild(head);

    var card = el('div', 'af-appcard');
    card.appendChild(el('span', 'af-appcard-label', t.heroLabel));
    card.appendChild(el('b', 'af-appcard-title', t.heroTitle));
    card.appendChild(el('span', 'af-appcard-meta', t.heroMeta));
    var prog = el('span', 'af-appcard-prog');
    prog.appendChild(el('i', null, ''));
    card.appendChild(prog);
    phone.appendChild(card);

    var seg = el('div', 'af-seg');
    t.segments.forEach(function (s, i) {
      seg.appendChild(el('span', i === 0 ? 'on' : null, s));
    });
    phone.appendChild(seg);

    t.rows.forEach(function (r) {
      var row = el('div', 'af-listrow');
      row.appendChild(el('span', 'af-thumb'));
      var col = el('span', 'af-listcol');
      col.appendChild(el('b', null, r[0]));
      col.appendChild(el('span', null, r[1]));
      row.appendChild(col);
      row.appendChild(el('span', 'af-chev', '›'));
      phone.appendChild(row);
    });

    phone.appendChild(el('div', 'af-btn af-btn-block', t.cta));

    var tabs = el('div', 'af-tabs');
    t.tabs.forEach(function (label, i) {
      var tab = el('span', i === 0 ? 'on' : null);
      tab.appendChild(el('i', null, ''));
      tab.appendChild(el('u', null, label));
      tabs.appendChild(tab);
    });
    phone.appendChild(tabs);

    root.appendChild(phone);
    return root;
  }

  /* Marketing poster: accent field, display type filling the sheet, an event
     metadata band and a ticket CTA. Posters use the whole sheet. */
  function poster(t) {
    var root = el('div', 'af af-poster');
    var sheet = el('div', 'af-sheet');

    var top = el('div', 'af-sheet-top');
    var topbar = el('div', 'af-sheet-bar');
    topbar.appendChild(el('span', null, t.kicker));
    topbar.appendChild(el('span', null, t.edition));
    top.appendChild(topbar);
    top.appendChild(lines(el('h1', 'af-poster-title'), t.title));
    top.appendChild(el('span', 'af-poster-badge', '★'));
    sheet.appendChild(top);

    var bottom = el('div', 'af-sheet-bottom');
    bottom.appendChild(el('p', 'af-poster-body', t.body));
    var meta = el('div', 'af-poster-meta');
    t.meta.forEach(function (m) {
      var cell = el('div', null);
      cell.appendChild(el('b', null, m[0]));
      cell.appendChild(el('span', null, m[1]));
      meta.appendChild(cell);
    });
    bottom.appendChild(meta);
    var foot = el('div', 'af-poster-foot');
    foot.appendChild(el('span', 'af-btn', t.cta));
    foot.appendChild(el('span', 'af-poster-url', t.side));
    bottom.appendChild(foot);
    sheet.appendChild(bottom);

    root.appendChild(sheet);
    return root;
  }

  /* Deck slide: editorial left column, accent data panel on the right. */
  function slides(t) {
    var root = el('div', 'af af-slides');
    var slide = el('div', 'af-slide');

    var main = el('div', 'af-slide-main');
    main.appendChild(el('span', 'af-eyebrow', t.kicker));
    main.appendChild(lines(el('h1', 'af-slide-title'), t.title));
    var list = el('ul', 'af-bullets');
    t.bullets.forEach(function (b, i) {
      var li = document.createElement('li');
      li.appendChild(el('i', null, String(i + 1).length === 1 ? '0' + (i + 1) : String(i + 1)));
      var col = el('span', null);
      col.appendChild(el('b', null, b[0]));
      col.appendChild(el('span', null, b[1]));
      li.appendChild(col);
      list.appendChild(li);
    });
    main.appendChild(list);
    slide.appendChild(main);

    var side = el('div', 'af-slide-side');
    side.appendChild(el('b', 'af-slide-stat', t.statValue));
    side.appendChild(el('span', 'af-slide-statlabel', t.statLabel));
    var chart = el('div', 'af-chart');
    [40, 58, 74, 100].forEach(function (h, i) {
      var col = el('span', null);
      var bar = el('i', i === 3 ? 'on' : null);
      bar.style.height = h + '%';
      col.appendChild(bar);
      col.appendChild(el('u', null, t.chartLabels[i]));
      chart.appendChild(col);
    });
    side.appendChild(chart);
    slide.appendChild(side);

    var foot = el('div', 'af-slide-foot');
    foot.appendChild(el('span', null, t.footer));
    foot.appendChild(el('span', null, t.note));
    slide.appendChild(foot);

    root.appendChild(slide);
    return root;
  }

  /*
   * Motion frame: a three-shot title sequence. Each shot is its own
   * composition (type in / logo wipe / end card) rendered from the same
   * tokens; the film auto-advances and the timeline can be scrubbed, because
   * a strip you cannot play is set dressing, not a video artifact.
   */
  function video(t) {
    var root = el('div', 'af af-video');
    var stage = el('div', 'af-frame');

    var bar = el('div', 'af-frame-bar');
    var shotLabel = el('span', null, '');
    bar.appendChild(shotLabel);
    var rec = el('span', 'af-rec');
    rec.appendChild(el('i', null, ''));
    rec.appendChild(document.createTextNode(t.badge));
    bar.appendChild(rec);
    stage.appendChild(bar);

    var center = el('div', 'af-frame-center');
    stage.appendChild(center);

    var foot = el('div', 'af-frame-foot');
    foot.appendChild(el('span', null, t.sub));
    var tc = el('span', 'af-frame-tc', '');
    foot.appendChild(tc);
    stage.appendChild(foot);
    root.appendChild(stage);

    var track = el('div', 'af-track');
    var cells = t.track.map(function (label, i) {
      var cell = el('span', null);
      var fill = el('i', null, '');
      fill.appendChild(el('u', 'af-track-fill', ''));
      cell.appendChild(fill);
      cell.appendChild(el('u', 'af-track-label', label));
      cell.addEventListener('click', function () { play(i, true); });
      track.appendChild(cell);
      return cell;
    });
    root.appendChild(track);

    /* Shot 01: the type card. */
    function shotType(shot) {
      var wrap = el('div', 'af-shot');
      wrap.appendChild(el('span', 'af-frame-kicker', t.kicker));
      var h1 = el('h1', 'af-frame-title');
      String(shot.title).split('\n').forEach(function (line, i) {
        var row = el('span', 'af-frame-line');
        row.style.animationDelay = (0.1 + i * 0.16) + 's';
        row.textContent = line;
        h1.appendChild(row);
      });
      wrap.appendChild(h1);
      wrap.appendChild(el('span', 'af-frame-wipe'));
      wrap.appendChild(el('span', 'af-frame-sub', t.sub));
      return wrap;
    }

    /* Shot 02: the mark, revealed by an accent wipe. */
    function shotLogo(shot) {
      var wrap = el('div', 'af-shot af-shot-logo');
      var mark = el('span', 'af-mark-badge');
      mark.appendChild(el('i', null, ''));
      wrap.appendChild(mark);
      wrap.appendChild(el('b', 'af-wordmark', shot.wordmark));
      wrap.appendChild(el('span', 'af-frame-sub', shot.tagline));
      wrap.appendChild(el('span', 'af-wipe-sheet'));
      return wrap;
    }

    /* Shot 03: the end card, on an accent field. */
    function shotEnd(shot) {
      var wrap = el('div', 'af-shot af-shot-end');
      var h1 = el('h1', 'af-frame-title af-end-title');
      h1.appendChild(el('span', 'af-frame-line', shot.title));
      wrap.appendChild(h1);
      var row = el('div', 'af-end-row');
      row.appendChild(el('span', 'af-btn', shot.cta));
      row.appendChild(el('span', 'af-end-url', shot.url));
      wrap.appendChild(row);
      return wrap;
    }

    var BUILD = [shotType, shotLogo, shotEnd];
    var index = 0;
    var timer = null;
    var reduce = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}

    function play(i, manual) {
      index = i % BUILD.length;
      var shot = t.shots[index];
      center.innerHTML = '';
      center.appendChild(BUILD[index](shot));
      stage.classList.toggle('af-frame-accent', index === 2);
      shotLabel.textContent = (index + 1 < 10 ? '0' : '') + (index + 1) + ' / 0' + BUILD.length;
      tc.textContent = shot.timecode;
      cells.forEach(function (cell, ci) {
        cell.className = ci === index ? 'on' : ci < index ? 'done' : '';
      });
      if (timer) { clearTimeout(timer); timer = null; }
      if (!reduce) {
        timer = setTimeout(function () { play(index + 1, false); }, manual ? 4200 : 3400);
        global.__odFilmTimer = timer;
      }
    }

    play(0, false);
    return root;
  }

  var RENDER = { web: web, mobile: mobile, poster: poster, slides: slides, video: video };

  global.ODArtifacts = {
    /* Paint the scene's artifact into mount, in the demo's locale. */
    render: function (mount, scene, locale) {
      // A previous film keeps its own timer; stop it before repainting.
      if (global.__odFilmTimer) {
        clearTimeout(global.__odFilmTimer);
        global.__odFilmTimer = null;
      }
      var copy = (COPY[locale] || COPY.en)[scene] || COPY.en.web;
      var build = RENDER[scene] || RENDER.web;
      mount.innerHTML = '';
      mount.appendChild(build(copy));
    },
    /*
     * Pick a legible colour for accent-coloured TEXT.
     *
     * A brand accent is tuned for fills, not always for type: Brutalism's
     * lemon on its cream page is about 1.2:1. Fills keep the real accent
     * (they pair it with --accent-on); text roles fall back to the foreground
     * when the accent cannot carry it.
     */
    guardAccentText: function (host, sys) {
      var srgb = function (hex) {
        var m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
        if (!m) return null;
        var n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) {
          c /= 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
      };
      var lum = function (hex) {
        var c = srgb(hex);
        return c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : null;
      };
      var la = lum(sys.accent);
      var lb = lum(sys.bg);
      var ratio = la == null || lb == null ? 99 : (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      host.style.setProperty('--ds-accent-text', ratio >= 3 ? sys.accent : sys.fg);
    },
    /* Bind a design system's tokens onto host as --ds-* custom properties. */
    applySystem: function (host, sys) {
      var s = host.style;
      s.setProperty('--ds-bg', sys.bg);
      s.setProperty('--ds-surface', sys.surface);
      s.setProperty('--ds-fg', sys.fg);
      s.setProperty('--ds-muted', sys.muted);
      s.setProperty('--ds-border', sys.border);
      s.setProperty('--ds-accent', sys.accent);
      s.setProperty('--ds-accent-on', sys.accentOn);
      s.setProperty('--ds-radius', sys.radius);
      s.setProperty('--ds-radius-lg', sys.radiusLg);
      s.setProperty('--ds-radius-sm', sys.radiusSm);
      s.setProperty('--ds-font-display', sys.fontDisplay);
      s.setProperty('--ds-font-body', sys.fontBody);
      s.setProperty('--ds-tracking', sys.tracking);
    },
  };
})(window);
`;

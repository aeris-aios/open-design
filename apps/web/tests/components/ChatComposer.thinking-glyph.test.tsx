// @vitest-environment jsdom
/**
 * 发送按钮「思考中」那颗动画 —— 产品负责人 2026-08-27 指认:
 * 「这个发送按钮 思考中的这个动画怎么不见了」,截图里球的位置是**一块实心黑方块**。
 *
 * 真因不在组件、不在 CSS,在**素材自己**:`public/composer-matrix-loader.svg` 里
 * 那组亮点套着 `filter="url(#svg-bloom)"`,而这个 filter 的第一步
 * `feComponentTransfer`(slope/intercept)是一道**亮度阈值** —— 它要先把「够亮的部分」
 * 抠出来,再模糊、再 `feBlend mode="screen"` 叠回去,得到一圈光晕。
 *
 * 但阈值配的是 slope 3.90 / intercept -3.51,要求输入 ≥ 3.51/3.90 ≈ 0.90;
 * 点自己的墨色是 `#DEDDDD`(≈0.871 sRGB,linearRGB 更低到 ≈0.73)—— **一辈子过不了这道闸**。
 * 于是 `bright` 整层全黑,两道大模糊把这层**黑**摊开成一片 alpha,
 * screen 叠回去时颜色是 0、alpha 却不是 0,结果就是往整个 18×18 格子里**刷黑**。
 *
 * 真机量到的数(headless Chrome,按真实 `#202020` 药丸底色采样,8× 超采样):
 *   带 filter :格子里 **46.4%** 的像素比药丸本身还黑(最低亮度 9)
 *   摘掉 filter:**0.1%**,点干干净净浮在药丸上
 * 也就是说这道「光晕」只会**减光**,不会发光 —— 它画出来的正是那块黑方块。
 *
 * 这条测试钉的是素材层的不变量:**抠亮阈值必须真的能放过这张图自己的墨色**,
 * 否则整条 bloom 链退化成一层黑纱。sRGB / linearRGB 两种解释下都要成立
 * (SVG 滤镜默认在 linearRGB 里算,那一侧只会更低)。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '../../src/components/ChatComposer';
import { flushMounts } from '../helpers/lexical-composer';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const GLYPH_SRC = '/composer-matrix-loader.svg';
const svg = readFileSync(resolve(process.cwd(), `public${GLYPH_SRC}`), 'utf8');

describe('发送按钮「思考中」的点阵素材', () => {
  /*
   * 不变量:**点阵要直接画到画布上,中间不许再夹一层滤镜**。
   *
   * 这条写死成「一层都不许有」而不是「阈值要配对」,是因为这里已经为一层配错的
   * 滤镜赔过一次:再加回来的人得先证明它画的是光,不是黑 —— 而证明这件事
   * 只能靠把它渲染出来量,光读 CSS / 读 XML 都照不出来(量法见本文件顶上的数)。
   */
  it('点阵直接画到画布上 —— 中间不许再夹滤镜', () => {
    expect(svg, '有元素套着 filter:先量它到底画的是光还是黑').not.toMatch(/filter="url\(/);
    expect(svg, '还留着 filter 定义:没人用就删干净,别留着给下一个人捡').not.toMatch(/<filter\b/);
  });

  /*
   * 配对断言 —— 只删掉 filter 也要保证素材还是那张会动的点阵,
   * 不能把 bloom 连着动画/墨色一起删干净还让上面那条变绿。
   */
  it('素材仍是那张会动的点阵:50 个格子、25 个亮点、每个亮点带 SMIL', () => {
    expect(svg.match(/<circle/g) ?? []).toHaveLength(50);
    expect(svg.match(/fill="#DEDDDD"/g) ?? []).toHaveLength(25);
    expect(svg.match(/<animate\b/g) ?? []).toHaveLength(25);
    expect(svg).toMatch(/attributeName="opacity"/);
    expect(svg).toMatch(/repeatCount="indefinite"/);
  });
});

describe('发送按钮两态都还在', () => {
  it('跑起来时是「思考中」药丸,里面挂着那张点阵', async () => {
    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    await flushMounts();

    const glyph = document.querySelector<HTMLImageElement>('img.composer-run-glyph');
    expect(glyph, '「思考中」态应该挂着点阵图').not.toBeNull();
    expect(glyph!.getAttribute('src')).toBe(GLYPH_SRC);
  });

  it('没在跑时不出「思考中」,发送按钮照常在', async () => {
    render(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    await flushMounts();

    expect(document.querySelector('img.composer-run-glyph')).toBeNull();
    expect(screen.getByTestId('chat-send')).toBeTruthy();
  });
});

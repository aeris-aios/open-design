# 执行记录 · 镜像陈列页

`matrix-82.html` 抽的是**设计稿自己的实体**,`mirror-exec.html` 用的是**我们的组件**。
编号一致,两页并排开着就能逐格对 —— 这是「对齐了没有」目前唯一能被人判断的地方。

覆盖范围:84 格里的 **79 格**。

| 家族 | 格 | 组件 |
|---|---|---|
| 执行记录 | 1–11 | 7 / 9 / 10 / 11 / 12 |
| 理解段 | 12–27 | 3 / 4 / 5 / 8 |
| 产出收尾 | 28–44 | 13 / 14 / 15 / 16 / 24 |
| 输入 | 45–69(缺 47 / 49 / 50 / 54 / 55) | 1 / 2 / 21 / 23 |
| 边界 | 70–84 | 6 / 17 / 18 / 19 / 20 / 22 |

**没上页的五格**:47(hover 与 46 无可见差异)、49 / 50(用户消息发送失败态)、54 / 55(附件失败、
hover 预览)。前后两块是同一件事的两半 —— 要产品先裁一次「同一个失败到底显示在哪」,盘点
`specs/current/chat-panel-input-audit.md` §4-B 里逐条写着。

各族性质不同,别拿同一把尺子看:执行记录、暂停、重连是这次新建的;**意图澄清 / 记忆卡 /
总结文案 / 产物卡 / 回合状态行 / 下一步引导 / Queue** 产品里早就有生产实现,页面上挂的就是那些
现成组件 —— 那些格照出来的是「现有实现离稿子有多远」。
它们的样式大多不在 chat 的接缝里(`.qf-*` 住在 `styles/viewer/composio.css`、产物卡在
`styles/viewer/tools.css`、回合状态行分在 `composio.css` 与 `theater.css` 两处且**有覆盖关系**),
生成器按 `index.css` 的导入顺序把用得上的规则挑出来内联,别整张 94KB 塞进去。

## 怎么重建

```bash
# 页面(每一格都重新走一遍真实事件流)
OD_WRITE_MIRROR="$PWD/docs/design/chat-mirror/mirror-exec.html" \
  pnpm --filter @open-design/web exec vitest run \
  -c vitest.config.ts tests/components/chat/mirror-gallery.test.tsx

# 逐格截图(需要先起个静态服)
cd docs/design && python3 -m http.server 8791 --bind 127.0.0.1 &
node docs/design/chat-mirror/shoot.mjs        # → shots/cell-01.png … full.png

# 只拍格子里的实体(出不来的格连同说明一起拍),79 张,序号是页面顺序不是格号
MIRROR_PICK=".stage, .gap" MIRROR_NO_FULL=1 node docs/design/chat-mirror/shoot.mjs
```

页面自包含,双击即可打开;截图脚本走无头 Chrome 的 CDP(本仓库不装 playwright)。

落点由命令给、不写死在测试里:合并闸的 web 车道会跑那个文件,而 `docs/` 是 certain-exempt 面 ——
源码里出现这条路径,等于让一次纯文档改动去影响一条本该被跳过的车道。

## 三条自律

1. 每一格的数据都从 `buildTurnBlocks` 走一遍真实事件流,**不手捏组件 props**。
   手捏就成了「照着稿子摆一遍」,证明不了产线上真的长这样。
2. 我们做不到的格子照样出格,写清楚**为什么做不到** —— 卡在**行为**、**数据 / 契约**、
   **产品裁决**,还是**这一页本身够不着**(静态标记没有布局、没有 React state、渲染不了 portal)。
   不留空、不拿近似糊过去,也**不为了让某一格好看去改组件**(这一轮对组件只加了三个 `export`)。
3. 待设计确认的地方逐格标在格子下面,不混进已对齐的格子。

## 三处刻意的不同

- **替设计师点开**:稿子里的实体本身就是「点开之后」的样子(7-2 的状态名写着「点开只摊一级」),
  收着没法比。产线上跑完是默认收起的(D18),摊开只发生在这一页。
- **类名摘掉了哈希**:页面内联的是 CSS Module 的**源文件**,所以把 `_fold_09d9ab` 还原成 `fold`。
  顺带的好处是设计师看到的 `class="fold flat"` 能直接和稿子里的 `fold mod-flat` 对上。
- **名字太大路的 module 要关进笼子**:摘掉哈希之后 `NextStepActions.module.css` 的 `.root`
  正好和每一格外面那层 `<div class="root">`(ChatRoot 的接缝,负责 `--chat-*` 变量)撞名,
  撞上之后**每一格**都会套上一圈下一步引导的边框和渐变底。所以这类 module 走 `scope()`
  加一层笼子选择器(`UserActionCard.module.css` 的 `.card` / `.title` / `.icon` 同理)。

## 挂的过程中照出来的实现缺陷

页面本身是只读的,所以下面这几条**一条都没有顺手改**(这一轮只允许给组件加 `export`),
逐条写在各自那一格的注记里:

- **第 34 格**:稿子右端那个 `14:32` 在最常见的路径上根本不出 —— `createdAt` 只传给了
  「没有反馈按钮」的那条分支;而且就算补上,`.assistant-feedback-wrap` 是 `inline-flex` +
  `max-width: min(360px,100%)`,整行收缩成 220.6px(整格 760px),弹簧撑不开。
- **第 39 格**:中断的一轮照出来是绿勾 + 绿字 —— 换勾那条规则只排除了 `data-streaming` /
  `data-unfinished`,没排除 `canceled`;稿子要的是灰点 + `--text-muted`。
- **第 72–74 格**:`.chat-queued-send-row` 的 `grid-template-columns` 只有**三条轨道**,
  而补上行首序号之后这一行有**四个孩子** —— 拖动手柄独占中间列、正文被挤到右边、
  动作排掉到第二行,行高也从 34px 变成 38px。

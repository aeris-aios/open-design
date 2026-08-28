# 聊天面板性能审计 — 中间落盘(半成品)

分支 `research/chat-perf-audit`,基线 commit `2eac7a1ca2`(= `od-wt-chat-panel` 的 HEAD)。
**这一轮只测不改。** 下面每条都标了样本量和环境;没测到的在最后一节老实列出来。

---

## 0. 环境

| 项 | 值 |
|---|---|
| 机器 | macOS 25.2.0 / Apple Silicon,`navigator.hardwareConcurrency = 10`,`deviceMemory = 16` |
| Node | v24.18.0 |
| Chrome | 151.0.0.0 |
| 被测代码 | `/Users/elian/Documents/od-wt-perf`(独立 worktree,自 `od-wt-chat-panel` HEAD 拉出) |
| 被测 runtime | 独立实例,daemon `127.0.0.1:17856`,独立 `OD_DATA_DIR`(scratchpad 下),**没有碰用户的 17573/17456** |
| 数据来源 | 用户真实库 `od-wt-chat-panel/.od/app.sqlite` **只读**拷贝;造压力数据全部走生产 HTTP API(`POST /api/projects` → `POST .../conversations` → `PUT .../messages/:mid`),**没有直接写库** |

---

## 1. 真实会话规模分布(这条决定靶子在哪)

扫了本机 20 个 `app.sqlite`(所有 worktree + e2e 数据目录),共 **55 个会话**:

| 指标 | 值 |
|---|---|
| 每会话消息数 p50 | **4** |
| p90 | 12 |
| p99 / max | **41** |
| 消息数 ≥ 80 的会话 | **0 个** |

最长的几个(`events` 一列是 **UTF-8 字节**,不是 sqlite `length()` 的字符数):

| 会话 | 消息数 | events 总量 | 备注 |
|---|---|---|---|
| `7e97c7e9…` | **41** | 791 KB(字符)/ ~1.5 MB(字节) | 本机最长会话 |
| `d130c320…` | 22 | 1.44 MB(字符) | |
| `64acc867…` | 12 | **2.93 MB(字符)/ 5.88 MB(字节)** | 单条消息就占了 3.06 M 字符 |

### 1.1 ⚠️ 头号发现:`CHAT_MESSAGE_VIRTUALIZE_THRESHOLD = 80`,现实里**一次都没触发过**

`ChatPane.tsx:863`。本机 55 个真实会话最长 41 条,**没有一个会话走过虚拟化那条路**。
也就是说:现在线上跑的永远是 `!virtualized` 那条 `items.map(...)` 全量直排分支
(`ChatPane.tsx:4471`),虚拟化代码 + `.chat-virtual-row` 的 CSS/间距/预估逻辑
**全是死码**(至少对这份数据分布是)。

**含义**:「优化虚拟化」优先级应该很低;真正的靶子是**单条消息的事件数**,不是消息条数。

### 1.2 ⚠️ 真正的规模轴是「单条消息里的事件数」

会话 `64acc867…` 里的消息 `b7b61e19…`:

| 指标 | 值 |
|---|---|
| 事件数 | **9,280** |
| 其中 `tool_use` | **9,267** |
| 这 9,267 条的**唯一 id 数** | **1**(全是 `item_2`) |
| 唯一 payload 数 | **1**(逐字节完全相同的 `TodoWrite`) |
| 落库大小 | 3,059,056 字符 / **5.88 MB UTF-8** |
| 渲染出来的块数 | **2** |

**5.88 MB 的事件流,渲染结果是 2 个块。** 99.99% 是同一条 `TodoWrite` 事件的重复。

为什么没被去重(两条路都漏了):

1. **客户端** `dedupeToolUsesById`(`runtime/tool-events.ts:21`)显式跳过快照型工具:
   `if (event.kind === 'tool_use' && !isSnapshotTool(event.name))` —— `TodoWrite` 正是快照型,
   所以 9,267 条一条不去。实测 `dedupedEvents = 9280`,**去重后还是 9,280**。
2. **daemon 端** 浏览器 PUT 走的是 `compactAdjacentMessageAgentEvents`(`db.ts:3040`),
   它**只合并相邻的 `text`/`thinking`**,不做相邻等值去重。
   旁边那个 `mergeMessageAgentEvents`(`db.ts:3074`)**有**
   `JSON.stringify(last) === JSON.stringify(event)` 的相邻去重 —— 两条写路径规则不一致。

---

## 2. 已量到的数字

### 2.1 `buildTurnBlocks` — 真实消息实测(Node 24,单条消息,预热 3 次)

| 消息 | 事件数 | 去重后 | `dedupeToolUsesById` p50 | **`buildTurnBlocks` p50** | p95 | 输出块数 | n |
|---|---|---|---|---|---|---|---|
| `b7b61e19`(3 M 字符/9,280 事件) | 9,280 | 9,280 | 0.433 ms | **28.288 ms** | 395.077 ms | 2 | 20 |
| `70152aeb`(1.2 M 字符) | 124 | 102 | 0.006 ms | 0.118 ms | 1.12 ms | 1 | 200 |
| `4f967569`(187 K) | 103 | 87 | 0.005 ms | 0.113 ms | 2.601 ms | 2 | 200 |
| `b4562670`(93 K) | 12 | 11 | 0.001 ms | 0.015 ms | 0.026 ms | 200 |

**结论**:`buildTurnBlocks` 本身不慢(典型消息 0.1 ms);它只在那条病态消息上炸到 28 ms(p95 395 ms,带 GC)。
而这条消息在**流式期间每一帧**都会重算一次(`AssistantMessage.tsx:704` 的 `useMemo` 依赖 `displayEvents`,
而流式时 `displayEvents` 每帧变)。28 ms/帧 = 直接掉到 30 fps 以下。

### 2.2 ⚠️ 5.88 MB 的消息**写不回去** —— `PUT .../messages/:mid` 返回 413

- daemon 全局 body 上限 `express.json({ limit: '4mb' })`(`server.ts:2956`)。
- 用生产 API 回放这条真实消息:**HTTP 413 Payload Too Large**(实测,n=1,必现)。
- 客户端 `saveMessage`(`state/projects.ts:1505`)的 `catch {}` **把错误吞掉了**,UI 无任何提示。
- 也就是说:daemon 自己产出并存下来的消息,浏览器再也无法持久化对它的任何更新。
  流式期间 `persistAssistantSoon` 每 500 ms PUT 一次全量消息,事件涨过 4 MB 之后**每一次都静默失败**。

### 2.3 `GET .../messages` payload 与延迟(本机 loopback,n=6/档,第一次含冷启动)

| 会话 | 消息数 | 事件总数 | 响应体 | GET 耗时(6 次) |
|---|---|---|---|---|
| base41(真实最长会话) | 41 | 674 | 0.93 MB | 1384 / 234 / 537 / 110 / **64** / 153 ms |
| x82(真实会话 ×2) | 82 | 1,348 | 1.87 MB | 436 / 72 / 104 / 127 / 126 / 118 ms |
| x246(真实会话 ×6) | 246 | 4,044 | **5.60 MB** | 673 / 54 / 61 / 70 / 56 / 71 ms |
| heavy(病态消息,截到 5,000 条重复) | 12 | 5,106 | 2.18 MB | 230 / 61 / 45 / 49 / 58 / 54 ms |

**结论**:daemon 侧读取不是瓶颈(热态 50–150 ms)。**但 41 条真实消息就要传 0.93 MB**,
246 条要 5.6 MB —— 这些字节 100% 是 `events`,而绝大部分事件渲染后是不可见的。

### 2.4 冷启动 API 扇出(实测,dev 模式,**StrictMode 开着**,所以下面的 ×2 不可信)

首页冷加载共 **50 条 `/api/*` 请求**。其中明显重复的:
`/api/integrations/vela/status` ×6、`/api/analytics/config` ×4、`/api/workspace/directory` ×3、
`/api/version` ×2、`/api/active` ×2、`/api/app-config` ×2、`/api/whats-new` ×2、
`/api/plugins` ×2、`/api/mcp/servers` ×2、`/api/connectors` ×2、`/api/connectors/status` ×2、
`/api/github/open-design` ×2、message-center ×2(两次都是 **401**)。

⚠️ **这组数字不作数**:`reactStrictMode: true`(`next.config.ts:161`)让 dev 下 effect 跑两遍。
×2 的那些很可能是 StrictMode 假象;但 `vela/status` ×6、`analytics/config` ×4、
`workspace/directory` ×3 是**奇数/超过 2 倍**的,不能全用 StrictMode 解释。
已经把 StrictMode 做成可关的开关并重跑到生产构建,**但重测被打断了**(见第 4 节)。

另外:**每个项目各发一条 `/api/projects/<id>/files`** —— 本机 5 个项目 = 5 条;
用户真实库有 30 个项目目录,这条会线性放大。

### 2.5 每次 `messages` 变化时 ChatPane 的全量遍历 —— **实测不慢**

`ChatPane` 在 `messages` 身份变化时会重算 6 个 `useMemo`:
`displayMessages`(filter+fold)、rail items(reduce)、`items`(`buildChatRenderItems`)、
`appliedContextByMessageId`、`previousTodosByMessageId`、`assistantRoleByMessageId`。

实测其中最重的两个(Node 24):

| 会话 | 消息数 | 事件总数 | `previousTodosByAssistantMessageId` p50 / p95 | `latestTodoWriteInputFromMessages` p50 / p95 | n |
|---|---|---|---|---|---|
| base41 | 41 | 674 | 0.006 / 0.042 ms | 0.000 / 0.002 ms | 300 |
| x82 | 82 | 1,348 | 0.020 / 0.059 ms | 0.000 / 0.001 ms | 300 |
| x246 | 246 | 4,044 | **0.061 / 0.151 ms** | 0.000 / 0.001 ms | 50 |
| heavy | 12 | 5,106 | 0.001 / 0.006 ms | 0.000 / 0.001 ms | 50 |

**排除项**:即使 246 条消息 / 4,044 事件,这些「每帧全量 map」的成本也在 **0.15 ms 以内**。
不要去优化它们。

---

## 3. 已定位、但还只有代码证据(数字未测到)

标注清楚:**以下没有实测数字**,只是读代码发现的结构问题,需要后续用浏览器验证。

1. **`AssistantMessage.tsx:651` 的 `events` 每次渲染新建数组**
   ```ts
   const events = (message.events?.length ?? 0) > 0
     ? message.events!
     : message.content.trim() ? ([{ kind: "text", text: message.content }]) : [];
   const displayEvents = useMemo(() => dedupeToolUsesById(events), [events]);
   ```
   走 `else` 分支(有正文、无事件)时每次渲染都是新数组身份 → `displayEvents` / `blocks` /
   `nextTurn` 三个 `useMemo` 全部失效 → 每次渲染重跑一遍 markdown 解析。**未测**。

2. **`useCharReveal` 是无依赖数组的 `useLayoutEffect`**(`components/chat/useCharReveal.ts`)
   → 每次渲染都跑。非流式分支里会执行 `restore(host)`,其中有一句
   `host.querySelectorAll('[data-char-reveal]')`,即**每条已完成消息每次渲染都做一次 DOM 查询**。
   挂点有 3 处:`AssistantMessage:3029`(整块正文)、`ExecutionShell:304`(壳 body)、
   `SayText:36`(每个段落 `<p>`)。**开销未测**。

3. **`useThinkingStream` 每帧强制同步布局**(`components/chat/primitives/useThinkingStream.ts:113-127`)
   一个 rAF 循环里同时读 `box.scrollHeight`、`getComputedStyle(p).lineHeight`,再写 `box.scrollTop`
   —— 读→写→读的 layout thrash,而且和同一个 body 上的 `useCharReveal` 叠着跑。
   只在 `live`(流式思考中)时开。**帧率影响未测**。

4. **`appendCoalescedAgentEvent`(`ProjectView.tsx:13718`)每个事件全量复制数组** → 一轮 O(n²)。
   正常一轮 ~200 事件时可忽略;9,280 事件那条约 4,300 万次指针拷贝。**未测**。

5. **`persistMessageById` / `updateMessageById` 在 `setMessages` updater 里做副作用**
   (`ProjectView.tsx:4514`、`4531`)—— React 可以重放 updater,StrictMode 下必然跑两遍。
   写频率本身有节流:`persistAssistantSoon` 是 500 ms 尾随节流(`ProjectView.tsx:7720`),
   所以**流式期间最多每 500 ms 一次 PUT**,但每次 PUT 都是**全量消息体**(见 2.2 的 413)。
   顺带:`ProjectView.tsx:7788-7789` 连着写了两次 `persistAssistantSoon()` —— 因为有 `if (persistTimer) return`
   所以无害,但是明显的合并残留。

6. **虚拟化高度预估误差**(`estimateChatRenderItemHeight`,`ChatPane.tsx:4558`)
   ```
   base + contentRows*18 + attachmentCount*34 + eventCount*28 + fileCount*32 + CHAT_VIRTUAL_ROW_GAP_PX
   ```
   `eventCount * 28` 对事件密集的消息会疯狂高估:9,280 事件 → 单行预估 **约 26 万 px**。
   另外 `CHAT_VIRTUAL_ROW_GAP_PX = 14`,而 CSS `.chat-virtual-row { padding-bottom: 12px }`
   (`styles/chat.css:461`)—— **常量比 CSS 大 2px**,确认漂移存在。
   但因为第 1.1 节(现实中从不触发虚拟化),这条的**实际影响接近零**。**误差未在浏览器里量**。

7. **流式期间每个 rAF 一次 React 更新**:`createBufferedTextUpdates`(`ProjectView.tsx:13549`)
   用 rAF + 250 ms 兜底批处理文字增量,设计是对的。但每次 flush 都 `setMessages` → 新数组
   → ChatPane 6 个 memo 重算(已测,≤0.15 ms,不是问题)+ 流式那一条消息完整重渲染
   (`buildTurnBlocks` + markdown 全量重解析,随消息变长而变贵)。**未测增长曲线**。

---

## 4. 还没测到的维度(诚实清单)

浏览器侧测量刚搭好就被打断,以下**一个数字都没有**:

- [ ] 首次打开长会话:首帧时间、可交互时间(生产构建下)
- [ ] 滚动帧率 p50/p95/>33ms 帧数(长会话 / 病态消息两档)
- [ ] 流式输出中的帧率;逐字浮现随消息数怎么变
- [ ] 内存曲线 / 泄漏(reveal span 回收、ResizeObserver/MutationObserver 解绑)
- [ ] React 重复渲染计数(hook 已经注入进 `apps/web/out/index.html`,但还没跑)
- [ ] HTTP/1.1 六连接是否在长会话首开时被打满
- [ ] 关掉 StrictMode 后的真实请求扇出(2.4 那组数要重测)
- [ ] 「逐字浮现铺开到所有正文」「思考块滚动窗 + 逐字浮现同时挂」这两条本轮新改动的实际开销

### 已经搭好的东西(接手的人可以直接用)

- 独立 runtime:`OD_DATA_DIR=<scratchpad>/perf-data`,daemon `17856`,已经在跑**生产静态构建**
  (`apps/web/out`,由 daemon `express.static` 直接服务 = 打包版形态)。
- 已通过生产 API 灌好 4 个会话:

  | 名字 | projectId | conversationId | 规模 |
  |---|---|---|---|
  | base41 | `perf-base41-a4358412` | `e2b39365-d526-4f31-aae6-6ccc9b04d7af` | 41 msg / 674 ev |
  | x82 | `perf-x82-29a71ad8` | `62f47d95-0a97-4ec8-9918-96572f1df27e` | 82 msg / 1,348 ev |
  | x246 | `perf-x246-4730f9d7` | `9040ecf0-7554-497d-9096-917105902891` | 246 msg / 4,044 ev |
  | heavy | `perf-heavy-93979a00` | `aef76e68-7892-48bd-9cc5-a0fed9a258dd` | 12 msg / 5,106 ev |

  路由:`/projects/<pid>/conversations/<cid>`。
- `next.config.ts` 加了 `OD_PERF_NO_STRICT=1` 开关关掉 `reactStrictMode`(**只在这个 worktree 里,不要合**)。
- 探针脚本(React commit 计数 / 帧采样 / fetch tap / observer 泄漏计数)见 `perf-audit/probe.js`,
  已内联进 `apps/web/out/index.html`(`index.html.orig` 是原件)。
- mock CLI 语料已拷进 `mocks/recordings/`(180 条),daemon 起的时候带了
  `PATH=mocks/bin:$PATH OD_MOCKS_TRACE=3d6f3f38`,可以直接发一轮真流式而不烧额度。

---

## 5. 当前可下结论的优先级(按已测到的影响排序)

| # | 现象 | 实测数字 | 触发条件 | 修法方向 | 代价 |
|---|---|---|---|---|---|
| 1 | 一条消息塞 9,267 条**完全相同**的 `TodoWrite`,5.88 MB | 事件数 9,280 → 渲染 2 个块;`buildTurnBlocks` 28.3 ms p50 / 395 ms p95(n=20) | agent 重复发同一条快照事件;本机 55 个会话里出现 1 次 | 写入侧相邻等值去重(把 `mergeMessageAgentEvents` 已有的规则搬进 `compactAdjacentMessageAgentEvents`);读取侧让快照工具也参与去重 | 小 |
| 2 | 大消息 `PUT` 静默 413,更新永远存不下去 | 5.88 MB > `limit: '4mb'`;`saveMessage` 的 `catch {}` 吞掉(n=1,必现) | 单条消息事件超 4 MB | 先修 #1 让它到不了 4 MB;`saveMessage` 至少要能上报失败 | 小 |
| 3 | 41 条真实消息就要传 0.93 MB,246 条 5.6 MB | 见 2.3(n=6/档) | 打开任何长会话 | `GET messages` 分页 / 事件裁剪 | 中 |
| 4 | 虚拟化阈值 80,现实中从不触发 | 55 个真实会话最长 41 条,≥80 的有 **0** 个 | — | 要么调低阈值让它真的生效,要么承认它是死码 | 小(但要先想清楚目标) |
| 5 | 冷启动 50 条 API 请求、多个端点重复 | 见 2.4 ⚠️ **StrictMode 污染,待重测** | 每次冷启动 | 身份落定前后的两轮扇出合并 | 中 |

**明确的排除项**(测过、不慢,别去优化):
- `previousTodosByAssistantMessageId` / `latestTodoWriteInputFromMessages`:246 消息 / 4,044 事件下 ≤ 0.151 ms p95。
- `dedupeToolUsesById`:典型消息 0.005 ms p50。
- 典型消息的 `buildTurnBlocks`:0.113 ms p50(103 事件)。
- daemon `GET .../messages` 热态延迟:50–150 ms,不是首开慢的原因。

---

## 6. 浏览器侧测量为什么卡住(环境阻塞,不是代码问题)

- `open-browser-use`(真 Chrome 151)一开始工作正常,中途 `/tmp/open-browser-use/active.json`
  注册表消失(`socket not provided and active socket registry is unavailable`),标签页被回收,
  此后无法再开 tab。
- 退而用 `claude-in-chrome` 时发现它连的是 **Microsoft Edge**,而这台机器上的 Edge
  **连不上任何新的本地端口**:`http://127.0.0.1:17856/api/health` 和
  `http://127.0.0.1:17858/`(一个纯 `python3 -m http.server` 对照组)都是
  `ERR_CONNECTION_REFUSED`,而同一时刻 `curl` 两个都是 200。
  用户已经开着的 `localhost:17573` 那个标签页是好的 —— 所以这是 Edge 侧的
  本地网络访问策略/权限,不是 daemon 的问题。
- **结论**:第 4 节那些浏览器指标要么等 `open-browser-use` 的 Chrome 会话恢复,
  要么需要用户在 Edge 里放行本地端口。测量脚本和 runtime 都已就绪,恢复后可以直接跑。

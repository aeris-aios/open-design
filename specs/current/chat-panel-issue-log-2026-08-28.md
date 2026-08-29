# Chat Panel 问题与上线前设计滚动日志（2026-08-28）

> 用途：记录本轮用户反馈、明确预期、证据、已定位根因和代码状态。后续每完成一项就更新这里，避免会话压缩后丢失上下文。
>
> 工作分支：`feat/chat-panel-next-impl`
>
> 活跃 worktree：`/Users/elian/Documents/od-wt-chat-panel`
>
> 验证约束：用户明确要求不要跑全量测试；只运行与改动对应的聚焦测试。

## 当前优先级

1. 修复 Design Harness 路径漏掉 Chat Panel host 协议，导致最终三行下一步建议不出现。
2. 修复 Ctrl+Shift+R 硬刷新后，OD Next / strategy 多 Run 的最终结论重复。
3. 修复 OPEND-2404 首页附件交互：点击附件应预览，点击 Run 不应自动打开附件。
4. 修复最终答复中的项目文件 / 目录链接展示异常。
5. 完成 OPEND-2403 thinking Markdown 主审、提交与推送。
6. 按飞书文档推进 Question Form 组件族上线前再设计。

## 2026-08-29 全量复核口径

- **不能宣称本需求全部关闭**。仍未实现的是 #1 / #15 Design Harness 与普通 Chat Panel host protocol 共用；OPEND-2410 仍只是确认“Agent 没有调用 Todo 工具”，没有代码修复；Question Form 组件族仍待设计评审。
- 已推送但主要只有聚焦测试、尚无对应真实操作 E2E 的项目：#2、#3、#4、#6、#7 的真实高速模型性能、#8 最终 media-task 版本、#9 全部文字角色、#11、#12、#14、#16、#17、#18、#19。交接时不得把“测试绿”写成“真机验收完成”。
- 有明确 post-fix 手工 UI 证据：#5 Question Form packaged 验证、#9 助手正文 computed style、#10 分享 tooltip。
- #13 DSML 已于 2026-08-29 使用正确的 test-AMR 环境完成真实 live + reload E2E，详见对应条目；这次不是打包安装包验收，当前 Beta 安装包仍未因本补丁重打。
- 新增 #20：消息队列卡片与 Composer 左右边界未对齐，已修代码和聚焦回归，待提交后再做真实队列视觉复验。

## 待修复 / 待设计

### 1. Design Harness 开启后缺少底部三行下一步建议

- 状态：**根因已定位，尚未改代码**。
- 用户现象：任务已经成功生成产物，但最终消息下方没有三行下一步建议。
- 用户疑问：开启“Open Design 实验室 → Design Harness”后，是否改走 strategy / plan，导致本轮 Chat Panel 新提示词没有被遵守。
- 证据截图：
  - `/Users/elian/Downloads/screenshot-20260828-180515.png`
  - `/Users/elian/Downloads/screenshot-20260828-180605.png`
- 根因：Design Harness / OD Next strategy 分支绕过普通 `composeDaemonSystemPrompt` 和 `composeChatAgentTextPayload`，没有把本轮 keyed host 协议注入最终 production 输入：
  - `<od-done key="…">`
  - `<od-next key="…">`（1–3 行建议）
  - `<od-focus key="…">`
- 关键代码链：
  - 实验室开关：`apps/web/src/components/LabsSection.tsx`
  - strategy admission / Bundle：`apps/daemon/src/routes/runs.ts`
  - 普通 run host 协议：`apps/daemon/src/server.ts`
  - strategy finalText 直通分支：`apps/daemon/src/server.ts`
  - next-step marker 契约：`packages/contracts/src/api/next-step-marker.ts`
- UI / SSE / 落库链本身存在且可用；首因是 agent 没拿到本轮 nonce 与输出格式，因此没有生成 `next_steps` 事件。
- 同类遗漏：
  - `done` marker 同样漏注入，目前由前端最终 prose 兜底掩盖。
  - `focus` marker 同样漏注入，目前由 produced-file inference 兜底。
  - Todo atom 允许 prose plan，未必产生 Chat Panel 可渲染的真实 Todo tool 事件。
  - question-form 有独立 strategy atom，未发现整体漏失。
- 最小正确方向：抽取共享、类型化的 `renderChatTurnHostProtocol(doneKey, stagePolicy)`，普通 run 与 strategy run 共用；不要在启动时临时 append，以免破坏 strategy exact-final-text 不变量。
- stage policy：只有 completed 的 Direct Edit / Production 输出下一步建议；plan_ready、clarification、contract repair、blocked、canceled 不输出。
- 必须补的聚焦测试：request / production exact input 包含与 Run `doneKey` 一致的 host 协议；production 产生、落库并回放 `next_steps`；Harness 完成态 UI 显示三行。

### 2. Ctrl+Shift+R 后最终结论重复两遍

- 状态：**已修复并推送**，提交 `5834c0417e fix(chat): avoid duplicate strategy conclusion on reload`。
- 用户现象：客户端硬刷新几次后，同一逻辑轮次内的最终结论、交付文件和说明连续出现两份。
- 证据截图：`/Users/elian/Downloads/screenshot-20260828-181337.png`
- 根因：strategy 一个逻辑回合有 request / production 等多条物理 assistant message。刷新后，客户端查询前置 Run 的 task projection，拿到最终 Run 作为 `activeRunId`，误以为 successor 尚未恢复，于是把最终 Run 全量 SSE 追加进前置消息；服务端历史里原本已经有最终 Run 的独立消息，之后 `foldStrategyTaskTurns` 再折叠，得到 `PLAN + FINAL + FINAL`。
- 关键代码链：
  - strategy task projection / terminal run：`apps/daemon/src/strategies/task-store.ts`、`apps/daemon/src/strategies/od-next/automatic-simple-production.ts`
  - 刷新重挂与 replay：`apps/web/src/components/ProjectView.tsx`
  - strategy turn 折叠：`apps/web/src/components/ChatPane.tsx`
- 已排除：
  - 不是 `<od-done>` 与 fallback conclusion 双重提取。
  - 不是 React key。
  - 主要污染当前浏览器内存；每次刷新会重新触发，但 daemon PUT 的 runId 防护通常不会把重复永久写回 DB。
- 修复：`taskRunAdvanced` 时检查 projected successor 是否已由当前 hydration 的 sibling assistant message 物化。已物化则只更新前置消息的 task settled 字段并封存前置 Run，不再把 successor replay 进前置消息；successor 尚未落库时仍走原 crash-window 恢复。
- 红测先在旧逻辑稳定复现（错误调用一次 `reattachDaemonRun`），修复后同用例转绿；`ProjectView.reattach-restore.test.tsx` 全文件 45 条通过，按用户要求未跑全量测试。

### 3. OPEND-2404：首页附件点击与 Run 行为相反

- 状态：**已修复并推送**，提交 `04d327fc40 fix(chat): keep Home attachments as references`。
- 用户现象：
  1. 首页输入框带图片附件，点击 Run 后进入项目时，右侧工作区会自动打开该附件；用户不希望 Run 自动打开附件。
  2. 进入对话后，显式点击用户消息上的图片附件缩略图没有反应；用户希望此时能打开预览。
- 证据截图：`/Users/elian/Downloads/screenshot-20260828-181658.png`
- 明确预期：
  - `Run`：上传附件、把附件作为首轮上下文、进入会话；**不自动导航或打开附件**。
  - 用户显式点击附件：打开该附件预览 / 文件 tab。
- 当前高置信线索：
  - `ProjectView` 首次无 tab 时调用 `selectPrimaryProjectFile(projectFiles)`；图片的 rank 为 3。新项目如果此刻唯一文件就是首页上传的附件，它会被当作 primary 自动打开。
  - 首页自动发送已有 `autoSendFirstMessageRef` / `autoSendAttachmentsRef`，可用于区分“首轮参考附件”与“真正产物”；需要保证后续 agent 生成产物时仍可正常 auto-open。
  - 用户消息附件的点击可用性由 `ChatPane.UserAttachmentRow` 中 `projectFileNames.has(baseName)` 决定；需继续核对上传响应 path、项目文件 name 和刷新时序，不能只关掉初始 auto-open。
- 修复：首次进入项目时把 Home 已上传的参考附件从 primary artifact 候选中排除；若同时已有真正生成物，仍可正常选中生成物。用户显式点击消息附件时不再被滞后一拍的 `projectFileNames` 快照禁用，并优先使用已匹配的项目文件名打开。
- 红测：旧逻辑会自动选中唯一图片附件，并会禁用文件列表尚未刷新时的附件按钮；修复后 Home 自动发送、primary 选择和显式点击 3 条聚焦用例通过。按用户要求未跑全量测试。
- 相关文件：
  - `apps/web/src/components/HomeView.tsx`
  - `apps/web/src/components/HomeHero.tsx`
  - `apps/web/src/App.tsx`
  - `apps/web/src/components/ProjectView.tsx`
  - `apps/web/src/components/ChatPane.tsx`
  - `apps/web/src/providers/registry.ts`

### 4. 最终答复中的文件 / 目录链接展示异常

- 状态：**已修复并推送**，提交 `e60e79e499 fix(chat): render local markdown paths with spaces`。
- 用户现象：最终答复把项目文件和目录展示成原始 Markdown / 绝对路径文本，例如：
  - `打开 [index.html](</Users/.../index.html>)`
  - `三张真实摄影素材已本地化到 [assets](</Users/.../assets>)`
- 证据截图：`/Users/elian/Downloads/screenshot-20260828-182616.png`
- 明确预期：展示为简洁、可点击的项目内文件 / 目录链接；不能把 `</Users/...>` 绝对路径和 Markdown 语法直接暴露给用户。
- 根因：轻量 Markdown renderer 只接受不含空格的 `[...](/path)` destination，没有实现 CommonMark 的 angle-wrapped destination `[...](&lt;/path with spaces&gt;)`；因此包含 `Application Support` 的 macOS 绝对路径整段落回纯文本。
- 修复：显式支持 angle-wrapped destination，渲染时去掉尖括号，再交给既有的安全 href 与项目内链接路由；绝对路径不再把 Markdown 语法暴露给用户。同步保留 Windows `C:/...` 路径供既有 click router 判断，仍拒绝 `javascript:`、`vbscript:`、`file:` 和 protocol-relative URL。
- 红测：截图同形态的 macOS 空格路径在旧逻辑下无法生成 anchor；修后 renderer 与 AssistantMessage 点击路由用例转绿。两个聚焦测试文件共 55 条通过，按用户要求未跑全量测试。

### 5. Question Form 组件族需要上线前重新设计

- 状态：**已创建飞书设计任务文档，待设计评审**。
- 飞书文档：<https://powerformer.feishu.cn/docx/Qmmgd0SiUoQCXIxIazEcaWHSn1d>
- 证据：
  - `/Users/elian/Downloads/20260828-181201.jpg`（Select / 系统文案与语言归属）
  - `/Users/elian/Downloads/20260828-181206.jpg`（Color / Accent 色）
  - `/Users/elian/Downloads/20260828-181208.jpg`（Range / 版面密度）
  - `/Users/elian/Downloads/20260828-181214.jpg`（最终确认摘要）
- 用户判断：这些状态都需要重新设计，不能继续逐处修 CSS。
- 文档结论：缺的是 Question Form 组件族统一契约，包括 anatomy、输入控件、footer、确认态、响应式、i18n、无障碍和完整状态矩阵。
- 语言归属口径：题目、说明、选项和 `submitLabel` 属于 Agent 输出，跟随对话语言；Skip、Back、默认提交文案、提示和无障碍标签属于客户端系统文案，必须跟随界面语言并走 i18n。两者混排不是缺陷，不通过提示词强制统一。
- i18n 审计：已扩大到本次 Chat Panel 全部改动面；只记录系统自有可见文案的硬编码、错误 key / fallback 与 aria / title / tooltip 遗漏，待审计结果回填。
- 明确原则：以已有设计稿 / Chat Panel token 为准，不自行发挥具体视觉数值。

#### 已可直接修复的主设计稿对齐（2026-08-28 晚）

- 用户再次明确唯一视觉基准：`/Users/elian/Documents/od-design-artifacts/chat-panel-next.html`。
- 已移除 Question Form 顶层 `description`：类型、完整 / 流式解析、渲染、daemon / contracts 提示词和 ElevenLabs 特例均不再生成或消费该字段；必要说明只能进入具体问题的 label / help，不再塞进 Header。
- Header 成品包实测：378×36、`12px / 600 / 18px`、`#202020`，内距 `9px 11px`、间距 7px；图标 15×15、`#848484`；进度显示为无空格的 `1/3`。
- Footer 成品包实测：40px 高、`0 11px 8px`、gap 8px；跳过为 `12px / 600`、`4px 0`、透明；上一步为 `12px / 600`、`4px 11px`、透明；下一步为 58×32、`12px / 600`、`4px 11px`、999px 胶囊。
- 禁用态实测：下一步为 `#ededed / #bdbdbd`，尺寸不变；跳过在会话忙 / 禁用时仍透明，不再长出灰底药丸。
- 根因：`@open-design/components` 的 esbuild 产物抽出了 `dist/index.css`，却没在 `dist/index.mjs` 保留样式引用；开发态从源码加载所以正常，打包态从 dist 加载所以共享 Button CSS 丢失。已在组件构建入口保留 `import "./index.css"`，生产 Next build 和组件 tarball 均验证通过。
- 聚焦验证：Question Form 4 个测试文件 91 条、daemon prompt 2 个文件 78 条全部通过；daemon / contracts typecheck 通过；web production build 通过。web 单独 typecheck 仍有 3 个与本改动无关的既有测试类型错误（thinking markdown 1 条、artifact-card viewport 2 条）。
- 安装包验证：`0.21.1-beta.901` / namespace `chatqafix` 已完成 build → install → start，channel=beta；真实 Codex Run 生成 3 步 Question Form，并逐元素读取 packaged Electron computed style 对齐上述数值。
- 本地 DMG：`/Users/elian/Documents/od-wt-chat-panel/.tmp/tools-pack/out/mac/namespaces/chatqafix/dmg/Open Design-chatqafix.dmg`。

#### Chat Panel 全范围 i18n 审计结论

- Question Form 的系统文案未发现遗漏；Agent 中文 CTA + 英文 UI 的 Skip / Back 是预期组合。
- 本分支涉及的 `apps/web/src` 静态 `t('…')` key 共 1325 个，全部存在于 typed Dict 和 19 个 locale；相对 merge-base 新增的 86 个 Dict key 也全部补齐 19 locale。
- P1（本轮应修）：执行状态 aria、余额升级卡 CTA、会话搜索 placeholder / 空态、执行记录文件打开 aria、附件预览 aria 共 5 类系统硬编码。
- P1 修复结果：上述 5 类已全部接入 typed i18n，新增 5 个 key 均补齐 19 个 locale；法语组件断言和 locale 对齐测试通过。
- merge-base 归因：相对 `3af55e9f22` 到本分支审计点，本次需求新增的系统文案硬编码为 **0 项**。
- P2（另批收债）：Composer / ChatPane 上下文 kind 与 tooltip、插件 / MCP / skill 工具面板、旧插件动作面板、上传失败模板和媒体 starter 仍有历史英文硬编码。逐字核对确认均已存在于 merge-base，是 main 既有客户端技术债，不是 Agent 文本，也不通过提示词修复。
- 非问题：命令、路径、文件名、工具输出、Question Form Agent 字段、产品 / 插件专名不做强制翻译。

### 6. ToolRow 的 command 动作识别不足

- 状态：**已修复并推送**，包含于 `bb4292e82b fix(chat): close remaining panel regressions`；尚无真实会话 ToolRow 渲染 E2E。
- 样本：只读抽样本机 stable / beta / prerelease 的 332 条真实 OD shell command，不记录会话正文、绝对路径或凭据。
- 旧规则：246 / 332 条回落成“执行”。
- 新规则：83 条保守保留为真正的通用执行；其余识别为读取 107、搜索 102、新建 / 写入 33、改写 4、删除 3。
- 补充复核：真实样本有 3 条 `sed → grep → head`、1 条 `awk → rg`；已加窄规则，仅当 `cat/sed/awk` 是纯只读预处理且下游明确 grep / rg、整条无修改时按搜索。`curl/env → rg` 原本已正确。
- 安全边界：多文件、glob、变量路径和 heredoc 标记不伪造成可点击文件；能证明动作但不能证明目标时，只展示本地化语义动词与静态命令摘要。
- 聚焦验证：8 个文件、最新 206 条用例通过；未跑全量测试。

### 7. OPEND-2403：thinking 正文不渲染 Markdown，且高速流可能卡顿

- 状态：**已完成并推送**，提交 `107c500bfd fix(chat): render streamed thinking markdown efficiently`。
- 根因：新 Chat Panel 把 thinking 收进 `ThoughtsRow` 后仍使用纯文本 `SayText`；旧 `ThinkingBlock` 虽支持 Markdown，但已无消费方。
- 当前实现：
  - 新增 `ThinkingMarkdown`，复用现有安全 React Markdown renderer。
  - live 流使用固定 100ms 合并窗口，整段 Markdown parse / DOM commit 最多每秒 10 次。
  - 被合并丢弃的 delta 不触发 Markdown parse 或 `useCharReveal` DOM 遍历。
  - live fenced code 禁用 Shiki；完成态立即 flush 并恢复高亮。
  - 通用 Markdown link 允许项目相对路径、HTTP(S)、mailto；拒绝 `javascript:`、`vbscript:`、`file:` 和协议相对 URL。
- 修改文件：
  - `apps/web/src/components/chat/ExecutionShell.tsx`
  - `apps/web/src/components/chat/ThinkingMarkdown.tsx`
  - `apps/web/src/components/chat/ThinkingMarkdown.module.css`
  - `apps/web/src/runtime/markdown.tsx`
  - `apps/web/tests/components/chat/thinking-markdown.test.tsx`
  - `apps/web/tests/runtime/markdown.test.tsx`
- 聚焦验证：5 个相关测试文件、78 条测试通过；`git diff --check` 通过。按用户要求未跑全量测试。

### 8. OPEND-2195：生图逐张计数

- 状态：**已实现并推送**，包含于 `bb4292e82b fix(chat): close remaining panel regressions`；最终 media-task / ImageRow 补丁尚未重新跑完整顺序生图 E2E。
- 根因：ChatPanel 只从 shell command 中数 `media generate` 猜总数，完全没有消费既有的 `GET /api/projects/:id/media/tasks`；同时真实 CLI 成功输出是 `{ file: {...} }`，旧解析器却只认顶层 `status/path`。
- 当前实现：
  - media task 持久化 `runId`，升级旧 SQLite schema 时幂等新增 `run_id`。
  - 列表接口返回 `runId`；ChatPane 只在存在生图 turn 时拉取，运行中 750ms 串行轮询，失败退避到 1500ms，轮次与 task 均终止后停止。
  - 按 assistant run + task 创建顺序驱动每个格子的 `pending / done / failed`；失败格保留实际位置，命令已结束但后续 task 未创建时收敛为失败，不永久转圈。
  - 成功格直接读取真实项目图片作为缩略图，并复用项目文件打开动作。
  - 失败格点击重试时把被点格子的 `N/M` 坐标带回正常聊天发送链，多个失败格不会再发同一句含糊的“全部重试”；仍不伪造 daemon 级请求重放。
  - 无 task 数据的旧会话继续走事件兜底，且已兼容真实 `{ file: { name } }` 成功 envelope。
- 聚焦验证：daemon 2 文件 23 条、web 3 文件 100 条全部通过；daemon / contracts typecheck 通过。web typecheck 只剩 3 条本分支既有错误（thinking markdown 1 条、artifact-card viewport 2 条），本次新增代码无类型错误。按用户要求未跑全量测试。
- 2026-08-29 真机补充：运行时能生成 4 张真实图片，但隔夜重启后生图行退化为普通“读取图片”工具行。原因是 terminal media task 过 TTL 后被启动清理，而历史 Bash stdout 同时被 ACP 安全打码。已增加持久化事件兜底：当 `media generate` 的成功调用结构里明确带有 `file_path` 时，恢复为完成态生图行与缩略图，不把它误判成读文件；新增红测由失败转为通过（该文件 62/62）。

### 9. Chat Panel 全量字体角色对齐

- 状态：**深度审计完成，P0/P1/P2 已修复并推送**，包含于 `bb4292e82b fix(chat): close remaining panel regressions`；只对助手正文做了 post-fix computed-style 真机复验，并非每个文字角色都已 E2E。
- 唯一基准仍为 `/Users/elian/Documents/od-design-artifacts/chat-panel-next.html`，不是凭观感统一字号。
- 本轮范围扩大为 Chat 中每一种可见文字角色：壳头 / Todo / thinking / 过程正文 / ToolRow 动词、命令、文件名、耗时、失败态 / 壳外结论 / 状态行 / Question Form / 生图行 / 附件与产物卡。
- 用户真机指出同一执行流内普通正文、等宽命令、ToolRow 标题、thinking 标题与耗时看起来各不一致；需逐角色记录稿件值、生产 selector、computed value 与是否语义上应当不同，不能粗暴“一刀切”。
- 审计结论：ToolRow 动作词 13px sans、文件 / 命令 12px mono、耗时 12px mono 是设计稿明确层级，不能统一成同一种字；Media ToolRow、Plan/Todo、Question Form 核心文字和 Error Card 也已对齐。
- 真正失配并已修复：壳外助手正文改为 `13px / 1.7 / #202020 / normal letter-spacing`，粗体 600；live “思考中”移除壳头专用的 `head` 档，回到 500 / muted；回合底部“已完成 / 已手动停止”字重 500→400。
- 真机 computed style 复验正文为 `13px / 22.1px / rgb(32,32,32) / letter-spacing normal / 400`；thinking + conversation 聚焦测试 2 文件 26 条通过。

### 10. 分享菜单 tooltip 跑位

- 状态：**已修复、真机复验并推送**，包含于 `bb4292e82b fix(chat): close remaining panel regressions`。
- 复现：预览区“分享”菜单中，hover 分区标题右侧问号后，说明 tooltip 掉到菜单下方 / 右下侧并遮压后续内容。
- 当前线索：问号使用共享 `TooltipLayer` portal，但显式声明 `data-tooltip-placement="bottom"`；需确认预期应为向左 / 向上，以及 portal 与锚定菜单的 fixed 坐标是否有二次偏移，不能用 margin 伪修。
- 根因：菜单层级 `--z-menu: 9000` 按全局规则高于 hint 的 `--z-hint: 4000`，而这个 hint 恰好由菜单内部触发；向下放置后大部分气泡被菜单自己盖住，只在菜单下方 / 右下侧露出。
- 修复：两种 Viewer chrome 的两个帮助入口统一改为向上；`TooltipLayer` 仅对“触发器位于当前 menu 内”的气泡标记 menu context，并提升到该 menu 上一层，不改变 unrelated tooltip < menu 的全局原则。
- 验证：Tooltip / FileViewer 聚焦 4 条通过（同文件其余 312 skipped）；本地真实分享菜单 hover 截图确认 tooltip 完整贴在问号上方，不再掉到底部。

### 11. 会话切换弹层下半部点击无响应

- 状态：**已修复并推送**，包含于 `bb4292e82b fix(chat): close remaining panel regressions`；聚焦测试覆盖 meta 区点击，尚未对截图中的下半部真实点击做 post-fix E2E。
- 复现：点击 ChatPanel 右上角会话切换后，列表下半部的会话行（含 `0 msg / 2 msg` 元数据区域）点击无响应，无法切换。
- 审计重点：整行与右侧删除按钮的命中区、透明遮罩、pointer-events、z-index / stacking context、拖动区域；同时判断是否与上述 tooltip / portal 层叠问题同源。
- 根因一：行虽然有 pointer / hover，但 `onSelect` 只绑在标题 button；messageCount、耗时和空白区域天然不响应。根因二：菜单困在 header `z=7`，而消息 rail 是 `z=8` 且带 20px 透明命中区，菜单最右侧约 12px 被截获。
- 修复：选择处理上提到整行，删除按钮继续 stopPropagation；header 提到 z=9 越过 rail 与回到最新按钮。
- 验证：新增点击 meta 的红测，修后 conversation menu 自动切换并关闭；2 文件 13 条通过，`git diff --check` 通过。该问题与分享 tooltip 不同源。

### 12. 顺序生图时缺少运行中 ImageRow

- 状态：**已修复并推送**，包含于 `bb4292e82b fix(chat): close remaining panel regressions`；最终版本尚未重新跑顺序生图 E2E。
- 复现：AMR / ACP 按顺序逐张调用媒体生成时，执行计划只显示 Todo 行；当前正在生成的图片没有出现设计稿中的 Media ToolRow，也看不到绿色 PixelLiquid loading。
- 用户裁决：逐张生成可以接受；每个正在生成的调用至少显示一行、一个绿色 loading cell，不需要为了凑总数伪造尚未创建的图片任务。
- 根因：ACP 的 terminal tool pair 在工具结束时才落 `tool_use`，而 ChatPane 原来需要先从事件中看到 media command 才开始轮询 task；首个运行中 task 因而既没有 tool event，也没有被拉取 / 消费。
- 修复：streaming assistant run 现在即使还没有 terminal media `tool_use`，也会按 runId 拉取 media task；未被 terminal tool event 消费的 live task 会在当前 Todo 下生成一条单格 ImageRow，cell 显示绿色 loading。terminal event 到达后同一 task 会被 cursor 接管，不重复一行。
- 聚焦验证：`build-turn-blocks.test.ts`、`ChatPane.media-task-polling.test.tsx` 已覆盖 live polling、单格 loading、terminal 接管不重复和失败格顺序。

### 13. DSML 内部协议尾标泄漏到最终正文

- 状态：**已修复并完成 test-AMR live + reload E2E，当前补丁待提交推送（P1）**。
- 复现：AMR 会话结论末尾出现 `</｜｜DSML｜｜parameter>`、`</｜｜DSML｜｜invoke>`、`</｜｜DSML｜｜tool_calls>`；这些是内部工具调用序列化协议，不是 Agent 正文。
- 根因一：截图时真正承载该项目的 `chatpanel-e2e` daemon 是 09:35 启动的旧进程，早于 `bb4292e82b`，所以新抑制器根本没进入真实运行链；不能把旧 daemon 上的截图当作新代码回归。
- 根因二：历史 scrub 的正则只接受紧邻的 `||` / `｜｜`，对 `| | DSML | |` 这种管道内部含空格的变体不稳健。实时 suppressor 会 compact 空格，但 DB 历史回放没有同等能力。
- 修复：工具文本抑制器精确剥离三段 DSML protocol tail，覆盖全角 / ASCII 竖线、管道内部空格和跨 chunk；DB 读取历史 assistant message 时做同一精确 scrub。正常 Markdown / 代码示例不剥离。
- 聚焦验证：`text-suppression.test.ts`、`db-message-events.test.ts` 本轮 23/23 通过，新增 spaced ASCII、split stream、跨 status / tool event 历史回放；`git diff --check` 通过。
- 真实 E2E 环境：namespace `chatpanel-e2e`，daemon `http://127.0.0.1:56183`，web `http://127.0.0.1:56184`；AMR profile 曾错误回落 `prod` 且余额为 0，已通过 app config 修正为 `test`，wallet 返回 `$19.8977`，UI 显示 `$19.90`。
- 历史回放：原项目 `3d02a559-745b-44c2-a8e4-2c82c9468a6d` / 原会话 `ed6de411-4f5d-4b33-b977-5d2c72d29404` 在新 daemon 上打开后，协议残留计数为 0，旧的三条建议可见。
- 新实时回合：会话 `a04e85da-b1b3-4c57-8b3e-9c09ebbe2a5f`，run `0b53f7f8-847f-43d5-b749-7d9d2a1fee51`。发送后立即显示进行中，40s 后为已完成；正文 `DSML E2E 验证完成`，三条 `next_steps` 正常展示。live 协议残留 0，reload 后协议残留仍为 0、建议仍为 3 条；run events 中无 `parameter / invoke / tool_calls` 尾标，存在结构化 `next_steps` 事件。
- 验收边界：这是最新源码 + test-AMR 的开发桌面 / web / daemon E2E；尚未重打、安装并验证新的 Beta 包。

### 14. 成功轮因最后 Todo 快照陈旧而误显示“已停止”

- 状态：**已修复并推送**，包含于 `bb4292e82b fix(chat): close remaining panel regressions`；只有聚焦测试，尚无真实 stale Todo 成功轮 E2E。
- 真实现场：run `9529a731-88c2-4693-ae72-abafdd5703ea` 的状态为 `succeeded`，已有最终总结并发出匹配本轮 nonce 的 `<od-done>`；但 Agent 在完成总结后漏发最后一次 TodoWrite，末项“简短总结新图”仍为 `in_progress`。
- 旧 UI：只把最后 TodoWrite 快照当权威，因而显示“已停止，仍有未完成任务”并提供“继续剩余任务”。这不代表进程取消或媒体任务失败。
- 修复：不粗暴信任所有 `succeeded`；只有 `runStatus=succeeded` 且事件里存在本轮 `done_key` 匹配的 `<od-done key="…"/>`，并且 marker 后有可见最终结论时，才把陈旧 Todo 判为已交付。失败 run、截断 run、空 marker、错误 nonce、代码里的 marker 仍保留未完成入口。
- 聚焦验证：`run-completeness.test.ts`、`runs.test.ts`、`todo-recall.test.tsx`、`authenticated-done.test.ts` 已覆盖 contracts / daemon / UI 三层。

### 15. Design Harness / OD Next 与普通 Chat Panel prompt 协议分叉

- 状态：**已完成只读审计，需单独架构修复与 A/B 覆盖；本轮未改提示词**。
- 用户强约束：以后每次修改 Todo、Question Form、`<od-done>`、`<od-next>`、`<od-focus>` 等 Chat prompt / host 协议，都必须同时审计 Design Harness 开 / 关两条路径；不能只验证普通 chat。
- 已确认调用链：普通 chat 走 `composeChatAgentTextPayload`，由 `server.ts` 每轮注入带本轮 nonce 的 done / next / focus；OD Next 一旦存在 `strategyTaskAtStart`，则直接使用冻结的 `persistedStrategyFinalText`，跳过这组 per-turn contributor。
- 初始 Bundle 虽存在 `context/client_system_prompt`，但在 Run 创建、`doneKey` 铸造之前冻结，当前无法携带本轮 nonce；后续 clarification / production continuation 又要求 exact stage input，同样不会自动拼普通 per-turn slice。
- 现场吻合：开启 Design Harness 后最终产物轮缺少三条下一步建议，不是偶发模型不遵守，而是该物理 Run 没收到同一份 `<od-next>` 协议。
- Todo 差异：普通 discovery prompt 明确要求每步开工前 `in_progress`、做完立刻 `completed`；OD Next core 当前只写“Keep the Todo plan live”，Production continuation 只说复用 frozen Todo plan，约束明显更弱。不能直接复制整份普通 prompt，应把需要共享的 host protocol 与状态契约注册为两条路线共同消费的 contributor，并保留 exact-input / cache 边界。

### 16. “基于此项目创建设计系统”自动消息仍使用旧灰卡

- 状态：**已修复并推送**，包含于 `bb4292e82b fix(chat): close remaining panel regressions`；只有聚焦测试，尚无菜单触发后的 post-fix E2E。
- 复现：在 FileWorkspace 菜单点击“基于此项目创建设计系统”后，客户端会自动发送一条隐藏的长 prompt；ChatPane 将它替换为一张灰色英文状态卡 `Creating design system workspace`，与新版黑色用户消息不一致，中文界面也暴露硬编码英文。
- 审计结论：这是唯一一个把 user-side auto prompt 渲染为专用旧卡的分支。设计稿没有这种灰卡，语义上也仍是用户触发并自动发送的请求；应归入设计稿 #1“用户消息-文本”。附件、Question Form 回填、Thinking、Plan、ToolRow、Queue、升级、报错、暂停和重连均有各自设计稿角色，不应统一涂黑。
- 修复：复用 canonical `UserBubble`，只展示现有 typed i18n 文案 `designFiles.createDesignSystemFromProject`，不泄露内部长 prompt；复制动作复制可见的本地化摘要。移除旧灰卡、两个硬编码英文 display 常量和废弃 CSS；首轮 fallback 会话标题同步复用该 i18n key。
- 额外 i18n 修复：suppressed-direction StatusPill、SkillPluginCandidateCard busy 文案、`context_compaction` 已知状态均已接入 typed Dict 和 19 locale；未知 runtime status 仍原样展示，不做盲译。这些仍保留 assistant structured / recovery UI 的专用样式，不混同为黑色用户气泡。
- 聚焦验证：自动 DS prompt 渲染用例 1 条通过（32 skipped），prompt 识别用例 4 条通过；新增 zh-CN 系统 copy 用例 4 条通过并覆盖 unknown runtime label 保留；`git diff --check` 通过。未跑全量测试。

### 17. AMR 发送前权威预检期间界面静默

- 状态：**已修复并推送**，包含于 `c60bbe7f5b fix(chat): tighten pending and terminal feedback`；test-AMR E2E 已确认消息发送后立即出现“进行中”，但未人为制造慢余额预检来单独复验“正在准备”胶囊。
- 复现：使用 AMR 发送后，workspace billing 权威预检可能等待数秒；消息在预检通过前不会持久化，而 Composer 原来只有防重复提交的 ref 锁，没有任何可见状态，看起来像点击无效或客户端卡死。
- 修复：保留预检先于消息持久化的计费安全边界；异步 send admission 期间，发送键立即切换为带动态矩阵的“正在准备”胶囊并禁止再次点击，预检通过后再进入正常 streaming / stop 状态。余额拦截时仍不会伪造已发送消息。
- 聚焦验证：`ChatComposer.infinite-render.test.tsx` 新增 deferred send gate 用例，覆盖即时反馈、draft 保留、resolve 后清理。

### 18. 生图运行行首误用灰色 thinking-orb

- 状态：**已修复并推送**，包含于 `c60bbe7f5b fix(chat): tighten pending and terminal feedback`；只有 primitive 聚焦测试，尚无最终顺序生图 E2E。
- 复现：设计稿“生成配套插图 N/M”运行态的行首是绿色自转球；生产 `ImageRow` 却直接使用单色 `Orb solving`，与壳头 / thinking 的灰色动效混在一起。
- 修复：复用现有步骤级 `StatusMark status=running`，即设计稿已经对齐的八层锥形渐变绿色自转球；未新增另一套动画或色值。
- 聚焦验证：`primitives.test.tsx` 断言运行中 ImageRow 使用绿色 run mark，且不再渲染 `[data-orb]`。最终与 AMR pending、手动终止 / 重连相关用例合计 8 文件 103 条通过；未跑全量测试。

### 19. 手动终止后重复显示独立“已手动暂停任务”行

- 状态：**已修复并推送**，包含于 `c60bbe7f5b fix(chat): tighten pending and terminal feedback`；2026-08-29 已补 test-AMR 真实手动停止 E2E。
- 复现：用户手动停止一轮后，Assistant footer 已显示“已手动停止”，ChatPane 流水尾部又根据 `canceled + cancelOrigin:user_stop + unfinished todos` 追加“已手动暂停任务”，同一终态出现两遍；刷新后的历史回放也会复现。
- 根因：`cancelOrigin:user_stop` 证明的是用户终止 run，不代表任务进入可恢复的 paused-task 领域状态；旧接线把两种语义混为一谈。
- 修复：删除 ChatPane 对 run canceled 状态的 PauseLine 映射，只保留回合 footer；PauseLine 设计组件仍保留给未来真正的 paused-task 状态，但不再接受 `RunCancelOrigin` / Todo 余量作为输入。重连终态撤行和“继续剩余任务”入口保持不变。
- 聚焦验证：覆盖 live `running -> canceled` 与 JSON 历史回放，两条路径均只显示 footer、不再出现 `chat-pause-line`；最终与 AMR pending、生图状态、重连 / Todo 相关用例合计 8 文件 103 条通过，`git diff --check` 通过；未跑全量测试。
- 真实 E2E：test-AMR 运行中点击停止后，回合底部只出现一次“已手动停止”与“继续剩余任务”，没有再出现独立“已手动暂停任务”行。

### 20. Composer 上方消息队列外框左右未对齐

- 状态：**已修复，当前补丁待提交；聚焦测试已绿，待真实队列视觉复验**。
- 复现：队列卡片的左右外框比下方 Composer shell 各外凸约 16px。
- 根因：Composer 自身水平 padding 为 16px，但晚写的 `.chat-queued-send-strip { width: 100%; margin-inline: 0 }` 覆盖了早先内缩；恢复淡边框后，队列作为 Composer 的兄弟节点自然占满 pane，比输入框外框更宽。
- 修复：在 `.pane` 以 `--chat-composer-inline-inset: 16px` 作为横向基线单一来源；Composer padding、queue margin 和 queue `calc()` width 共用该 token。
- 红绿验证：`queue-strip-border.test.tsx` 在旧 CSS 下先红，修复后相关 3 个文件 19 条测试通过；仅有既有 jsdom canvas warning，未跑全量测试 / typecheck。

### 21. 新 Chat Panel 对旧版本会话的兼容性验收

- 状态：**channel 历史体检与精确版本回放均已完成；P0 与 P1 已在本地修复并通过聚焦回归 / 同机 A/B，另有 1 个低优先级语义图标问题**。完整截图报告见飞书文档 `Chat Panel Next 旧会话兼容性验收报告（2026-08-29）`。
- 离线历史重放：只读扫描 dev / stable / legacy-beta / beta / prerelease 共 5 份 channel 数据库，覆盖 95 个会话、243 条 assistant message、126,835 个事件。`buildTurnBlocks` 异常 0、同条消息内重复结论 0；实际 UI / API 重放的 DSML 残留为 0。这里的 channel 目录只能证明数据来源，单条历史消息没有持久化客户端 commit / version，不能据此宣称其精确生成版本。
- 精确版本回放：分别在 `main@a8ec5784eb13a248f5ff3586800819fa070ea250` 与 `open-design-v0.21.0@dbbd3b42eab9609065637452b347f903d7125ecd` 的 daemon/runtime/parser/DB 持久化链生成同一份确定性 Thinking + Todo + 两次媒体工具调用 fixture，再复制不可变 producer DB 给当前分支 `c90c1e899e` 消费。producer DB SHA-256 分别为 `aed1a4078f813aac03a59101dcaefc4daeed879fd6a1047c4aed57703fa49e65` 与 `211fb9389ce1a0f7b73d4c8298b1cb771a184435362d693526417d25a6534664`。
- 精确版本结果：两组当前 UI 首次打开及连续 2 次硬刷新均保持 `assistant=1`、`details=5`、消息内图片 `=2`、结论 `=1`、DSML `=0`；两张图片都按当前 ImageRow 恢复。fixture 故意保留第二项 Todo 为 `in_progress`，因此 footer 显示“已停止，仍有未完成任务”，这验证 unfinished 历史语义，不是回放失败。producer 原始 DB 未被当前 daemon migration 修改。
- 组件覆盖：Thinking Markdown、Plan / Todo、读 / 写 / 搜索 / 执行 / 删除 ToolRow、Question Form（待答 / 已答）、产物文件、错误卡、失败 / 手动停止 footer、绝对路径文件链接、附件和结构化 next_steps 均有 channel 历史样本；ImageRow 另有上述两个精确 producer 版本样本。纯 content-only assistant、音频产物、Queue、待发送附件、重连与升级属于样本缺口或瞬时状态，不能从持久化旧会话证明。
- 组合与刷新：stable 的 Question Form + Plan + ToolRow + 结论 + 错误卡组合、legacy-beta 缺失 `run_status`、beta 手动停止、prerelease 87 个 details 的长执行记录均可打开；多组 2–3 次硬刷新后消息数、结论数、Question Form 数与 terminal footer 稳定，无重复 assistant hash、无协议残留。首次从“手动展开全部 details”进入刷新时 hash 会因折叠状态复位变化，后续轮次稳定，不是正文重复。
- 交互验证：旧文档附件点击会打开对应文件标签；旧绝对路径 Markdown 链接能解析为当前项目文件并在 workspace 内切换；未回答 Question Form 连续刷新仍保持可交互。
- P0 上线阻断（本地已修）：设计稿 #16 明确“点击建议只填入输入框，不直接发送”，但原实现会立即持久化 user message 并创建新 run。现已改为 `composerRef.setDraft(prompt, { entryFrom: 'next_step' })`；live 回合与经过 JSON 持久化边界的历史 replay 红绿用例均断言只填草稿、`onSend` 未调用、消息数不变。相关 3 个文件 56 条聚焦测试通过，待集成后真实 UI 复验。
- P1 性能（本地已修）：精确 63,472-event Beta message `ab7ff827…` 中，61,614 条 thinking + 1,771 条 text 在 daemon 归一化后只有 125 events / 2 blocks，parse + normalize + serialize + client parse + build 合计仅十几毫秒；消息 API 热读为 5.6–9.2ms，确认 3 秒以上首开不在 parser / API。补丁把已结束、初始折叠的 ExecutionShell / Thoughts / Plan / Todo / 命令正文改为首次展开再挂 DOM，live / failed / in-progress / default-open 首帧仍挂载，且首次展开后再次折叠不会丢子状态。完全相同的相邻 `TodoWrite` 快照另在 daemon 与 live buffer 两侧窄范围折叠，普通 Bash / 其他工具不做深比较。
- P1 同机 A/B：同一 Beta 数据副本、同一 63,472-event 会话、同一 Playwright 脚本、均预热排除 Next 冷编译；`c90c1e89` 三次 ready 为 13.35s / 10.75s / 8.02s（中位 10.75s），补丁后为 5.73s / 5.12s / 6.07s（中位 5.73s，约 -46.7%）。目标 assistant 初始后代 DOM 从 2,799 降到 119（约 -95.7%），初始 details 从 29 降到 1。该数据来自 dev runtime，证明方向与量级，不替代 production / Beta 包门槛。
- P1 重复快照样本：真实 9,280-event TodoWrite 样本在通用原型中从 9,280 events / 4.19MB 压为 15 events / 2.2KB；最终实现进一步收窄为 TodoWrite-only，测试覆盖 pending→completed 变化、Question Form 文本边界、next_steps 保留以及相同 Bash 不去重，避免普通 same-id/different-state 流的 stringify 退化。
- P2 语义图标：prerelease 历史里的删除命令已正确显示“删除”，但 ToolRow 仍复用写入的铅笔 icon；数据和动作识别正确，仅视觉语义未闭环。
- 验证边界：按用户要求未跑全量测试；本轮使用只读历史扫描、不可变 producer DB、隔离 consumer 副本、真实 Web UI、硬刷新、DOM 结构断言和设计稿截图对照。P0 / P1 只跑聚焦测试与单一长会话 A/B；web typecheck 仍被 3 个既有无关测试类型错误阻断（`thinking-markdown.test.tsx:37`、`artifact-card-desktop-viewport.test.ts:46/49`）。

## 已完成 / 已合入本分支

### 修复批次 `c5b047dfd9 fix(chat): address module feedback regressions`

- 已推送到 `origin/feat/chat-panel-next-impl`。
- 包含：
  - OPEND-2420：历史菜单打开时保留“回到最新”，并修复 z-index。
  - OPEND-2418：图片预览 border 使用 `box-sizing: border-box`。
  - OPEND-2415：反馈提交合并时保留较新的 optimistic feedback。
  - OPEND-2411：thinking dots 垂直居中。
  - OPEND-2409：无保存自定义值时，项目 chat / preview 默认 1:1。
  - OPEND-2406：历史 / live thought collapse 回归覆盖。
- 验证：5 个测试文件 / 52 tests；FileWorkspace 定向 4 passed / 94 skipped。未跑全量。

### 模板 / 插件上下文错误

- 主线 PR：<https://github.com/nexu-io/open-design/pull/7533>
- 用户已确认该 PR 合并。
- 本分支需要持续确认已集成对应提交，避免首页选择的模板进入会话后被错误替换为“克制的 COO 经营复盘”，或顶部“正在使用”插件消失 / 显示错误。

## 已确认但本轮未修改

### OPEND-2410：Agent 没有 Todo

- 诊断确认：目标 Claude Run 没有发出 TodoWrite / TaskCreate / TaskUpdate / update_plan / write_todos；不是 UI 丢数据。
- beta.4 已包含 Claude todo tool enablement 和前端识别链。
- 不应在客户端伪造 Todo；可另设计 `plan_missing` 状态，诚实显示“Agent 尚未发布计划，正在无计划执行”。
- 提示词改动必须谨慎；用户明确要求 question-form / Todo 等提示词先斟酌，不能继续机械堆提示词。

### Strategy 长时间运行 / 超时

- `OD_NEXT_STRATEGY_MAX_RUN_DURATION_MS` 是运行结束后的 rollout 观察阈值，不是硬超时；不能直接复用为进程终止 deadline。
- 如要加 wall-clock timeout，需独立配置并覆盖 cancel race、ACP abort、进程树终止、termination barrier、禁止自动重试和 strategy blocked 收敛。

## 用户已明确的长期产品决策

- Composer 的“设计”是固定默认能力，不可选择；首页和对话内都不显示可切换的“设计”选项。
- question-form 有多种形态，底部按钮和 footer 必须逐态对齐主设计稿，不得自行发挥。
- 主设计稿：`/Users/elian/Documents/od-design-artifacts/chat-panel-next.html`
  - md5：`28ea4c6558d6158e88976e11283e269e`
- 场景稿：`/Users/elian/Documents/od-design-artifacts/chat-panel-scene.html`
- Codex beta 验证希望开启 app-server transport；打包 / 发布时需显式确认 `OD_CODEX_TRANSPORT`。
- 不跑全量测试，避免占满用户电脑；使用聚焦测试与必要的本地 UI 验证。

## 下一次接手时先做

1. `git status --short --branch`，确认 DSML spaced-pipe 与 queue alignment 补丁是否已经提交推送。
2. 优先修 #1 / #15：将 Chat turn host protocol 抽成普通 run 与 Design Harness 共用 contributor，并补 Harness 开 / 关 A/B 覆盖；改提示词前先审查 exact-input / cache 边界。
3. 为 OPEND-2410 决定产品方案：修 Agent Todo contract，或新增诚实的 `plan_missing` 状态；不要在客户端伪造 Todo。
4. 按上述全量复核清单补缺失的 post-fix 真机 / E2E，尤其是 OPEND-2195 / #12 顺序生图、#11 会话行下半部、#19 手动停止、#2 Ctrl+Shift+R。
5. 跟进 Question Form 组件族设计评审；视觉基准仍是 `chat-panel-next.html`。
6. 每完成一项，更新本文对应状态、测试层级和是否真实 E2E，禁止把聚焦测试写成真机验收。

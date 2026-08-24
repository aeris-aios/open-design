# Free Pricing Demo Design

## 1. 背景与目标

Open Design 当前 Pricing 页面以 `Go / Plus / Pro / Max` 展示个人套餐。产品方案 Demo 需要下掉 Go，并在原位置恢复历史 Free 档，同时保留最新 `main` 上已经上线的 Pricing 视觉、模型展示、月付/年付切换、个人/团队切换和交互优化。

本次目标是在隔离的本地分支中形成可浏览、可评审、具备后续发布基础的完整 Demo。完成后，个人套餐区应统一呈现 `Free / Plus / Pro / Max`；Go 不再出现在页面内容、交互数据、结构化数据、埋点兼容层或测试契约中。

## 2. 产品定义

Free 档恢复 Go 上线前已经使用过的定义：

| 字段 | 中文展示 | 行为 |
| --- | --- | --- |
| 套餐名 | Free | 固定，不随计费周期变化 |
| 价格 | $0 / 月 | 不参与月付、年付价格计算 |
| 价格说明 | 永久免费 | 不显示折扣、划线价或续费价 |
| 定位文案 | 配置自己的 Agent 或 BYOK，免费使用 | 使用历史免费档语义 |
| CTA | 免费开始 | 进入通用 Open Design Cloud 控制台，不触发 Go 或付费订阅结账 |
| 并发 | 1 个任务并发 | 固定权益 |
| 核心权益 | BYOK 自带密钥，支持本地 Coding Agent；社区支持 | 不承诺托管模型额度 |
| 模型体验额度 | 默认不展示 | 延续历史关闭状态，不恢复 7 天体验额度活动 |

Plus、Pro、Max 的价格、权益、推荐状态和结账逻辑保持不变。团队套餐不在本次产品方案范围内。

## 3. 页面设计

采用“最新页面上的最小替换”方案：保留当前四列卡片布局和 Atelier Zero 视觉体系，将第一张 Go 卡替换为 Free 卡。Free 卡沿用普通浅色卡片样式，避免使用 Go 的字标、首月折扣、模型无限量模块和付费 CTA 状态。

Free 卡仍与其他三档保持相同的卡片骨架和视觉高度，但信息层级更克制：套餐名与免费定位在顶部，`$0 / 月` 和“永久免费”构成价格区，随后是“免费开始”按钮和三项核心权益。月付/年付切换只更新 Plus、Pro、Max；Free 卡保持不动，从而清晰表达它不是订阅计费档。

桌面端继续使用四列比较；移动端沿用现有横向或单列响应式规则。键盘焦点、减少动态效果和现有可访问性语义保持不退化。

## 4. 信息架构与组件边界

### 4.1 Pricing 页面入口

`apps/landing-page/app/pages/pricing/index.astro` 继续负责页面结构、SEO 和 Cloud Console 交接。它将移除 `GO_PLAN` 的导入和 Go 付费 Offer，改为输出价格为 0 的 Free Offer。Free CTA 使用通用 Cloud Console 入口，不带 `plan=go`、计费周期或自动结账参数。

### 4.2 个人套餐组件

`apps/landing-page/app/_components/pricing-individual-plans.astro` 继续负责四档卡片、模型对比和权益表。第一档数据改为内容型 Free 配置，Free 不进入付费价格计算，不复用 Go 的模型访问、价格动画或折扣数据。

套餐对比表的第一列改为 Free。Free 对托管热门模型、旗舰模型和图片模型均显示不可用；其可用能力通过 Free 核心权益表达，避免把 BYOK 与 Open Design 托管模型额度混为一谈。

### 4.3 本地化内容

`apps/landing-page/app/_lib/pricing-content.ts` 将 Go 内容类型与各语言 Go 文案替换为 Free 内容类型与历史 Free 文案。现有全部 locale 保持可构建；中文是本次视觉验收主语言，其余语言至少通过内容契约和构建测试。

### 4.4 定价契约与当前套餐关系

`apps/landing-page/app/_lib/pricing.ts` 的付费个人套餐类型只保留 `plus / pro / max`，删除 `GO_PLAN` 常量。Free 是内容型入口，不加入静态付费套餐 JSON，也不伪造月付或年付价格。

当前套餐关系模块中，Free 作为等级最低的页面状态保留，用于正确判断 Free 用户升级至 Plus、Pro、Max；任何来自旧系统的 `go` 当前套餐值不再生成可选卡片或结账目标。若需要兼容旧账户状态，只在输入归一化边界将它视作低于 Plus 的遗留状态，不向页面文案和埋点输出 Go。

### 4.5 埋点与兼容层

Pricing 页面曝光、计费周期切换和 CTA 事件的个人套餐集合改为 `free / plus / pro / max`。Free 曝光携带零价格、零模型额度和非付费属性；Free CTA 不应上报订阅结账开始。所有事件名称保持现有契约，避免扩大 Demo 改动范围。

## 5. 数据与交互流

1. Astro 构建时加载本地化 Free 内容与现有 Plus、Pro、Max 定价快照。
2. 首屏静态输出 Free 和三个付费档，保证 SEO 与无脚本访问可读。
3. 用户切换月付/年付时，只更新三个付费档的价格、优惠和 CTA 参数。
4. 用户点击 Free CTA 时进入通用 Cloud Console；点击付费档 CTA 时继续携带明确的套餐和周期进入结账。
5. 已登录用户状态返回后，页面根据当前付费等级更新 Plus、Pro、Max 的升级、降级或当前套餐状态；Free 只承担免费入口与最低等级展示。

## 6. Go 清理范围

以下可见或行为触点都必须移除 Go：

- 顶部个人套餐卡、套餐字标、标签、价格和 CTA；
- 热门模型、旗舰模型、图片模型模块及完整套餐对比表；
- FAQ、脚注和其他 Pricing 页面文案；
- Product JSON-LD Offer 和 SEO 描述中的 Go 套餐；
- Cloud Console 跳转参数、自动结账目标和当前套餐按钮状态；
- Pricing 兼容埋点目录、曝光上下文和事件属性；
- Pricing 相关单元测试、契约测试及硬编码套餐列表；
- Pricing 专用样式中的 Go 字标和 Go 独有规则。

全仓库中与历史记录、迁移代码或非 Pricing 产品逻辑相关的 Go 字样不做无关清理。

## 7. 异常处理与兼容策略

Free CTA 不依赖计费目录，因此付费计划 JSON 加载失败时仍应可用。Plus、Pro、Max 继续使用现有静态快照兜底和 Cloud Console URL 校验。

如果旧账户仍返回 `go` membership tier，页面不得重新展示 Go 或生成 Go 结账链接。该输入应在状态解析边界兼容为遗留最低档，确保升级按钮仍可工作。未知套餐、无效计费周期和不可信 Cloud Console 地址继续沿用现有失败策略。

## 8. 测试与验收

### 8.1 自动化验证

- Pricing contract tests：断言个人套餐为 `free / plus / pro / max`，且不存在 `GO_PLAN`、`plan=go` 或 Go Offer。
- Current-plan tests：覆盖 Free、Plus、Pro、Max 的当前套餐关系，以及旧 Go 输入的兼容归一化。
- Analytics tests：Free 曝光为零价格且不触发付费结账；套餐列表不输出 Go。
- Static build/typecheck：Landing Page 构建和类型检查通过。
- 文本扫描：Pricing 作用域内不再包含面向用户或行为输出的 Go 套餐引用。

### 8.2 浏览器验收

- 中文桌面页面显示四档 `Free / Plus / Pro / Max`，布局无溢出或错位。
- 中文移动页面可完整浏览四档，CTA 和展开交互可用。
- 月付/年付切换不改变 Free 卡，付费三档仍正确变化。
- 个人/团队切换、模型展开、完整对比表和 FAQ 交互无回归。
- Free CTA 不包含 Go、付费周期或自动结账参数。
- 页面源代码中的 Product JSON-LD 包含 Free 0 美元 Offer，不包含 Go Offer。

## 9. 非目标

- 不调整 Plus、Pro、Max 或团队套餐的定价与权益；
- 不恢复 Free 的 7 天托管模型体验额度；
- 不改造 Cloud Console 的订阅管理页面；
- 不在本次 Demo 中发布生产环境或触发 Cloudflare 部署；
- 不进行与 Pricing 无关的全仓库 Go 文案清理。

## 10. 待办

### Agent-executable after approval

**实现 Free Pricing Demo。** 目标是按本规格完成本地可浏览页面。步骤包括替换内容和组件数据、清理 Go 全链路、更新 SEO/埋点/测试、运行类型检查与构建、启动本地页面并完成桌面和移动视觉验收。交付物为隔离分支代码、本地预览地址及验收截图。成功标准为第 8 节全部通过。副作用仅限 `codex/free-pricing-demo` 分支和独立工作区，不发布、不推送、不改当前分支。

**准备发布前变更说明。** 目标是在 Demo 获得确认后整理可用于 PR 的变更摘要、测试证据和风险说明。交付物为 PR 描述草稿；不会主动创建 PR、推送或发布，除非用户另行授权。

### Needs user input or external ownership

**Demo 视觉与产品验收。** 需要用户在本地预览后确认 Free 档的文案、权益表达和整体页面是否满足产品方案。确认前不会进入发布流程。

**正式发布授权。** 生产发布涉及推送分支、创建或合并 PR，以及手动触发 production workflow，需要用户在 Demo 验收后明确授权并决定发布窗口。

---
title: "Open Design 0.21.1 — 社区优先：无需登录"
description: "Open Design 一直扎根于社区。现在，我们重新兑现这一承诺：无需账号。直接从 Home 选择本地 CLI 或 BYOK，即刻开始创作；需要时，Open Design Cloud 仍随时可用。"
---

### 🌟 Codename: Community First: *No Login Required*

🔓 **Open Design 一直扎根于社区。现在，我们重新兑现这一承诺：无需账号。** 直接从
Home 选择本地 CLI 或 BYOK，即刻开始创作；需要时，Open Design Cloud 仍随时可用。

## 🔥 亮点

- 🔓 **无需登录即可开始。** 开始创作前，Open Design 不再要求必须拥有 Cloud
  账号。 (#7381) 感谢 @Siri-Ray。

- 🧰 **直接从 Home 使用自己的工具。** 选择已有的本地 CLI，或通过 BYOK 连接你
  偏好的模型服务商。 (#7381) 感谢 @Siri-Ray。

- 🧪 **Open Design Labs 正式登场。** 在 Settings 中开启 Open Design Harness，
  即可试用新的生成策略并获得更精致的结果；更多实验能力也将陆续到来。
  (#7445, #7514) 感谢 @lefarcen。

> 📥 **下载：** Tag
> [`open-design-v0.21.1`](https://github.com/nexu-io/open-design/releases/tag/open-design-v0.21.1)
>
> | 平台 | 架构 | 安装包 |
> |---|---|---|
> | macOS | Apple Silicon | [DMG](https://github.com/nexu-io/open-design/releases/download/open-design-v0.21.1/open-design-0.21.1-mac-arm64.dmg) |
> | macOS | Intel | [DMG](https://github.com/nexu-io/open-design/releases/download/open-design-v0.21.1/open-design-0.21.1-mac-x64.dmg) |
> | Windows | x64 | [安装程序](https://github.com/nexu-io/open-design/releases/download/open-design-v0.21.1/open-design-0.21.1-win-x64-setup.exe) |

## ✨ 新增

### 创作与实验能力

- 🧪 **Design Harness 现在只差一个开关。** 设置中新增 Open Design Labs；无需另装
  build，也不用打开终端，就能选择下一代生成策略。页面会解释当前覆盖范围，选择可
  跨重启保存；当其他策略接管开关时，也会直接说明原因。 (#7445)

- 🖼️ **真实对象使用真实图片。** 原型提到具体人物、产品、作品、活动或地点时，
  Open Design 会先查找并使用对应的真实图片，不再生成似是而非的替代品。图片会保留
  原始比例和完整画面，而不是被旧 placeholder 的比例强行裁切。 (#7436)

- 📱 **OD Next 开始理解手机界面的结构骨架。** 日期格、统计条、设置项、顶部栏、
  底部导航、图片和确认弹窗都有对应布局原语；生成的手机原型不再把不同模式压成同一
  种通用横排。 (#7327)

### Team 协作

- 🧭 **大型 Team workspace 可以限制后台追赶的累计规模。** 显式开启累计预算后，
  后台物化不会无限增长；主动打开项目的前台路径仍然即时可用，不受这项预算阻塞。
  (#7403) 感谢 @lefarcen。

## ⚡ 性能与可靠性

- ⚡ **Team 项目从热路径打开。** 重复读取项目列表和深链时，会复用短时且严格隔离
  workspace 的缓存；分享、取消分享或切换 workspace 后则立即失效。 (#7398)
  感谢 @lefarcen。

- 🚀 **Home 启动时不再让隐藏页面争抢资源。** 重复的 catalog 请求会被合并；
  Automations 区域在真正打开前不会提前拉取数据。 (#7408, #7413)
  感谢 @lefarcen。

- 🧹 **停止任务，现在代表整个任务都真正停止。** 取消、超时、失败、重试或退出 App
  时，Open Design 会在宣布 attempt 结束前清理完整的 Agent 进程树，避免遗留子进程
  继续运行和消耗资源。 (#7432) 感谢 @Siri-Ray。

## 🐛 修复

### Agent、模型与配置

- ☁️ **退出 Cloud 不再关掉本地工作的入口。** 未登录或 Cloud 暂不可用时，Local
  Agent 与 BYOK 仍然可以选择；退出 Cloud 后，这台设备上的 provider key、Base
  URL、模型选择与媒体默认值也会完整保留。 (#7381, #7437) 感谢 @Siri-Ray。

- 🧭 **任务错误会指向真正有用的下一步。** Agent 握手不兼容时，会建议切换 Agent
  版本而不是无意义重试；会员并发达到上限时，会显示重置提示；AMR 模型被拒绝后会
  保留原始原因，不再继续发送注定失败的 prompt。 (#7303, #7429, #7458)
  感谢 @lefarcen、@Siri-Ray。

- 🚦 **真实的上游限制不再被“空输出”盖住。** 额度、限流和服务可用性信号会优先于
  通用的无结果分类，让重试行为跟随真正发生的故障。 (#7248) 感谢 @mturac。

- 💬 **看得到的澄清表单，现在也一定答得了。** Strategy 任务不会再在已显示的提问
  表单背后提前结束，并在提交答案时返回内部状态错误。 (#7509)

- 🔌 **本地引擎缺失时，不再把 App 外壳伪装成接口数据。** daemon origin 未配置时，
  登录、Agent 扫描等 API 请求会显示可识别、可重试的连接失败。 (#7399)
  感谢 @lorenzozanee。

### Studio、预览与导出

- 🧩 **会生成 HTML 的 HTML，不会再拆坏自己的预览。** 打印窗口、邮件模板、
  `srcdoc` 内容，以及脚本或 attribute 中保存的 markup 都会按原样运行。预览、deck、
  PDF 与 artifact 导出会找到真正的文档边界，不再把长得像 tag 的文本误认为页面
  结构。 (#7421, #7422) 感谢 @lefarcen。

- 📊 **可编辑 PPTX 不再“成功”导出一层看不见的背景。** Chromium 首次捕获为空时
  会重试；仍无法得到正确分层画面时，导出会明确失败，不再交付表面成功、实际透明的
  slide。 (#7337) 感谢 @mrcfps。

- 🎛️ **小型编辑控件各守边界。** Chat resize handle 不再抢占滚动边缘的 hover、
  click 和 drag；斜杠命令菜单的每一行保持清楚可读；切换到 Image 时立即选中，
  creation tabs 也不会一起变灰。 (#7324, #7368, #7375)
  感谢 @Siri-Ray、@lefarcen。

### Team、导航与界面

- 💳 **Team 余额跟随当前正在查看的 Team workspace。** Settings 与 Home 会显示
  同一个 workspace 的余额；Team 数据暂不可用时，也不会错误回退到成员个人钱包。
  (#7384)

- 🎞️ **私有项目会使用它所属的 Team 余额。** Vela 图片与视频生成会保留项目绑定的
  Workspace 计费范围，同时不改变项目的私有分享状态。 (#7504)
  感谢 @alchemistklk。

- ↩️ **创建设计系统后，会回到真正的出发点。** 无论从对话、picker、Library、
  Home 还是侧栏进入，Back 都会恢复原始上下文，不再把你丢到一个通用页面。
  (#7367) 感谢 @lefarcen。

- 🌐 **插件与恢复提示会使用 App 当前语言。** Skill 卡片描述跟随所选 locale，并在
  缺少翻译时稳定回退到英文；内置 scenario 缺失时，也会用相同语言说明如何通过
  重新安装恢复。 (#7369, #7325) 感谢 @lefarcen、@Siri-Ray。

- 📣 **Go Plan 下线通知会用正确的语言触达正确的人。** 定向消息的不同版本都能打开
  专属通知；文案、操作按钮与布局跟随 Open Design 当前语言，不再一律回退到写死的
  中文。 (#7430, #7453, #7477) 感谢 @nettee。

- 🔗 **Cloud 授权会回到已安装的 App，而不是弹出一个陌生 Electron 窗口。** 开发
  环境不再接管系统级 `opendesign://` 链接；正式安装包继续正常接收登录和邀请回跳。
  未登录用户也不会再看到必须有账号才能使用的活动 badge。 (#7479)
  感谢 @lefarcen。

- ⬆️ **更新入口回到预期位置。** 未登录的桌面用户现在也会在右上角看到待安装更新，
  与登录状态下保持一致，并避开 Home composer 与 model picker。 (#7482)
  感谢 @Siri-Ray。

## 🙏 感谢所有参与 0.21.1 的贡献者

@alchemistklk · @lefarcen · @lorenzozanee · @mixxer · @mrcfps · @mturac ·
@nettee · @Siri-Ray

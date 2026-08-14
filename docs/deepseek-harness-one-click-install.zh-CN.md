# DeepSeek Harness × Open Design 一键安装指引

> 运营发布状态：文案已可评审，安装脚本尚未发布到正式下载地址。正式对外发送前，请确认下方三个 `open-design.ai/install-dsh.*` 地址均可访问，并分别完成一次 macOS、Windows PowerShell 和 Windows CMD 验证。

## 对外宣发文案

### DeepSeek Harness 已接入 Open Design

现在，你可以在 Open Design 中使用 DeepSeek Harness 完成设计生成任务。

如果电脑上还没有 Node.js、pnpm 或 `dsh`，无需逐项配置环境：运行对应系统的一行安装命令，即可安装 Open Design 当前兼容的 DeepSeek Harness 工具链，并进入 API Key 配置页面。

安装过程不会修改系统级 Node.js，也不需要 `sudo` 或管理员权限；已有的兼容环境会被自动复用。

## 一键安装

### macOS / Linux

打开“终端”，粘贴下面一行并按回车：

```sh
curl -fsSL 'https://open-design.ai/install-dsh.sh?version=1' | sh
```

支持 Apple Silicon、Intel Mac，以及主流 x64/arm64 Linux 发行版。Alpine Linux 暂不支持自动安装。

### Windows PowerShell

打开 PowerShell，粘贴下面一行并按回车：

```powershell
& ([scriptblock]::Create((irm 'https://open-design.ai/install-dsh.ps1?version=1')))
```

### Windows CMD

打开“命令提示符”，粘贴下面一行并按回车：

```bat
curl -fsSL "https://open-design.ai/install-dsh.cmd?version=1" -o "%TEMP%\install-dsh.cmd" && call "%TEMP%\install-dsh.cmd"
```

## 安装完成后

1. 安装器会自动启动 `dsh web`。
2. 在 DeepSeek Harness 的 Models 页面根据引导配置 DeepSeek API Key。
3. 配置完成后，可以按 `Ctrl+C` 关闭 `dsh web`；日常使用 Open Design 时不需要让该页面常驻。
4. 回到 Open Design 的“本地 Agent”页面，点击“重新扫描”。
5. 选择“DeepSeek Harness”。如果出现“安装 Open Design 连接组件”的确认提示，确认安装即可。
6. 点击“测试”；测试通过后即可选择模型并开始生成。

## 安装器会做什么

- 检查电脑上是否已有兼容版本的 Node.js、pnpm 和 DeepSeek Harness。
- 已有环境满足要求时直接复用，不重复下载。
- 缺少环境时，在当前用户目录中安装隔离的 Node.js 和 DeepSeek Harness 工具链。
- 固定安装 Open Design 已验证的版本，避免自动升级造成兼容问题。
- 校验从 Node.js 官网下载的安装包 SHA-256，校验失败会停止安装。
- 为 Open Design 创建可发现的 `dsh` 启动入口，但不会覆盖用户已有的全局 Node.js。

## API Key 与隐私

DeepSeek API Key 在 DeepSeek Harness 自己的页面中配置和保存。Open Design 不要求用户把 Key 粘贴到应用内，也不会将 Key 写入 Open Design 的应用配置。

安装器需要联网访问 Open Design 下载地址、Node.js 官网和 npm registry。它不会上传项目文件或 API Key。

## 常见问题

### 已经安装过 dsh，还需要运行吗？

可以运行。安装器会先检测现有版本；Node.js、pnpm 和 dsh 都满足兼容要求时会直接复用，不会重复安装。

### 安装器会覆盖我电脑上的 Node.js 吗？

不会。自动补齐的运行环境安装在当前用户的独立工具链目录，不修改系统 Node.js，也不替换其他项目使用的版本。

### 为什么安装后终端里仍然找不到 dsh？

先重新打开一个终端窗口。Open Design 会扫描常见的用户级工具目录，通常不需要手动修改 PATH；如果 Open Design 已经打开，请回到“本地 Agent”页面点击“重新扫描”。

### dsh web 必须一直开着吗？

不需要。它主要用于首次配置模型和 API Key。配置完成后可以关闭，Open Design 在运行任务时会自行调用本机的 dsh。

### Open Design 仍然没有检测到 DeepSeek Harness 怎么办？

请依次确认：

1. 安装命令最后显示 DeepSeek Harness 已就绪。
2. 已重新启动 Open Design，或在“本地 Agent”页面点击“重新扫描”。
3. DeepSeek Harness 版本与 Open Design 当前支持版本一致。
4. 如仍无法识别，将安装器最后一屏输出和 Open Design 的测试提示一并反馈给支持人员。

## 适合社群直接转发的短版

DeepSeek Harness 已接入 Open Design。没有 Node.js、pnpm 或 dsh 也没关系：复制一行命令即可自动补齐兼容环境，安装完成后会打开 Harness 的 API Key 配置页面。配置完成，回到 Open Design 重新扫描并选择 DeepSeek Harness，就可以开始生成设计。

- macOS / Linux：`curl -fsSL 'https://open-design.ai/install-dsh.sh?version=1' | sh`
- Windows PowerShell：`& ([scriptblock]::Create((irm 'https://open-design.ai/install-dsh.ps1?version=1')))`
- Windows CMD：`curl -fsSL "https://open-design.ai/install-dsh.cmd?version=1" -o "%TEMP%\install-dsh.cmd" && call "%TEMP%\install-dsh.cmd"`

API Key 由 DeepSeek Harness 自己保存，Open Design 不保存你的 Key。

## 运营发布前检查

- 三个下载地址均返回对应脚本，而不是 HTML 页面或 404。
- R2 上的版本化对象、SHA-256 清单和 `open-design.ai` 稳定入口已经发布。
- 用全新 macOS 用户环境完成安装、配置、Open Design 重新扫描和一次真实生成。
- 用 Windows PowerShell 完成同样的全链路验证。
- 用 Windows CMD 至少验证下载、PowerShell 转发和安装完成。
- 确认宣发文案中的兼容 dsh 版本与 Open Design 当前 release 一致。
- 删除本文顶部“运营发布状态”提示后再面向用户发布。

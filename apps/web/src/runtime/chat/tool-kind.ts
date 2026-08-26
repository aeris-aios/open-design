/**
 * 工具行的语义:这一次调用到底在干什么。
 *
 * 为什么不能只看工具名(D7 / 规格 §2.1):
 * OD 的 skill 引导让 agent 把读、搜、查全塞进 `Bash` —— 真实录制里 claude 一轮
 * 84 次 `Bash` / 8 次 `Read`;codex 14 条命令全叫 `Bash` 且没有 description。
 * 照工具名分类,整列都会退化成「运行命令」。所以要嗅 `command` 的内容。
 *
 * 改 skill 让 agent 用专用工具的方案被否掉了(D7):skill 是产品行为,
 * 影响面远大于改 UI。代价是这里的规则要跟着 agent 的习惯演进 —— 所以它必须有测试。
 *
 * 参考实现是模拟器 `docs/design/chat-sim/sim.js`,那份已经用 9 条真命令验过 9/9。
 */

/** 界面上的动词:读取 / 新建 / 改写 / 搜索 / 执行 / 生成;认不出来的按工具名原样显示(T4) */
export type ToolKind = 'read' | 'write' | 'edit' | 'search' | 'exec' | 'image' | 'other';

const READ = /^(cat|head|tail|less|more|sed|awk|jq)$/;
const SEARCH = /^(grep|rg|egrep|find|fd|ls|tree|locate|which)$/;
const WRITE = /^(tee|touch|mkdir|mv|cp|rm|ln|chmod|patch)$/;
/** 这些命令本身不说明意图(`cd`、`echo`),整条命令只有它们时才回落成「执行」 */
const NOISE = /^(echo|printf|true|false|cd|export|set|pwd)$/;

const RANK: Record<string, number> = { write: 4, read: 3, search: 2, exec: 1, noise: 0 };

/**
 * codex 把每条命令包成 `/bin/zsh -lc '…'`(踩坑 #16:不剥壳,14 条命令全判成「运行」)。
 * 最多剥两层;结尾引号对不上(命令里混用引号)也照剥,宁可多剥不可不剥。
 */
export function unwrapShell(command: string): string {
  let c = String(command ?? '').trim();
  for (let i = 0; i < 2; i += 1) {
    const m = c.match(/^(?:\/bin\/|\/usr\/bin\/)?(?:sh|bash|zsh|dash)\s+(?:-[a-zA-Z]+\s+)*(['"])([\s\S]*)$/);
    if (!m) break;
    const quote = m[1] ?? '';
    let inner = m[2] ?? '';
    if (quote && inner.endsWith(quote)) inner = inner.slice(0, -1);
    c = inner.trim();
  }
  return c;
}

/** 取一段命令的「主命令」:先剥掉前置的 `FOO=bar` 环境变量,再取第一个词的 basename */
function headToken(segment: string): string {
  let seg = segment.trim();
  while (/^\w+=/.test(seg)) seg = seg.includes(' ') ? seg.slice(seg.indexOf(' ') + 1) : '';
  // sudo / env 只是前缀,真正干活的是后面那个(踩坑 W6)
  seg = seg.replace(/^(?:sudo|env|command|nohup|time)\s+(?:-\S+\s+)*/, '');
  const m = seg.match(/^["']?([^\s"']+)/);
  const token = m?.[1];
  if (!token) return '';
  if (token.startsWith('$')) return '$VAR';
  return token.split('/').pop() ?? '';
}

function classifyToken(token: string): string {
  if (token === '$VAR') return 'exec';
  if (NOISE.test(token)) return 'noise';
  if (READ.test(token)) return 'read';
  if (SEARCH.test(token)) return 'search';
  if (WRITE.test(token)) return 'write';
  return 'exec';
}

/**
 * 一条 shell 命令是在读、写、搜索还是单纯执行。
 *
 * 规则(与模拟器一致):
 *  · 出现重定向 `>` / `>>` → 一律算写(`cat > page.html <<'EOF'` 是 claude 写产物最常见的写法)
 *  · 顺序 / 逻辑连接(`;` `&&` `||`)切成几段,取权重最高的一段
 *  · 管道只看上游(`grep x foo | wc -l` 是搜索,不是执行 wc)
 *  · 整条只有噪音命令(`cd`、`echo`)→ 执行
 */
export function classifyCommand(command: string): ToolKind {
  const cmd = unwrapShell(command);
  // `2>&1` / `1>&2` 不是写文件,所以要求 > 前面不是数字、后面不是 &
  if (/(?:^|[^0-9<>&])>>?\s*[^\s&|;]+/.test(cmd)) return 'write';
  const segments = cmd.split(/\|\||&&|;/).filter((x) => x.trim());
  const kinds = segments.map((seg) => classifyToken(headToken(seg.split('|')[0] ?? '')));
  const real = kinds.filter((k) => k !== 'noise');
  const use = real.length ? real : ['noise'];
  const winner = use.reduce((a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a), use[0] ?? 'noise');
  return (winner === 'noise' ? 'exec' : winner) as ToolKind;
}

/**
 * 工具名本身能说明问题的,直接认;`Bash` 一类要去看命令内容。
 *
 * 名单要**保守**:能指到「这次调用到底干了什么」才归类。归错比归成 `other` 更糟 ——
 * `other` 只是说「我认不出来」,归错是**谎报**(把一次网络请求画成读文件)。
 * 认不出来的那一档现在也有图标了(见 `icons.tsx` 的兜底),不再退化成圆点。
 */
export function toolKind(toolName: string, input: unknown): ToolKind {
  const name = String(toolName ?? '').toLowerCase();
  if (WRITE_TOOLS.test(name)) return 'write';
  if (EDIT_TOOLS.test(name)) return 'edit';
  if (READ_TOOLS.test(name)) return 'read';
  if (SEARCH_TOOLS.test(name)) return 'search';
  if (isCommandTool(name)) return classifyCommand(commandOf(input));
  return 'other';
}

const WRITE_TOOLS = /^(write|write_file|create_file|new_file)$/;
const EDIT_TOOLS = /^(edit|multiedit|edit_file|apply_patch|str_replace|str_replace_editor|notebookedit|notebook_edit)$/;
/** 「把内容取回来」都算读:本地文件、远端网页,对用户是同一件事 */
const READ_TOOLS = /^(read|read_file|view_file|webfetch|web_fetch|fetch|read_url|readmediafile)$/;
/**
 * 「去找东西」都算搜:找文件、找代码、找网页。
 *
 * **元工具(`ToolSearch` 一类)不在这里** —— 它们该归哪一类是 T4,产品还没拍。
 * 现在它们走 `other`,行首拿兜底图标,不谎报成某一类。
 */
const SEARCH_TOOLS = /^(grep|glob|search|file_search|codebase_search|search_files|websearch|web_search)$/;

/**
 * 跑命令的工具。PowerShell 漏在名单外过一次 —— 一整轮十条 PowerShell 全被判成
 * 「未知」、行首只剩一颗点,是产品在真实页面上看出来的。名单按「它收 command 参数」认,
 * 不按平台认。
 */
export function isCommandTool(toolName: string): boolean {
  return /^(bash|sh|zsh|shell|powershell|pwsh|cmd|terminal|console|run_command|run_terminal_cmd|execute_command|local_shell|shell_command|terminal_command)$/
    .test(String(toolName ?? '').toLowerCase());
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

export function commandOf(input: unknown): string {
  const v = asRecord(input).command;
  return typeof v === 'string' ? v : '';
}

const basename = (p: string): string => String(p).replace(/^['"]|['"]$/g, '').split(/[\\/]/).pop() ?? '';

/** 工具入参里直指的文件(Read / Write / Edit 都有) */
export function fileOf(input: unknown): { path: string; label: string } | null {
  const rec = asRecord(input);
  const p = rec.file_path ?? rec.filePath ?? rec.path;
  return typeof p === 'string' && p ? { path: p, label: basename(p) } : null;
}

/**
 * 用命令读单个文件时,还原成「读取 + 文件名」,和 `Read` 同形。
 * 多文件、带管道的不猜 —— 猜错比不猜更糟。
 * `sed -n '1,220p' 文件` 是 codex 读文件的惯用写法,也认(踩坑 #16)。
 */
export function commandFile(command: string): { path: string; label: string } | null {
  const cmd = unwrapShell(command);
  let m = cmd.match(/^(cat|head|tail|less|more)\s+(?:-\S+\s+)*([^\s|;&<>]+)\s*$/);
  if (!m) m = cmd.match(/^(sed)\s+-n\s+['"]?[0-9,]+p['"]?\s+([^\s|;&<>]+)\s*$/);
  const raw = m?.[2];
  if (!raw) return null;
  const path = raw.replace(/^['"]|['"]$/g, '');
  return { path, label: basename(path) };
}

/**
 * 搜索行要显示「搜索 <模式> N 处」(D23),模式从入参或命令里抽。
 * 先按引号切词,再截到第一个裸的 `|` / `&&` / `;` —— 引号里的 `|` 是模式的一部分。
 */
export function searchPattern(toolName: string, input: unknown): string | null {
  const rec = asRecord(input);
  const direct = rec.pattern ?? rec.query;
  if (typeof direct === 'string' && direct) return direct;
  const all = unwrapShell(commandOf(input)).match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  const cut = all.findIndex((t) => /^(\||\|\||&&|;)$/.test(t));
  const toks = cut >= 0 ? all.slice(0, cut) : all;
  if (!toks.length) return null;
  const head = (toks[0] ?? '').split('/').pop() ?? '';
  const strip = (t: string): string => t.replace(/^['"]|['"]$/g, '');
  if (!/^(find|fd|grep|rg|egrep)$/.test(head)) return null;
  if (/^(find|fd)$/.test(head)) {
    // find 只有带 -name/-iname/-path/-regex 时才算「搜索了什么」;`find . -type f` 没有模式
    for (let i = 1; i < toks.length - 1; i += 1) {
      const flag = toks[i]; const value = toks[i + 1];
      if (flag && value && /^-(i?name|i?path|regex)$/.test(flag)) return strip(value);
    }
    const first = toks[1];
    return head === 'fd' && first && !first.startsWith('-') ? strip(first) : null;
  }
  for (let i = 1; i < toks.length; i += 1) {
    const tok = toks[i];
    if (!tok) continue;
    const next = toks[i + 1];
    if (/^(-e|--regexp)$/.test(tok) && next) return strip(next);
    if (tok.startsWith('-')) continue;
    return strip(tok);
  }
  return null;
}

/**
 * 行标题:有人话就用人话(claude 的 `description`),没有就回落成命令本身
 * —— codex 全程没有 description,这时候设计稿走「执行 <命令>」单行(S8)。
 */
export function toolTitle(toolName: string, input: unknown): string {
  const rec = asRecord(input);
  if (typeof rec.description === 'string' && rec.description) return rec.description;
  const cmd = commandOf(input);
  if (cmd) return commandHeadline(unwrapShell(cmd));
  const pattern = rec.pattern ?? rec.query;
  if (typeof pattern === 'string' && pattern) return pattern;
  return String(toolName ?? '');
}

/**
 * 一条命令显示成一行时留哪一截。
 *
 * 取第一行是对的 —— 但 **heredoc** 的第一行正好是最没信息的那一行:
 * `node - <<'NODE'` 里真正在跑的脚本全在后面几行,摆出来只剩「解释器 + 分隔符」
 * (用户真机指认「这个命令没什么可读性呢」)。
 * 所以把 heredoc 的开启标记连同它前面那个「从标准输入读」的 `-` 一起去掉:
 *   `node - <<'NODE'`           → `node`
 *   `cat > page.html <<'EOF'`   → `cat > page.html`(真正在做的事留住了)
 * 去完之后什么都不剩(比如整行就是 `<<'X'`)就退回原样,宁可难看也不空着。
 */
export function commandHeadline(command: string): string {
  const first = String(command ?? '').split('\n')[0] ?? '';
  const stripped = first
    // heredoc 开启标记:<<EOF / <<'EOF' / <<"EOF" / <<-EOF
    .replace(/\s*<<-?\s*(['"]?)[A-Za-z_][A-Za-z0-9_]*\1\s*$/, '')
    // 紧跟其后的那个「从标准输入读」的孤立 `-`
    .replace(/\s+-\s*$/, '')
    .trim();
  return stripped || first.trim();
}

/** 标题是原始命令(而不是人话)时,界面要用等宽字体显示 */
export function isRawCommandTitle(toolName: string, input: unknown): boolean {
  return isCommandTool(toolName) && !asRecord(input).description;
}

/**
 * **快照型**工具:每次调用都是把整份状态**替换**一遍,而不是记一笔流水。
 *
 * 各家 agent 在 daemon 归一后都叫 `TodoWrite`;这里仍放宽匹配,兼容 MCP 注入的
 * `mcp__*__todo_write` 和 codex 的 `update_plan`。
 *
 * 谁要用它:
 *  · `build-turn-blocks` 靠它把快照落成 todo 分段;
 *  · `dedupeToolUsesById` 靠它**放行同 id 的多次调用** —— 有的 agent 把「计划」
 *    建模成一个反复改写的条目,五次推进共用一个 tool id,按 id 去重会把
 *    除第一次以外的状态推进全部丢掉(真机撞到:一轮跑完四条 todo 还全是未开始)。
 */
const SNAPSHOT_TOOL_RE = /^(TodoWrite|todowrite|todo_write|update_plan)$|(^|__)todo_?write$/i;

export function isSnapshotTool(toolName: string): boolean {
  return SNAPSHOT_TOOL_RE.test(toolName);
}


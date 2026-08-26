import { describe, expect, it } from 'vitest';
import {
  classifyCommand,
  commandFile,
  fileOf,
  isRawCommandTitle,
  searchPattern,
  toolKind,
  toolTitle,
  unwrapShell,
} from '../../../src/runtime/chat/tool-kind';

const bash = (command: string, description?: string): unknown =>
  (description ? { command, description } : { command });

describe('classifyCommand · 九条真命令(规格 §2.2,实测 9/9)', () => {
  // 这九条取自真实录制,不是编的。规则改动后它们必须仍然成立。
  const cases: Array<[string, string]> = [
    ['ls -la', 'search'],
    ['cat index.html', 'read'],
    ['grep -n "gap" index.html settings.html', 'search'],
    ['find . -name "*.html"', 'search'],
    ['npm run build', 'exec'],
    ['mkdir -p dist', 'write'],
    ['cat > card.html <<\'EOF\'\n<div/>\nEOF', 'write'],
    ['sed -n \'1,220p\' src/app.tsx', 'read'],
    ['node scripts/check.mjs', 'exec'],
  ];
  it.each(cases)('%s → %s', (cmd, kind) => {
    expect(classifyCommand(cmd)).toBe(kind);
  });
});

describe('classifyCommand · 容易判错的几种写法', () => {
  it('管道只看上游:搜索结果数行,仍然是搜索不是执行 wc', () => {
    expect(classifyCommand('grep -rn "btn" src | wc -l')).toBe('search');
  });

  it('顺序执行取权重最高的一段:先读后写算写', () => {
    expect(classifyCommand('cat a.txt && tee b.txt')).toBe('write');
  });

  it('整条只有噪音命令时回落成执行,不算写', () => {
    expect(classifyCommand('cd /tmp && echo hi')).toBe('exec');
  });

  it('前置环境变量不影响判定', () => {
    expect(classifyCommand('NODE_ENV=test npm run build')).toBe('exec');
    expect(classifyCommand('FOO=1 grep -n x a.ts')).toBe('search');
  });

  it('sudo / env 只是前缀,看后面那个命令', () => {
    expect(classifyCommand('sudo rm -rf dist')).toBe('write');
    expect(classifyCommand('env cat a.txt')).toBe('read');
  });

  it('2>&1 不是写文件', () => {
    expect(classifyCommand('npm run build 2>&1')).toBe('exec');
  });

  it('追加重定向算写', () => {
    expect(classifyCommand('echo x >> notes.md')).toBe('write');
  });
});

describe('unwrapShell · codex 把每条命令都包一层(踩坑 #16)', () => {
  it('剥掉 /bin/zsh -lc 之后才判得对', () => {
    const wrapped = '/bin/zsh -lc \'grep -n "gap" index.html\'';
    expect(unwrapShell(wrapped)).toBe('grep -n "gap" index.html');
    expect(classifyCommand(wrapped)).toBe('search');
  });

  it('不剥壳会全部判成执行 —— 这就是回归的样子', () => {
    // 直接对剥完的内容分类是 search;若实现里去掉 unwrap,这条会变成 exec。
    expect(classifyCommand('/bin/bash -lc "cat index.html"')).toBe('read');
  });

  it('结尾引号对不上也照剥,不抛错', () => {
    expect(classifyCommand('/bin/zsh -lc \'echo "a\'')).toBe('exec');
  });
});

describe('toolKind · 工具名能说明问题的直接认', () => {
  it.each([
    ['Write', 'write'],
    ['Edit', 'edit'],
    ['MultiEdit', 'edit'],
    ['apply_patch', 'edit'],
    ['Read', 'read'],
    ['Grep', 'search'],
    ['Glob', 'search'],
  ])('%s → %s', (name, kind) => {
    expect(toolKind(name, {})).toBe(kind);
  });

  it('Bash 去看命令内容', () => {
    expect(toolKind('Bash', bash('cat a.html'))).toBe('read');
    expect(toolKind('Bash', bash('npm test'))).toBe('exec');
  });

  it('认不出来的元工具不硬归类,交给 other(T4 的默认)', () => {
    expect(toolKind('ToolSearch', { query: 'select:TodoWrite' })).toBe('other');
  });
});

describe('commandFile · 用命令读单个文件时还原成「读取 + 文件名」', () => {
  it('cat 单文件', () => {
    expect(commandFile('cat src/index.html')).toEqual({ path: 'src/index.html', label: 'index.html' });
  });

  it('codex 惯用的 sed -n 也认', () => {
    expect(commandFile("sed -n '1,220p' apps/web/src/app.tsx")?.label).toBe('app.tsx');
  });

  it('多文件或带管道的不猜', () => {
    expect(commandFile('cat a.html b.html')).toBeNull();
    expect(commandFile('cat a.html | head -20')).toBeNull();
  });
});

describe('searchPattern · 搜索行要显示搜的是什么', () => {
  it('入参里有 pattern 就用它', () => {
    expect(searchPattern('Grep', { pattern: 'gap' })).toBe('gap');
  });

  it('grep 取第一个非选项参数,选项值不算', () => {
    expect(searchPattern('Bash', bash('grep -n "gap" index.html'))).toBe('gap');
    expect(searchPattern('Bash', bash('grep -rn --include=*.ts btn src'))).toBe('btn');
  });

  it('-e 的值才是模式', () => {
    expect(searchPattern('Bash', bash('grep -e "a|b" file'))).toBe('a|b');
  });

  it('引号里的竖线属于模式,不当成管道截断', () => {
    expect(searchPattern('Bash', bash('grep "foo|bar" a.ts | wc -l'))).toBe('foo|bar');
  });

  it('find 只有带 -name 才算搜了什么', () => {
    expect(searchPattern('Bash', bash('find . -name "*.html"'))).toBe('*.html');
    expect(searchPattern('Bash', bash('find . -type f'))).toBeNull();
  });

  it('不是搜索命令就没有模式', () => {
    expect(searchPattern('Bash', bash('ls -la'))).toBeNull();
  });
});

describe('toolTitle · 有人话用人话,没有就回落成命令(S8)', () => {
  it('claude 给了 description', () => {
    expect(toolTitle('Bash', bash('grep -n gap a.ts', '对比两页间距'))).toBe('对比两页间距');
    expect(isRawCommandTitle('Bash', bash('grep -n gap a.ts', '对比两页间距'))).toBe(false);
  });

  it('codex 没有 description,标题就是命令本身,且要按等宽显示', () => {
    const input = bash('/bin/zsh -lc \'ls -la\'');
    expect(toolTitle('Bash', input)).toBe('ls -la');
    expect(isRawCommandTitle('Bash', input)).toBe(true);
  });

  /*
   * 多行命令取第一行 —— 但 heredoc 的开启标记要去掉:
   * 它是「后面还有几行」的语法记号,不是这条命令在做的事。
   * 详见 `commandHeadline`(用户 2026-08-26 真机指认 `node - <<'NODE'` 读不出内容)。
   */
  it('多行命令只取第一行,并去掉 heredoc 标记', () => {
    expect(toolTitle('Bash', bash('cat > a.html <<EOF\n<div/>\nEOF'))).toBe('cat > a.html');
  });
});

describe('fileOf · 各家入参字段名不统一', () => {
  it.each([
    [{ file_path: '/a/b/card.html' }],
    [{ filePath: '/a/b/card.html' }],
    [{ path: '/a/b/card.html' }],
  ])('%o → card.html', (input) => {
    expect(fileOf(input)).toEqual({ path: '/a/b/card.html', label: 'card.html' });
  });

  it('没有文件字段时返回 null,不编一个', () => {
    expect(fileOf({ command: 'ls' })).toBeNull();
  });
});

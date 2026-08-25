import fs from 'node:fs';

import { previewHtmlHasLoadTimeLocationNavigation } from '@open-design/contracts/runtime/preview-guards';

const MAX_TAG_BYTES = 256 * 1024;
const RAW_TEXT_TAGS = new Set(['noscript', 'script', 'style', 'title', 'textarea']);
const IMPLICIT_HEAD_TAGS = new Set([
  'base',
  'basefont',
  'bgsound',
  'link',
  'meta',
  'noframes',
  'script',
  'style',
  'template',
  'title',
]);

export interface HtmlHeadScanResult {
  /** Byte offset where daemon-owned head content can be inserted. */
  insertionOffset: number;
  /** Whether the artifact already owns base-URL resolution. */
  hasAuthoredBase: boolean;
  /** Whether a head script contains a load-time location navigation signal. */
  hasLoadTimeLocationNavigation: boolean;
}

function tagNameFromToken(token: string): { name: string; closing: boolean } | null {
  const match = token.match(/^<\s*(\/?)\s*([a-z][a-z0-9:-]*)/i);
  if (!match) return null;
  return { name: match[2]!.toLowerCase(), closing: match[1] === '/' };
}

function completeTagEnd(input: string): number {
  let quote = '';
  for (let index = 1; index < input.length; index += 1) {
    const char = input[index]!;
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return index;
  }
  return -1;
}

function rawTextCloseStart(input: string, tagName: string): number {
  const closeNeedle = `</${tagName}`;
  const lower = input.toLowerCase();
  let candidate = lower.indexOf(closeNeedle);
  while (candidate >= 0) {
    const delimiter = lower[candidate + closeNeedle.length];
    // HTML only recognizes a raw-text end tag name when the next character is
    // ASCII whitespace, '/', or '>'. Prefixes such as </scripture> remain
    // author text and must not return the scanner to normal tag parsing.
    if (delimiter !== undefined && /[\t\n\f\r />]/.test(delimiter)) return candidate;
    candidate = lower.indexOf(closeNeedle, candidate + closeNeedle.length);
  }
  return -1;
}

/**
 * Scan only HTML parser state needed to choose a safe head insertion point.
 * Source bytes are decoded as latin1 so string offsets remain byte offsets;
 * HTML tag syntax is ASCII and author text never needs to be retained.
 */
export async function scanHtmlHeadForStreamingInjection(
  filePath: string,
): Promise<HtmlHeadScanResult> {
  let buffer = '';
  let bufferOffset = 0;
  let insertionOffset = 0;
  let htmlOpenOffset: number | null = null;
  let explicitHead = false;
  let inComment = false;
  let rawTextTag: string | null = null;
  let scriptSignalTail = '';
  let hasAuthoredBase = false;
  let hasLoadTimeLocationNavigation = false;
  let prelude = true;
  let templateDepth = 0;
  let done = false;

  const consume = (length: number): void => {
    buffer = buffer.slice(length);
    bufferOffset += length;
  };

  const finish = (): HtmlHeadScanResult => ({
    insertionOffset: explicitHead
      ? insertionOffset
      : (htmlOpenOffset ?? insertionOffset),
    hasAuthoredBase,
    hasLoadTimeLocationNavigation,
  });

  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    buffer += (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).toString('latin1');

    while (buffer.length > 0 && !done) {
      if (bufferOffset === 0 && buffer.startsWith('\u00ef\u00bb\u00bf')) {
        consume(3);
        insertionOffset = 3;
        continue;
      }
      if (inComment) {
        const end = buffer.indexOf('-->');
        if (end < 0) {
          const retained = Math.min(2, buffer.length);
          consume(buffer.length - retained);
          break;
        }
        consume(end + 3);
        if (prelude) insertionOffset = bufferOffset;
        inComment = false;
        continue;
      }

      if (rawTextTag) {
        const closeNeedle = `</${rawTextTag}`;
        const close = rawTextCloseStart(buffer, rawTextTag);
        const contentEnd = close < 0
          // Keep the candidate plus one delimiter byte so a tag name ending at
          // a stream boundary cannot be accepted before its delimiter arrives.
          ? Math.max(0, buffer.length - closeNeedle.length - 1)
          : close;
        if (rawTextTag === 'script' && contentEnd > 0 && !hasLoadTimeLocationNavigation) {
          const sample = scriptSignalTail + buffer.slice(0, contentEnd);
          hasLoadTimeLocationNavigation = previewHtmlHasLoadTimeLocationNavigation(sample);
          scriptSignalTail = sample.slice(-256);
        }
        consume(contentEnd);
        if (close < 0) break;
        rawTextTag = null;
        scriptSignalTail = '';
        continue;
      }

      const open = buffer.indexOf('<');
      if (open < 0) {
        if (prelude && /^\s*$/.test(buffer)) insertionOffset = bufferOffset + buffer.length;
        consume(buffer.length);
        break;
      }
      if (open > 0) {
        const text = buffer.slice(0, open);
        if (prelude && /^\s*$/.test(text)) insertionOffset = bufferOffset + open;
        else if (/\S/.test(text)) {
          prelude = false;
          if (!explicitHead) done = true;
        }
        consume(open);
        if (done) break;
      }

      if (buffer.startsWith('<!--')) {
        consume(4);
        inComment = true;
        continue;
      }
      if (buffer.length < 4 && '<!--'.startsWith(buffer)) break;

      const tagEnd = completeTagEnd(buffer);
      if (tagEnd < 0) {
        if (buffer.length > MAX_TAG_BYTES) {
          // Malformed/unbounded tag: keep streaming and inject at the last
          // parser-safe boundary rather than retaining attacker-sized input.
          done = true;
        }
        break;
      }

      const token = buffer.slice(0, tagEnd + 1);
      const tokenStart = bufferOffset;
      consume(tagEnd + 1);
      const tag = tagNameFromToken(token);
      if (!tag) {
        if (/^<!doctype\b/i.test(token) || /^<\?/.test(token) || /^<!/.test(token)) {
          if (prelude) insertionOffset = bufferOffset;
          continue;
        }
        prelude = false;
        if (!explicitHead) done = true;
        continue;
      }

      if (tag.closing) {
        if (tag.name === 'template' && templateDepth > 0) templateDepth -= 1;
        if (tag.name === 'head' && templateDepth === 0) done = true;
        continue;
      }

      if (tag.name === 'html') {
        htmlOpenOffset = bufferOffset;
        insertionOffset = bufferOffset;
        prelude = false;
        continue;
      }
      if (tag.name === 'head') {
        explicitHead = true;
        insertionOffset = bufferOffset;
        prelude = false;
        continue;
      }
      if (tag.name === 'body' && templateDepth === 0) {
        done = true;
        continue;
      }
      if (tag.name === 'template') templateDepth += 1;
      if (tag.name === 'base' && templateDepth === 0) hasAuthoredBase = true;

      if (!explicitHead && templateDepth === 0 && !IMPLICIT_HEAD_TAGS.has(tag.name)) {
        // The browser would close its implicit head before this token. Insert
        // before it, after a doctype/html prelude if present.
        if (htmlOpenOffset === null) insertionOffset = tokenStart;
        done = true;
        continue;
      }

      prelude = false;
      if (RAW_TEXT_TAGS.has(tag.name) && !/\/\s*>$/.test(token)) {
        rawTextTag = tag.name;
      }
    }
    if (done) break;
  }

  return finish();
}

export interface InjectedFileRange {
  start: number;
  end: number;
}

/** Yield a virtual file made from source-prefix + injection + source-suffix. */
export async function* streamFileWithInjection(
  filePath: string,
  sourceSize: number,
  insertionOffset: number,
  injection: Buffer,
  range: InjectedFileRange,
): AsyncGenerator<Buffer> {
  const safeOffset = Math.max(0, Math.min(sourceSize, insertionOffset));
  const segments = [
    { virtualStart: 0, length: safeOffset, sourceStart: 0, content: null as Buffer | null },
    { virtualStart: safeOffset, length: injection.byteLength, sourceStart: 0, content: injection },
    {
      virtualStart: safeOffset + injection.byteLength,
      length: sourceSize - safeOffset,
      sourceStart: safeOffset,
      content: null as Buffer | null,
    },
  ];

  for (const segment of segments) {
    if (segment.length <= 0) continue;
    const segmentEnd = segment.virtualStart + segment.length - 1;
    const start = Math.max(range.start, segment.virtualStart);
    const end = Math.min(range.end, segmentEnd);
    if (start > end) continue;
    const relativeStart = start - segment.virtualStart;
    const relativeEnd = end - segment.virtualStart;
    if (segment.content) {
      yield segment.content.subarray(relativeStart, relativeEnd + 1);
      continue;
    }
    const sourceStart = segment.sourceStart + relativeStart;
    const sourceEnd = segment.sourceStart + relativeEnd;
    for await (const chunk of fs.createReadStream(filePath, { start: sourceStart, end: sourceEnd })) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  }
}

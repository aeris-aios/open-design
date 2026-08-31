import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { BrowserWindow } from "electron";
import type {
  DesktopRenderFramesInput,
  DesktopRenderFramesResult,
} from "@open-design/sidecar-proto";
import {
  findRealTagEnd,
  HTML_TAG_PATTERNS,
} from "@open-design/contracts/runtime/html-injection-points";

import { loadArtifactDocument } from "./deck-capture.js";
import { waitForPrintableContent } from "./pdf-export.js";

const DEFAULT_FRAME_RATE = 30;
const MAX_FRAME_COUNT = 1_000_000;

type FrameRendererMetadata = {
  duration?: unknown;
  fps?: unknown;
  hasAudio?: unknown;
};

/**
 * Capture a deterministic authored timeline with the Electron Chromium that is
 * already part of the desktop app. The page bridge owns timeline semantics;
 * this module only owns the hidden render surface and fresh CDP screenshots.
 */
export async function renderDeterministicFrames(
  input: DesktopRenderFramesInput,
): Promise<DesktopRenderFramesResult> {
  const window = new BrowserWindow({
    width: Math.round(input.width),
    height: Math.round(input.height),
    useContentSize: true,
    show: false,
    enableLargerThanScreen: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const framePattern = path.join(input.outputDir, "frame-%08d.png");
  const documentPath = path.join(input.outputDir, "composition.html");
  let debuggerAttached = false;

  try {
    await mkdir(input.outputDir, { recursive: true });
    await writeFile(documentPath, injectBaseHref(input.html, input.baseHref), "utf8");
    await loadArtifactDocument(window, pathToFileURL(documentPath).href);
    await waitForPrintableContent(window);

    window.setContentSize(Math.round(input.width), Math.round(input.height));
    window.setOpacity(0);
    window.showInactive();

    const metadata = (await window.webContents.executeJavaScript(
      `(() => {
        const bridge = globalThis.__odFrameRenderer;
        if (!bridge || typeof bridge.ready !== "function" || typeof bridge.seek !== "function") {
          throw new Error("document did not register window.__odFrameRenderer");
        }
        return Promise.resolve(bridge.ready()).then((metadata) => ({
          ...metadata,
          hasAudio: document.querySelector("audio") != null,
        }));
      })()`,
      true,
    )) as FrameRendererMetadata;
    if (metadata?.hasAudio === true) {
      return {
        ok: false,
        error: "the bundled Electron frame renderer does not yet support HyperFrames audio mixing",
        errorCode: "AUDIO_UNSUPPORTED",
      };
    }
    const duration = positiveFinite(metadata?.duration);
    const fps = input.fps ?? positiveFinite(metadata?.fps) ?? DEFAULT_FRAME_RATE;
    if (duration == null || fps <= 0 || fps > 240) {
      return {
        ok: false,
        error: `invalid frame metadata: duration=${String(metadata?.duration)}, fps=${String(input.fps ?? metadata?.fps)}`,
        errorCode: "INVALID_FRAME_METADATA",
      };
    }
    const frameCount = Math.max(1, Math.ceil(duration * fps));
    if (frameCount > MAX_FRAME_COUNT) {
      return {
        ok: false,
        error: `frame count ${frameCount} exceeds the ${MAX_FRAME_COUNT} frame safety limit`,
        errorCode: "INVALID_FRAME_METADATA",
      };
    }

    const dbg = window.webContents.debugger;
    dbg.attach("1.3");
    debuggerAttached = true;
    await dbg.sendCommand("Page.enable");
    await dbg.sendCommand("Emulation.setDeviceMetricsOverride", {
      width: Math.round(input.width),
      height: Math.round(input.height),
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const timeSeconds = frameIndex / fps;
      await window.webContents.executeJavaScript(
        `globalThis.__odFrameRenderer.seek(${JSON.stringify(timeSeconds)}, ${frameIndex})`,
        true,
      );
      await nextFrames(window);
      const shot = (await dbg.sendCommand("Page.captureScreenshot", {
        clip: {
          x: 0,
          y: 0,
          width: Math.round(input.width),
          height: Math.round(input.height),
          scale: 1,
        },
        format: "png",
        fromSurface: true,
      })) as { data: string };
      await writeFile(frameFilePath(input.outputDir, frameIndex), Buffer.from(shot.data, "base64"));
    }

    return {
      duration,
      fps,
      frameCount,
      framePattern,
      height: Math.round(input.height),
      ok: true,
      width: Math.round(input.width),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
      errorCode: message.includes("__odFrameRenderer")
        ? "FRAME_RENDERER_NOT_READY"
        : "RENDER_FAILED",
    };
  } finally {
    if (debuggerAttached) {
      try {
        window.webContents.debugger.detach();
      } catch {
        // The throwaway render window may already have gone away.
      }
    }
    if (!window.isDestroyed()) window.destroy();
  }
}

export function frameFilePath(outputDir: string, frameIndex: number): string {
  return path.join(outputDir, `frame-${String(frameIndex).padStart(8, "0")}.png`);
}

function positiveFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

async function nextFrames(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    true,
  );
}

function injectBaseHref(doc: string, baseHref: string | undefined): string {
  if (!baseHref) return doc;
  const tag = `<base href="${escapeHtmlAttribute(baseHref)}">`;
  const headEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.headOpen);
  if (headEnd >= 0) return doc.slice(0, headEnd) + tag + doc.slice(headEnd);
  const htmlEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.htmlOpen);
  if (htmlEnd >= 0) return `${doc.slice(0, htmlEnd)}<head>${tag}</head>${doc.slice(htmlEnd)}`;
  return `<!doctype html><html><head>${tag}</head><body>${doc}</body></html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

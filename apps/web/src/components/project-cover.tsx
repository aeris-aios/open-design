import { useEffect, useState } from 'react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { projectFileUrl } from '../providers/registry';
import type { ProjectFile } from '../types';
import {
  THUMBNAIL_OVERSCAN_MARGIN,
  useThumbnailLoadSlot,
} from '../lib/thumbnail-load-gate';
import { useInView } from './plugins-home/useInView';

export type ProjectCoverKind = 'html' | 'image' | 'video' | 'logo';

export interface ProjectCoverOverride {
  kind: ProjectCoverKind;
  name: string;
  mtime?: number;
}

export function coverFromProjectFile(
  file: ProjectFile,
  kind: ProjectCoverKind = file.kind as ProjectCoverKind,
): ProjectCoverOverride | null {
  if (kind !== 'html' && kind !== 'image' && kind !== 'video' && kind !== 'logo') return null;
  return { kind, name: file.path ?? file.name, mtime: file.mtime };
}

export function selectProjectFileCover(files: ProjectFile[]): ProjectCoverOverride | null {
  const html =
    files.find((file) => (file.path ?? file.name) === 'index.html') ??
    files
      .filter((file) => file.kind === 'html')
      .sort((a, b) => b.mtime - a.mtime)[0];
  if (html) return coverFromProjectFile(html, 'html');

  const image = files
    .filter((file) => file.kind === 'image')
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (image) return coverFromProjectFile(image, 'image');

  const video = files
    .filter((file) => file.kind === 'video')
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (video) return coverFromProjectFile(video, 'video');

  return null;
}

export function projectCoverUrl(
  projectId: string,
  name: string,
  version?: number,
  workspaceContext?: WorkspaceCollabContext | null,
): string {
  const url = projectFileUrl(projectId, name, workspaceContext);
  if (!Number.isFinite(version) || version === undefined || version <= 0) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(String(Math.trunc(version)))}`;
}

export function HtmlProjectCoverFrame({
  src,
  initial,
  iframeClassName,
  glyphClassName,
  diagnostic,
  ungated = false,
}: {
  src: string | undefined;
  initial: string;
  iframeClassName: string;
  glyphClassName: string;
  diagnostic: string;
  /**
   * 跳过全局缩略图加载闸。**只给「前台主内容」用**。
   *
   * 那道闸是为首页项目网格建的:几十张卡各开一个 iframe 打本地 daemon,会把
   * HTTP/1.1 的连接池占满。所以 `App.tsx` 里写着
   * `if (route.kind === 'project') suspendThumbnailLoads()` —— 一进项目就挂起,
   * 背景封面别跟前台抢。
   *
   * 可聊天就活在项目路由里:回答里的产物卡**自己就是用户要看的东西**,一轮也就一两张。
   * 让它继承那条挂起,结果是永远拿不到 slot、卡面永远一块灰。
   *
   * 传这个的地方要满足两条:① 数量有界(不是网格);② 它就是当前路由的前台内容。
   */
  ungated?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [verified, setVerified] = useState(false);
  // Cover work is deferred until the card is near the viewport, and the
  // iframe document load itself is budgeted by the shared thumbnail gate so a
  // large grid cannot saturate the daemon connection pool (Batch A §4.2).
  const { ref: inViewRef, inView } = useInView<HTMLSpanElement>({
    rootMargin: THUMBNAIL_OVERSCAN_MARGIN,
  });

  useEffect(() => {
    if (!src || !inView) {
      setFailed(false);
      setVerified(false);
      return;
    }

    const controller = new AbortController();
    let disposed = false;

    setFailed(false);
    setVerified(false);

    fetch(src, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (disposed) return;
        if (response.ok || response.status === 304) {
          setVerified(true);
          return;
        }
        console.warn(
          `[project-cover] HTML cover unavailable (${response.status} ${response.statusText}):`,
          diagnostic,
        );
        setFailed(true);
      })
      .catch((err) => {
        if (disposed || (err instanceof DOMException && err.name === 'AbortError')) return;
        console.warn('[project-cover] failed to verify HTML cover:', diagnostic, err);
        setFailed(true);
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [src, diagnostic, inView]);

  const { canLoad, settle } = useThumbnailLoadSlot(
    !ungated && Boolean(src) && inView && verified && !failed,
  );

  if (!src || failed || !verified || (!ungated && !canLoad)) {
    return (
      <span ref={inViewRef} className={glyphClassName}>
        {initial}
      </span>
    );
  }

  return (
    <iframe
      className={iframeClassName}
      src={src}
      title=""
      loading="lazy"
      sandbox="allow-scripts"
      tabIndex={-1}
      onLoad={settle}
      onError={() => {
        settle();
        console.warn('[project-cover] failed to load HTML cover:', diagnostic);
        setFailed(true);
      }}
    />
  );
}

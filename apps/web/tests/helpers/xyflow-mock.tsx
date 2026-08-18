import { useRef, type PointerEvent, type ReactNode, type WheelEvent } from 'react';

export const BackgroundVariant = {
  Dots: 'dots',
  Lines: 'lines',
  Cross: 'cross',
} as const;

export const PanOnScrollMode = {
  Free: 'free',
} as const;

export function ReactFlow({
  children,
  defaultViewport = { x: 0, y: 0, zoom: 1 },
  viewport,
  onViewportChange,
  onMoveEnd,
  panOnDrag,
  panOnScroll,
  zoomOnPinch,
  zoomActivationKeyCode,
  minZoom = 0.5,
  maxZoom = 2,
}: {
  children?: ReactNode;
  defaultViewport?: { x: number; y: number; zoom: number };
  viewport?: { x: number; y: number; zoom: number };
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void;
  onMoveEnd?: (event: null, viewport: { x: number; y: number; zoom: number }) => void;
  panOnDrag?: boolean | number[];
  panOnScroll?: boolean;
  zoomOnPinch?: boolean;
  zoomActivationKeyCode?: string | null;
  minZoom?: number;
  maxZoom?: number;
}) {
  const viewportRef = useRef(viewport ?? defaultViewport);
  viewportRef.current = viewport ?? viewportRef.current;
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    viewportX: number;
    viewportY: number;
  } | null>(null);

  return (
    <div
      className="react-flow"
      data-pan-on-drag={panOnDrag ? 'true' : undefined}
      data-pan-on-scroll={panOnScroll ? 'true' : undefined}
      data-zoom-on-pinch={zoomOnPinch ? 'true' : undefined}
      data-zoom-activation-key={zoomActivationKeyCode ?? undefined}
      data-viewport-x={viewportRef.current.x}
      data-viewport-y={viewportRef.current.y}
      data-viewport-zoom={viewportRef.current.zoom}
      data-min-zoom={minZoom}
      data-max-zoom={maxZoom}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (!panOnDrag) return;
        dragStartRef.current = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          viewportX: viewportRef.current.x,
          viewportY: viewportRef.current.y,
        };
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        const dragStart = dragStartRef.current;
        if (!panOnDrag || !dragStart) return;
        const nextViewport = {
          x: dragStart.viewportX + event.clientX - dragStart.pointerX,
          y: dragStart.viewportY + event.clientY - dragStart.pointerY,
          zoom: viewportRef.current.zoom,
        };
        viewportRef.current = nextViewport;
        onViewportChange?.(nextViewport);
      }}
      onPointerUp={() => {
        dragStartRef.current = null;
        onMoveEnd?.(null, viewportRef.current);
      }}
      onPointerCancel={() => {
        dragStartRef.current = null;
        onMoveEnd?.(null, viewportRef.current);
      }}
      onWheel={(event: WheelEvent<HTMLDivElement>) => {
        // Trackpad pinch reaches the browser as ctrl+wheel. Holding the
        // configured activation key turns a physical wheel into zoom too.
        const modifierZoom = zoomActivationKeyCode === 'Meta' && event.metaKey;
        if (zoomOnPinch && (event.ctrlKey || modifierZoom) && event.deltaY !== 0) {
          const currentViewport = viewportRef.current;
          // Keep the mock aligned with XYFlow's production wheelDelta: macOS
          // exposes trackpad pinch as ctrl+wheel and receives a 10× boost.
          const macPinchMultiplier = event.ctrlKey && !event.metaKey
            && navigator.userAgent.includes('Mac') ? 10 : 1;
          const deltaModeMultiplier = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
          const factor = 2 ** (-event.deltaY * deltaModeMultiplier * macPinchMultiplier);
          const zoom = Math.min(maxZoom, Math.max(minZoom, currentViewport.zoom * factor));
          const ratio = zoom / currentViewport.zoom;
          const nextViewport = {
            x: event.clientX - ((event.clientX - currentViewport.x) * ratio),
            y: event.clientY - ((event.clientY - currentViewport.y) * ratio),
            zoom,
          };
          viewportRef.current = nextViewport;
          onViewportChange?.(nextViewport);
          onMoveEnd?.(null, nextViewport);
          return;
        }
        if (
          !panOnScroll
          || event.ctrlKey
          || modifierZoom
          || (event.deltaX === 0 && event.deltaY === 0)
        ) return;
        const currentViewport = viewportRef.current;
        const nextViewport = {
          x: currentViewport.x - event.deltaX,
          y: currentViewport.y - event.deltaY,
          zoom: currentViewport.zoom,
        };
        viewportRef.current = nextViewport;
        onViewportChange?.(nextViewport);
        onMoveEnd?.(null, nextViewport);
      }}
    >
      {children}
    </div>
  );
}

export function Background() {
  return <svg className="react-flow__background" aria-hidden="true" />;
}

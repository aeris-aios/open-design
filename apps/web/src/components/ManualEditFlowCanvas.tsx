import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  Background,
  BackgroundVariant,
  PanOnScrollMode,
  ReactFlow,
  type Edge,
  type Node,
  type Viewport,
} from '@xyflow/react';

const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];

export type ManualEditFlowViewport = Viewport;
export const MANUAL_EDIT_FLOW_MIN_ZOOM = 0.1;
export const MANUAL_EDIT_FLOW_MAX_ZOOM = 2;
const MANUAL_EDIT_FLOW_WHEEL_ZOOM_SPEED = 0.002;
const MANUAL_EDIT_FLOW_MAC_PINCH_MULTIPLIER = 10;

export type ManualEditFlowInputBridge = {
  wheel: (input: {
    clientX: number;
    clientY: number;
    ctrlKey: boolean;
    metaKey: boolean;
    deltaX: number;
    deltaY: number;
  }) => void;
};

type ManualEditFlowCanvasProps = {
  initialViewport: ManualEditFlowViewport;
  zoom: number;
  artboardWidth: number;
  initialInsetX?: number;
  initialInsetY?: number;
  onViewportChange: (viewport: ManualEditFlowViewport) => void;
  onViewportChangeEnd: (viewport: ManualEditFlowViewport) => void;
  interactive: boolean;
  inputBridgeRef?: MutableRefObject<ManualEditFlowInputBridge | null>;
};

function clampZoom(zoom: number) {
  return Math.min(MANUAL_EDIT_FLOW_MAX_ZOOM, Math.max(MANUAL_EDIT_FLOW_MIN_ZOOM, zoom));
}

function manualEditFlowPinchMultiplier() {
  // Match XYFlow's native macOS trackpad gain for pixel-mode pinch samples.
  // Chromium reports a pinch as ctrl+wheel, and XYFlow boosts that signal by
  // 10×. The iframe bridge needs the same boost or pinching over the page feels
  // much slower than pinching over the surrounding canvas.
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
    ? MANUAL_EDIT_FLOW_MAC_PINCH_MULTIPLIER
    : 1;
}

/**
 * XYFlow is the editing surface, not another authoring tool. The artifact,
 * inspector, zoom menu, and iframe editing bridge stay owned by FileViewer;
 * this component contributes only the canvas underneath them.
 */
export function ManualEditFlowCanvas({
  initialViewport,
  zoom,
  artboardWidth,
  initialInsetX = 0,
  initialInsetY = 0,
  onViewportChange,
  onViewportChangeEnd,
  interactive,
  inputBridgeRef,
}: ManualEditFlowCanvasProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initialControlledViewportRef = useRef<ManualEditFlowViewport>({
    ...initialViewport,
    zoom: clampZoom(zoom),
  });
  const viewportRef = useRef(initialControlledViewportRef.current);
  const pendingViewportRef = useRef(initialControlledViewportRef.current);
  const viewportFrameRef = useRef<number | null>(null);
  const bridgedWheelEndTimerRef = useRef<number | null>(null);
  const bridgedWheelRootRectRef = useRef<DOMRect | null>(null);
  const [viewport, setViewport] = useState(initialControlledViewportRef.current);
  const positionSeededRef = useRef(
    Math.abs(initialViewport.x) > 0.0001 || Math.abs(initialViewport.y) > 0.0001,
  );
  const previousArtboardWidthRef = useRef(artboardWidth);

  const commitViewport = useCallback((nextViewport: ManualEditFlowViewport) => {
    const normalizedViewport = {
      ...nextViewport,
      zoom: clampZoom(nextViewport.zoom),
    };
    viewportRef.current = normalizedViewport;
    pendingViewportRef.current = normalizedViewport;
    // Trackpads can emit more samples than the display can paint. Keep both the
    // controlled XYFlow update and the visible artboard transform to one update
    // per animation frame, so the iframe and canvas background stay in lockstep.
    if (viewportFrameRef.current === null) {
      if (typeof window.requestAnimationFrame === 'function') {
        viewportFrameRef.current = window.requestAnimationFrame(() => {
          viewportFrameRef.current = null;
          const pendingViewport = pendingViewportRef.current;
          setViewport(pendingViewport);
          onViewportChange(pendingViewport);
        });
      } else {
        setViewport(normalizedViewport);
        onViewportChange(normalizedViewport);
      }
    }
  }, [onViewportChange]);

  const commitBridgedViewport = useCallback((nextViewport: ManualEditFlowViewport) => {
    const normalizedViewport = {
      ...nextViewport,
      zoom: clampZoom(nextViewport.zoom),
    };
    viewportRef.current = normalizedViewport;
    pendingViewportRef.current = normalizedViewport;
    // FileViewer has already coalesced iframe samples onto requestAnimationFrame,
    // so scheduling another frame here would add latency without saving work.
    if (viewportFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportFrameRef.current);
      viewportFrameRef.current = null;
    }
    setViewport(normalizedViewport);
    onViewportChange(normalizedViewport);
  }, [onViewportChange]);

  const commitViewportEnd = useCallback((nextViewport: ManualEditFlowViewport) => {
    const normalizedViewport = {
      ...nextViewport,
      zoom: clampZoom(nextViewport.zoom),
    };
    viewportRef.current = normalizedViewport;
    pendingViewportRef.current = normalizedViewport;
    if (viewportFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportFrameRef.current);
      viewportFrameRef.current = null;
    }
    setViewport(normalizedViewport);
    onViewportChange(normalizedViewport);
    onViewportChangeEnd(normalizedViewport);
  }, [onViewportChange, onViewportChangeEnd]);

  useEffect(() => {
    if (!inputBridgeRef) return;
    inputBridgeRef.current = {
      wheel: ({ clientX, clientY, ctrlKey, metaKey, deltaX, deltaY }) => {
        const currentViewport = viewportRef.current;
        let nextViewport: ManualEditFlowViewport;
        if ((ctrlKey || metaKey) && deltaY !== 0) {
          // The flow root does not move during a gesture. Reading its geometry
          // once avoids forcing layout for every high-frequency iframe sample.
          const rootRect = bridgedWheelRootRectRef.current
            ?? rootRef.current?.getBoundingClientRect()
            ?? null;
          bridgedWheelRootRectRef.current = rootRect;
          const localX = clientX - (rootRect?.left ?? 0);
          const localY = clientY - (rootRect?.top ?? 0);
          const zoom = clampZoom(currentViewport.zoom * (2 ** (
            -deltaY
            * MANUAL_EDIT_FLOW_WHEEL_ZOOM_SPEED
            * (ctrlKey && !metaKey ? manualEditFlowPinchMultiplier() : 1)
          )));
          const ratio = zoom / currentViewport.zoom;
          nextViewport = {
            x: localX - ((localX - currentViewport.x) * ratio),
            y: localY - ((localY - currentViewport.y) * ratio),
            zoom,
          };
        } else {
          if (deltaX === 0 && deltaY === 0) return;
          nextViewport = {
            x: currentViewport.x - deltaX,
            y: currentViewport.y - deltaY,
            zoom: currentViewport.zoom,
          };
        }
        commitBridgedViewport(nextViewport);
        if (bridgedWheelEndTimerRef.current !== null) {
          window.clearTimeout(bridgedWheelEndTimerRef.current);
        }
        bridgedWheelEndTimerRef.current = window.setTimeout(() => {
          bridgedWheelEndTimerRef.current = null;
          bridgedWheelRootRectRef.current = null;
          commitViewportEnd(viewportRef.current);
        }, 120);
      },
    };
    return () => {
      inputBridgeRef.current = null;
    };
  }, [commitBridgedViewport, commitViewportEnd, inputBridgeRef]);

  useEffect(() => () => {
    if (viewportFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportFrameRef.current);
    }
    if (bridgedWheelEndTimerRef.current !== null) {
      window.clearTimeout(bridgedWheelEndTimerRef.current);
    }
    bridgedWheelRootRectRef.current = null;
  }, []);

  /* CSS centring would add a second coordinate system on top of XYFlow and
     make pinch-to-zoom drift. Seed the first XYFlow viewport instead: narrow
     artboards begin centred, while oversized desktop pages stay left-aligned.
     A retained non-zero viewport is already seeded, so reopening Edit keeps
     the user's pan position. A device-preset width change still recentres. */
  useLayoutEffect(() => {
    const artboardWidthChanged = previousArtboardWidthRef.current !== artboardWidth;
    previousArtboardWidthRef.current = artboardWidth;
    if (positionSeededRef.current && !artboardWidthChanged) return;

    const currentViewport = viewportRef.current;
    const rect = rootRef.current?.getBoundingClientRect();
    const hostWidth = rect?.width ?? rootRef.current?.clientWidth ?? 0;
    positionSeededRef.current = true;
    commitViewport({
      x: Math.max(initialInsetX, (hostWidth - (artboardWidth * currentViewport.zoom)) / 2),
      y: initialInsetY,
      zoom: currentViewport.zoom,
    });
  }, [artboardWidth, commitViewport, initialInsetX, initialInsetY]);

  /* The dock menu and the pinch gesture share one viewport. When the menu
     supplies a new zoom, keep the canvas centre anchored just as XYFlow does
     for a two-finger gesture instead of snapping the artboard to its origin. */
  useEffect(() => {
    const currentViewport = viewportRef.current;
    const nextZoom = clampZoom(zoom);
    if (Math.abs(currentViewport.zoom - nextZoom) < 0.0001) return;

    const rect = rootRef.current?.getBoundingClientRect();
    const centreX = (rect?.width ?? rootRef.current?.clientWidth ?? 0) / 2;
    const centreY = (rect?.height ?? rootRef.current?.clientHeight ?? 0) / 2;
    const ratio = nextZoom / currentViewport.zoom;
    commitViewport({
      x: centreX - ((centreX - currentViewport.x) * ratio),
      y: centreY - ((centreY - currentViewport.y) * ratio),
      zoom: nextZoom,
    });
  }, [commitViewport, zoom]);

  return (
    <div
      ref={rootRef}
      className={`manual-edit-flow-canvas${interactive ? ' manual-edit-flow-canvas-interactive' : ''}`}
      data-testid="manual-edit-flow-canvas"
    >
      <ReactFlow
        nodes={EMPTY_NODES}
        edges={EMPTY_EDGES}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        // The Flow pane is exposed only where the pointer is outside the
        // artboard iframe. Keep drag-to-pan enabled there even in Select: the
        // iframe still owns element click/drag, while blank canvas naturally
        // becomes a hand surface. Explicit Hand disables iframe pointer events
        // in FileViewer, extending this same pan gesture across the artboard.
        panOnDrag
        // Canvas navigation stays available in both pointer tools: pinch and
        // Command-wheel zoom; an ordinary two-finger swipe pans freely in X/Y.
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        zoomActivationKeyCode="Meta"
        zoomOnDoubleClick={false}
        preventScrolling
        disableKeyboardA11y
        minZoom={MANUAL_EDIT_FLOW_MIN_ZOOM}
        maxZoom={MANUAL_EDIT_FLOW_MAX_ZOOM}
        viewport={viewport}
        onViewportChange={commitViewport}
        onMoveEnd={(_event, nextViewport) => commitViewportEnd(nextViewport)}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.25}
          color="var(--border-strong)"
          bgColor="var(--bg)"
        />
      </ReactFlow>
    </div>
  );
}

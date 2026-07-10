import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { MousePointer2, Pause, Play, RotateCcw } from 'lucide-react'
import {
  embeddedArtifactOf,
  isSvgFrame,
  type CanvasShape
} from '../../../design/canvas/canvas-types'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import { useSvgArtifactPreview } from '../../../design/svg/use-svg-artifact-preview'

type SvgRootWithTimeline = SVGSVGElement & {
  pauseAnimations?: () => void
  unpauseAnimations?: () => void
  setCurrentTime?: (seconds: number) => void
  getCurrentTime?: () => number
}

function animationDocument(iframe: HTMLIFrameElement | null): Document | null {
  try {
    return iframe?.contentDocument ?? null
  } catch {
    return null
  }
}

function controlTimeline(iframe: HTMLIFrameElement | null, timeMs: number, rate: number): void {
  const document = animationDocument(iframe)
  const root = document?.querySelector('svg') as SvgRootWithTimeline | null
  root?.pauseAnimations?.()
  root?.setCurrentTime?.(Math.max(0, timeMs) / 1000)
  const animations = document?.getAnimations?.() ?? []
  for (const animation of animations) {
    animation.playbackRate = rate
    animation.currentTime = Math.max(0, timeMs)
    animation.pause()
  }
}

function nextBackground(value: 'transparent' | 'light' | 'dark'): 'transparent' | 'light' | 'dark' {
  return value === 'transparent' ? 'light' : value === 'light' ? 'dark' : 'transparent'
}

function frameIntersectsViewport(shape: CanvasShape, viewBox: { x: number; y: number; width: number; height: number }): boolean {
  return shape.x + shape.width >= viewBox.x &&
    shape.y + shape.height >= viewBox.y &&
    shape.x <= viewBox.x + viewBox.width &&
    shape.y <= viewBox.y + viewBox.height
}

function SvgArtifactFrame({
  shape,
  workspaceRoot,
  zoom,
  viewX,
  viewY,
  selected
}: {
  shape: CanvasShape
  workspaceRoot: string
  zoom: number
  viewX: number
  viewY: number
  selected: boolean
}): ReactElement | null {
  const reference = embeddedArtifactOf(shape)
  const artifact = useDesignWorkspaceStore((state) =>
    reference ? state.artifacts.find((item) => item.id === reference.id && item.kind === 'svg') : undefined
  )
  const [background, setBackground] = useState<'transparent' | 'light' | 'dark'>('transparent')
  const [playing, setPlaying] = useState(true)
  const [interactive, setInteractive] = useState(false)
  const [rate, setRate] = useState(1)
  const [currentMs, setCurrentMs] = useState(0)
  const currentMsRef = useRef(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const tickRef = useRef<number | null>(null)
  const lastTickRef = useRef<number | null>(null)
  const preview = useSvgArtifactPreview(workspaceRoot, artifact?.relativePath ?? '', background)
  const durationMs = Math.max(1000, preview.durationMs)

  const seek = useCallback((timeMs: number): void => {
    const bounded = Math.max(0, Math.min(durationMs, timeMs))
    currentMsRef.current = bounded
    setCurrentMs(bounded)
    controlTimeline(iframeRef.current, bounded, rate)
  }, [durationMs, rate])

  useEffect(() => {
    if (!playing || preview.status !== 'ready') {
      if (tickRef.current !== null) cancelAnimationFrame(tickRef.current)
      tickRef.current = null
      lastTickRef.current = null
      controlTimeline(iframeRef.current, currentMsRef.current, rate)
      return
    }
    const tick = (now: number): void => {
      const previous = lastTickRef.current ?? now
      lastTickRef.current = now
      setCurrentMs((current) => {
        const next = current + (now - previous) * rate
        const resolved = next >= durationMs ? next % durationMs : next
        currentMsRef.current = resolved
        controlTimeline(iframeRef.current, resolved, rate)
        return resolved
      })
      tickRef.current = requestAnimationFrame(tick)
    }
    tickRef.current = requestAnimationFrame(tick)
    return () => {
      if (tickRef.current !== null) cancelAnimationFrame(tickRef.current)
      tickRef.current = null
      lastTickRef.current = null
    }
  }, [durationMs, playing, preview.status, rate])

  useEffect(() => {
    setCurrentMs(0)
    currentMsRef.current = 0
  }, [preview.revision])

  useEffect(() => {
    if (!artifact) return
    if (preview.status === 'ready' && preview.visualElementCount > 0) {
      useDesignWorkspaceStore.getState().setArtifactPreviewStatus(artifact.id, 'ready')
    } else if (preview.status === 'invalid') {
      useDesignWorkspaceStore.getState().setArtifactPreviewStatus(artifact.id, 'error')
    } else if (preview.status === 'missing' && artifact.previewStatus !== 'pending') {
      useDesignWorkspaceStore.getState().setArtifactPreviewStatus(artifact.id, 'error')
    }
  }, [artifact, preview.status, preview.visualElementCount])

  if (!artifact || !reference) return null
  const left = (shape.x - viewX) * zoom
  const top = (shape.y - viewY) * zoom
  const width = shape.width * zoom
  const height = shape.height * zoom
  if (width < 8 || height < 8) return null
  const diagnostics = preview.diagnostics.length
  const label = preview.status === 'invalid'
    ? preview.diagnostics[0]?.message ?? 'Invalid SVG'
    : preview.status === 'missing'
      ? 'SVG file is missing'
      : 'Loading SVG…'

  return (
    <div
      className="pointer-events-none absolute z-20 overflow-hidden rounded-[5px] border bg-white shadow-sm"
      style={{
        left,
        top,
        width,
        height,
        transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
        transformOrigin: 'center',
        borderColor: selected ? '#6557ff' : 'rgba(15,23,42,0.16)',
        boxShadow: selected ? '0 0 0 1px rgba(101,87,255,.45)' : undefined
      }}
      data-svg-artifact-id={artifact.id}
    >
      {preview.status === 'ready' ? (
        <iframe
          key={`${artifact.relativePath}:${preview.revision}`}
          ref={iframeRef}
          sandbox="allow-same-origin"
          srcDoc={preview.srcDoc}
          title={artifact.title}
          className="absolute inset-0 h-full w-full border-0"
          style={{ pointerEvents: interactive ? 'auto' : 'none' }}
          onLoad={() => controlTimeline(iframeRef.current, currentMsRef.current, rate)}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-slate-50 px-6 text-center text-xs text-slate-500">
          {label}
        </div>
      )}
      <div className="pointer-events-auto absolute inset-x-2 bottom-2 flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white/90 px-2 text-slate-600 shadow backdrop-blur">
        <button
          type="button"
          className="grid h-6 w-6 place-items-center rounded hover:bg-slate-100"
          title={playing ? 'Pause SVG animation' : 'Play SVG animation'}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          className="grid h-6 w-6 place-items-center rounded hover:bg-slate-100"
          title="Restart SVG animation"
          onClick={() => {
            seek(0)
            setPlaying(true)
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <input
          type="range"
          min={0}
          max={durationMs}
          step={10}
          value={Math.min(currentMs, durationMs)}
          className="h-1 min-w-10 flex-1 accent-[#6557ff]"
          aria-label="SVG animation timeline"
          onChange={(event) => {
            setPlaying(false)
            seek(Number(event.target.value))
          }}
        />
        <button
          type="button"
          className="h-6 min-w-9 rounded px-1 text-[10px] font-semibold hover:bg-slate-100"
          title="Change playback speed"
          onClick={() => setRate((value) => value === 0.5 ? 1 : value === 1 ? 2 : 0.5)}
        >
          {rate}x
        </button>
        <button
          type="button"
          className="h-5 w-5 rounded border border-black/10"
          style={{
            background: background === 'dark'
              ? '#111827'
              : background === 'light'
                ? '#fff'
                : 'linear-gradient(135deg,#e5e7eb 25%,#fff 25% 50%,#e5e7eb 50% 75%,#fff 75%)',
            backgroundSize: background === 'transparent' ? '8px 8px' : undefined
          }}
          title="Change SVG preview background"
          onClick={() => setBackground((value) => nextBackground(value))}
        />
        <button
          type="button"
          className={`grid h-6 w-6 place-items-center rounded ${interactive ? 'bg-violet-100 text-violet-700' : 'hover:bg-slate-100'}`}
          title="Toggle SVG pointer interaction"
          onClick={() => setInteractive((value) => !value)}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
        </button>
        {diagnostics > 0 ? (
          <span className="max-w-16 truncate text-[9px] font-semibold text-amber-600" title={preview.diagnostics.map((item) => item.message).join('\n')}>
            {diagnostics} warning{diagnostics === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function SvgFrameOverlay({ workspaceRoot }: { workspaceRoot: string }): ReactElement | null {
  const document = useCanvasShapeStore((state) => state.document)
  const vbox = useCanvasViewportStore((state) => state.vbox)
  const containerWidth = useCanvasViewportStore((state) => state.containerWidth)
  const selectedIds = useCanvasSelectionStore((state) => state.selectedIds)
  const zoom = containerWidth > 0 && vbox.width > 0 ? containerWidth / vbox.width : 0
  const frames = useMemo(
    () => Object.values(document.objects)
      .filter((shape) =>
        isSvgFrame(shape) &&
        shape.visible &&
        shape.width * zoom >= 8 &&
        shape.height * zoom >= 8 &&
        frameIntersectsViewport(shape, vbox)
      )
      .sort((a, b) => Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id)))
      .slice(0, 24)
      .sort((a, b) => Number(selectedIds.has(a.id)) - Number(selectedIds.has(b.id))),
    [document, selectedIds, vbox, zoom]
  )
  if (containerWidth <= 0 || vbox.width <= 0 || frames.length === 0) return null
  return (
    <>
      {frames.map((shape) => (
        <SvgArtifactFrame
          key={shape.id}
          shape={shape}
          workspaceRoot={workspaceRoot}
          zoom={zoom}
          viewX={vbox.x}
          viewY={vbox.y}
          selected={selectedIds.has(shape.id)}
        />
      ))}
    </>
  )
}

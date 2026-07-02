import { describe, expect, it } from 'vitest'
import {
  resolveCanvasDesignSystemBaseDir,
  shouldRenderCanvasMinimap,
  shouldHandleCanvasKeyboardEvent,
  shouldRenderDesignArtifactOverlays,
  shouldOpenImageAnnotation,
  shouldSyncCanvasHtmlFrames
} from './CanvasViewport'
import { createDefaultShape } from '../../../design/canvas/canvas-types'

describe('CanvasViewport surface behavior', () => {
  it('keeps design artifact overlays out of the code canvas', () => {
    expect(shouldRenderDesignArtifactOverlays('code')).toBe(false)
    expect(shouldRenderDesignArtifactOverlays('design')).toBe(true)
  })

  it('keeps the minimap out of the code sidebar canvas', () => {
    expect(shouldRenderCanvasMinimap('code')).toBe(false)
    expect(shouldRenderCanvasMinimap('design')).toBe(true)
  })

  it('keeps HTML frame artifact sync scoped to the design canvas', () => {
    expect(shouldSyncCanvasHtmlFrames('design', true)).toBe(true)
    expect(shouldSyncCanvasHtmlFrames('design', false)).toBe(false)
    expect(shouldSyncCanvasHtmlFrames('code', true)).toBe(false)
  })

  it('allows filled images to open annotation on design and code canvases', () => {
    const image = createDefaultShape('image', 0, 0)
    image.imageUrl = 'assets/image.png'
    const emptyImage = createDefaultShape('image', 0, 0)
    const rect = createDefaultShape('rect', 0, 0)

    expect(shouldOpenImageAnnotation('design', image)).toBe(true)
    expect(shouldOpenImageAnnotation('code', image)).toBe(true)
    expect(shouldOpenImageAnnotation('code', emptyImage)).toBe(false)
    expect(shouldOpenImageAnnotation('code', rect)).toBe(false)
  })

  it('allows code canvases to override the design-system persistence directory', () => {
    expect(resolveCanvasDesignSystemBaseDir('.kun-canvas', '.kun-canvas/code-thread-1')).toBe(
      '.kun-canvas/code-thread-1'
    )
    expect(resolveCanvasDesignSystemBaseDir('.kun-design/doc-1', undefined)).toBe('.kun-design/doc-1')
  })

  it('keeps design canvas keyboard shortcuts global', () => {
    expect(shouldHandleCanvasKeyboardEvent('design', null, null, null)).toBe(true)
  })

  it('scopes code canvas keyboard shortcuts to the whiteboard tree', () => {
    const inside = {}
    const activeInside = {}
    const outside = {}
    const root = {
      contains: (target: unknown) => target === inside || target === activeInside
    } as HTMLElement

    expect(shouldHandleCanvasKeyboardEvent('code', inside as EventTarget, root, null)).toBe(true)
    expect(shouldHandleCanvasKeyboardEvent('code', outside as EventTarget, root, activeInside as Element)).toBe(true)
    expect(shouldHandleCanvasKeyboardEvent('code', outside as EventTarget, root, null)).toBe(false)
    expect(shouldHandleCanvasKeyboardEvent('code', inside as EventTarget, null, null)).toBe(false)
  })
})

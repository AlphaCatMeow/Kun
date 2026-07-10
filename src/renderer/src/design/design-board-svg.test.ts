import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDesignArtifactSyncKey,
  removedLinkedArtifactIds,
  syncDesignArtifactsToBoardDocument,
  syncSvgFrameNodesToArtifacts
} from './design-board-svg'
import { createEmptyDocument, createSvgFrameShape, isSvgFrame } from './canvas/canvas-types'
import { useCanvasViewportStore } from './canvas/canvas-viewport-store'
import { useDesignWorkspaceStore } from './design-workspace-store'
import { artifact, installDesignDocument } from './design-board.test-helpers'

describe('SVG artifact board synchronization', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      kunGui: { writeWorkspaceFile: vi.fn(async () => ({ ok: true as const })) }
    })
    useCanvasViewportStore.getState().setContainerSize(1200, 800)
    useCanvasViewportStore.getState().setVbox({ x: -600, y: -400, width: 1200, height: 800 })
    useDesignWorkspaceStore.setState({ designContext: { designTarget: 'web' } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('includes SVG version, geometry, and hidden state in the artifact sync key', () => {
    const visible = artifact('motion', 'svg', {
      relativePath: '.kun-design/doc/motion/v1.svg',
      node: { x: 10, y: 20, width: 320, height: 240, sizeMode: 'manual' }
    })
    const changed = {
      ...visible,
      relativePath: '.kun-design/doc/motion/v2.svg',
      node: { ...visible.node!, boardHidden: true }
    }
    expect(buildDesignArtifactSyncKey([visible], 'web')).not.toBe(
      buildDesignArtifactSyncKey([changed], 'web')
    )
  })

  it('materializes a persisted SVG artifact as a first-class linked frame', () => {
    const motion = artifact('motion', 'svg', {
      title: 'Orbit loader',
      relativePath: '.kun-design/doc/motion/v1.svg',
      node: { x: 120, y: 80, width: 320, height: 240, sizeMode: 'manual', viewMode: 'preview' }
    })
    const synced = syncDesignArtifactsToBoardDocument(createEmptyDocument(), [motion])

    expect(synced.addedFrameIds).toHaveLength(1)
    const frame = synced.document.objects[synced.addedFrameIds[0]]
    expect(frame && isSvgFrame(frame)).toBe(true)
    expect(frame).toMatchObject({
      name: 'Orbit loader',
      x: 120,
      y: 80,
      width: 320,
      height: 240,
      embeddedArtifact: { id: 'motion', kind: 'svg' }
    })
  })

  it('removes duplicate SVG links and detects deletion of the last linked frame', () => {
    const motion = artifact('motion', 'svg')
    const before = createEmptyDocument()
    const first = createSvgFrameShape('Motion', 0, 0, motion.id)
    const duplicate = createSvgFrameShape('Duplicate', 700, 0, motion.id)
    before.objects[first.id] = { ...first, parentId: before.rootId }
    before.objects[duplicate.id] = { ...duplicate, parentId: before.rootId }
    before.objects[before.rootId] = {
      ...before.objects[before.rootId],
      children: [first.id, duplicate.id]
    }

    const deduped = syncDesignArtifactsToBoardDocument(before, [motion])
    expect(deduped.removedFrameIds).toEqual([duplicate.id])
    expect(removedLinkedArtifactIds(deduped.document, createEmptyDocument())).toEqual(['motion'])
  })

  it('persists SVG frame geometry back to the artifact node', () => {
    const motion = artifact('motion', 'svg', {
      node: { x: 0, y: 0, width: 640, height: 480, sizeMode: 'manual' }
    })
    installDesignDocument([motion], motion.id)
    const doc = createEmptyDocument()
    const frame = createSvgFrameShape('Motion', 44, 66, motion.id, 420, 280)
    doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [frame.id] }

    syncSvgFrameNodesToArtifacts(doc)

    expect(useDesignWorkspaceStore.getState().artifacts[0]?.node).toMatchObject({
      x: 44,
      y: 66,
      width: 420,
      height: 280,
      sizeMode: 'manual',
      boardHidden: false
    })
  })
})

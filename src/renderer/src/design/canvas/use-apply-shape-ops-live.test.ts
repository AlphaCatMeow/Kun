import { describe, expect, it, vi } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import {
  activeCanvasTurnMatchesThread,
  canvasReplayStateForStoreUpdate,
  latestGeneratedImageRelativePathForTurn,
  looksLikeExistingCanvasImageEditRequest,
  replayActiveCanvasTurn,
  resolveGeneratedImageFallbackTarget
} from './use-apply-shape-ops-live'
import { createDefaultShape, createEmptyDocument } from './canvas-types'

describe('replayActiveCanvasTurn', () => {
  it('replays existing tool blocks and streaming text when enabled mid-turn', () => {
    const toolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-1',
      summary: 'canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1',
        blocks: [
          { kind: 'user', id: 'user-1', text: 'draw a diagram' },
          toolBlock,
          { kind: 'assistant', id: 'assistant-1', text: 'Working on it.' }
        ] satisfies ChatBlock[]
      },
      applyToolBlock,
      processStreaming
    )

    expect(applyToolBlock).toHaveBeenCalledTimes(1)
    expect(applyToolBlock).toHaveBeenCalledWith(toolBlock)
    expect(processStreaming).toHaveBeenCalledTimes(1)
  })

  it('replays only tool blocks after the current turn user block', () => {
    const oldToolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-old',
      summary: 'old canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const currentToolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-current',
      summary: 'current canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        currentTurnId: 'turn-2',
        currentTurnUserId: 'user-2',
        blocks: [
          { kind: 'user', id: 'user-1', text: 'old request' },
          oldToolBlock,
          { kind: 'assistant', id: 'assistant-1', text: 'Done.' },
          { kind: 'user', id: 'user-2', text: 'current request' },
          currentToolBlock
        ] satisfies ChatBlock[]
      },
      applyToolBlock,
      processStreaming
    )

    expect(applyToolBlock).toHaveBeenCalledTimes(1)
    expect(applyToolBlock).toHaveBeenCalledWith(currentToolBlock)
    expect(processStreaming).toHaveBeenCalledTimes(1)
  })

  it('stops replay at the next user block if the current user id is stale', () => {
    const currentToolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-current',
      summary: 'current canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const nextToolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-next',
      summary: 'next canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1',
        blocks: [
          { kind: 'user', id: 'user-1', text: 'current request' },
          currentToolBlock,
          { kind: 'user', id: 'user-2', text: 'future request' },
          nextToolBlock
        ] satisfies ChatBlock[]
      },
      applyToolBlock,
      processStreaming
    )

    expect(applyToolBlock).toHaveBeenCalledTimes(1)
    expect(applyToolBlock).toHaveBeenCalledWith(currentToolBlock)
    expect(processStreaming).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no turn is active', () => {
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        currentTurnId: null,
        blocks: [
          {
            kind: 'tool',
            id: 'tool-1',
            summary: 'canvas op',
            status: 'success',
            meta: { toolName: 'design_update_shapes' },
            detail: '{"ops":[]}'
          }
        ]
      },
      applyToolBlock,
      processStreaming
    )

    expect(applyToolBlock).not.toHaveBeenCalled()
    expect(processStreaming).not.toHaveBeenCalled()
  })

  it('can scope replay to the active code whiteboard thread', () => {
    const toolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-1',
      summary: 'canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        activeThreadId: 'thread-code',
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1',
        blocks: [
          { kind: 'user', id: 'user-1', text: 'draw a diagram' },
          toolBlock
        ] satisfies ChatBlock[]
      },
      applyToolBlock,
      processStreaming,
      'thread-code'
    )

    expect(activeCanvasTurnMatchesThread({ activeThreadId: 'thread-code' }, 'thread-code')).toBe(true)
    expect(applyToolBlock).toHaveBeenCalledTimes(1)
    expect(processStreaming).toHaveBeenCalledTimes(1)
  })

  it('does not replay canvas output from another thread', () => {
    const toolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-foreign',
      summary: 'canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()

    replayActiveCanvasTurn(
      {
        activeThreadId: 'thread-other',
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1',
        blocks: [
          { kind: 'user', id: 'user-1', text: 'draw a diagram' },
          toolBlock
        ] satisfies ChatBlock[]
      },
      applyToolBlock,
      processStreaming,
      'thread-code'
    )

    expect(activeCanvasTurnMatchesThread({ activeThreadId: 'thread-other' }, 'thread-code')).toBe(false)
    expect(applyToolBlock).not.toHaveBeenCalled()
    expect(processStreaming).not.toHaveBeenCalled()
  })

  it('can replay tool blocks that arrive in the same update that clears the turn id', () => {
    const toolBlock: ToolBlock = {
      kind: 'tool',
      id: 'tool-late',
      summary: 'canvas op',
      status: 'success',
      meta: { toolName: 'design_update_shapes' },
      detail: '{"ops":[]}'
    }
    const applyToolBlock = vi.fn()
    const processStreaming = vi.fn()
    const replayState = canvasReplayStateForStoreUpdate(
      {
        activeThreadId: 'thread-code',
        currentTurnId: null,
        currentTurnUserId: null,
        blocks: [
          { kind: 'user', id: 'user-1', text: 'put it on the canvas' },
          toolBlock
        ] satisfies ChatBlock[]
      },
      {
        currentTurnId: 'turn-1',
        currentTurnUserId: 'user-1'
      }
    )

    replayActiveCanvasTurn(replayState, applyToolBlock, processStreaming, 'thread-code')

    expect(replayState.currentTurnId).toBe('turn-1')
    expect(replayState.currentTurnUserId).toBe('user-1')
    expect(applyToolBlock).toHaveBeenCalledTimes(1)
    expect(applyToolBlock).toHaveBeenCalledWith(toolBlock)
    expect(processStreaming).toHaveBeenCalledTimes(1)
  })
})

describe('generated image canvas fallback helpers', () => {
  it('detects existing-image edit requests from visible user copy', () => {
    expect(looksLikeExistingCanvasImageEditRequest('按图片批注修改：换个颜色的鞋')).toBe(true)
    expect(looksLikeExistingCanvasImageEditRequest('change the selected image shoes to red')).toBe(true)
    expect(looksLikeExistingCanvasImageEditRequest('生成一个新的品牌 logo')).toBe(false)
  })

  it('extracts the newest generated image file from generate_image tool blocks', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'generate',
        status: 'success',
        meta: {
          toolName: 'generate_image',
          generatedFiles: [{ relativePath: '.deepseekgui-images/old.png' }]
        }
      },
      {
        kind: 'tool',
        id: 'tool-2',
        summary: 'speech',
        status: 'success',
        meta: {
          toolName: 'generate_speech',
          generatedFiles: [{ relativePath: '.deepseekgui-audio/voice.mp3' }]
        }
      },
      {
        kind: 'tool',
        id: 'tool-3',
        summary: 'generate',
        status: 'success',
        meta: {
          toolName: 'mcp__kun__generate_image',
          generatedFiles: [{ relativePath: '.deepseekgui-images/new.png' }]
        }
      }
    ]

    expect(latestGeneratedImageRelativePathForTurn(blocks)).toBe('.deepseekgui-images/new.png')
  })

  it('extracts generated image paths from assistant markdown image output', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'assistant',
        id: 'assistant-1',
        text: 'Done.\n![generated image](.deepseekgui-images/native.png)\n'
      }
    ]

    expect(latestGeneratedImageRelativePathForTurn(blocks)).toBe('.deepseekgui-images/native.png')
  })

  it('resolves a fallback target only for one selected filled image', () => {
    const document = createEmptyDocument()
    const image = createDefaultShape('image', 0, 0)
    image.imageUrl = '.deepseekgui-images/source.png'
    document.objects[image.id] = image
    document.objects[document.rootId] = {
      ...document.objects[document.rootId]!,
      children: [image.id]
    }

    expect(
      resolveGeneratedImageFallbackTarget({
        document,
        selectedIds: new Set([image.id]),
        userText: '换个颜色的鞋'
      })
    ).toEqual({ id: image.id, imageUrl: '.deepseekgui-images/source.png' })
    expect(
      resolveGeneratedImageFallbackTarget({
        document,
        selectedIds: new Set([image.id]),
        userText: '生成一个新的品牌 logo'
      })
    ).toBeNull()
    expect(
      resolveGeneratedImageFallbackTarget({
        document,
        selectedIds: new Set(),
        userText: '换个颜色的鞋'
      })
    ).toBeNull()
  })
})

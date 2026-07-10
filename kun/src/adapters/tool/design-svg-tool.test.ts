import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDesignSvgAnimateTool,
  createDesignSvgEditTool,
  createDesignSvgInspectTool,
  createDesignSvgValidateTool
} from './design-svg-tool.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const workspaces: string[] = []
const relativePath = '.kun-design/doc/artifact/v1.svg'

function context(workspace: string, path = relativePath): ToolHostContext {
  return {
    threadId: 'thread_svg',
    turnId: 'turn_svg',
    workspace,
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    guiDesignMode: true,
    guiDesignArtifact: {
      kind: 'svg',
      artifactId: 'artifact',
      relativePath: path
    }
  }
}

async function workspaceWithSvg(source = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" role="img" aria-labelledby="title desc">',
  '  <title id="title">Motion mark</title>',
  '  <desc id="desc">A test vector animation.</desc>',
  '  <g id="artwork" />',
  '</svg>'
].join('\n')): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'kun-design-svg-'))
  workspaces.push(workspace)
  const absolutePath = join(workspace, relativePath)
  await mkdir(join(workspace, '.kun-design/doc/artifact'), { recursive: true })
  await writeFile(absolutePath, source, 'utf8')
  return workspace
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })))
})

describe('design SVG tools', () => {
  it('advertises tools only when a reserved SVG artifact is active', async () => {
    const workspace = await workspaceWithSvg()
    const tool = createDesignSvgInspectTool()
    expect(tool.shouldAdvertise?.(context(workspace))).toBe(true)
    expect(tool.shouldAdvertise?.({ ...context(workspace), guiDesignArtifact: undefined })).toBe(false)
    expect(tool.shouldAdvertise?.({ ...context(workspace), guiDesignMode: undefined })).toBe(false)
  })

  it('edits real SVG structure and adds declarative transform and path-draw animation', async () => {
    const workspace = await workspaceWithSvg()
    const edit = await createDesignSvgEditTool().execute({
      ops: [
        { op: 'set-document', attributes: { viewBox: '0 0 240 160', width: 240, height: 160 } },
        {
          op: 'add',
          parentId: 'artwork',
          element: {
            tag: 'defs',
            id: 'paint',
            children: [{
              tag: 'linearGradient',
              id: 'brand-gradient',
              attributes: { x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              children: [
                { tag: 'stop', id: 'brand-start', attributes: { offset: 0, 'stop-color': '#7c3aed' } },
                { tag: 'stop', id: 'brand-end', attributes: { offset: 1, 'stop-color': '#22d3ee' } }
              ]
            }]
          }
        },
        {
          op: 'add',
          parentId: 'artwork',
          element: {
            tag: 'rect',
            id: 'card',
            attributes: { x: 40, y: 24, width: 160, height: 112, rx: 28, fill: 'url(#brand-gradient)' }
          }
        },
        {
          op: 'add',
          parentId: 'artwork',
          element: {
            tag: 'path',
            id: 'orbit',
            attributes: { d: 'M60 80 C90 24 150 24 180 80', fill: 'none', stroke: '#fff', 'stroke-width': 6 }
          }
        }
      ]
    }, context(workspace))
    expect(edit.isError).toBeUndefined()
    expect(edit.output).toMatchObject({ ok: true, affectedIds: ['paint', 'card', 'orbit'] })

    const animate = await createDesignSvgAnimateTool().execute({
      animations: [
        {
          id: 'card-pulse',
          targetId: 'card',
          kind: 'transform',
          transformType: 'scale',
          values: ['1 1', '1.05 1.05', '1 1'],
          keyTimes: [0, 0.5, 1],
          durationMs: 1400,
          iterations: 'infinite'
        },
        {
          id: 'orbit-draw',
          targetId: 'orbit',
          kind: 'path-draw',
          durationMs: 900
        },
        {
          id: 'card-motion',
          targetId: 'card',
          kind: 'motion',
          path: 'M0 0 C10 -8 20 -8 30 0',
          durationMs: 1800,
          iterations: 'infinite'
        }
      ]
    }, context(workspace))
    expect(animate.isError).toBeUndefined()
    expect(animate.output).toMatchObject({ ok: true })

    const inspect = await createDesignSvgInspectTool().execute({}, context(workspace))
    expect(inspect.output).toMatchObject({ ok: true, viewBox: '0 0 240 160', animationCount: 3 })
    const validate = await createDesignSvgValidateTool().execute({}, context(workspace))
    expect(validate.isError).toBe(false)
    expect(validate.output).toMatchObject({ ok: true })

    const source = await readFile(join(workspace, relativePath), 'utf8')
    expect(source).toContain('<linearGradient')
    expect(source).toContain('<animateTransform')
    expect(source).toContain('<animateMotion')
    expect(source).toContain('stroke-dasharray="1"')
    expect(source).not.toContain('<script')
  })

  it('rejects unsafe elements and external resources without mutating the artifact', async () => {
    const workspace = await workspaceWithSvg()
    const absolutePath = join(workspace, relativePath)
    const before = await readFile(absolutePath, 'utf8')
    const script = await createDesignSvgEditTool().execute({
      ops: [{ op: 'add', parentId: 'artwork', element: { tag: 'script', id: 'payload', text: 'alert(1)' } }]
    }, context(workspace))
    expect(script.isError).toBe(true)
    expect(script.output).toMatchObject({ ok: false, error: expect.stringContaining('unsupported SVG element') })

    const remoteImage = await createDesignSvgEditTool().execute({
      ops: [{
        op: 'add',
        parentId: 'artwork',
        element: { tag: 'image', id: 'remote', attributes: { href: 'https://example.com/tracker.png' } }
      }]
    }, context(workspace))
    expect(remoteImage.isError).toBe(true)
    expect(remoteImage.output).toMatchObject({ ok: false, error: expect.stringContaining('unsafe SVG attribute') })
    expect(await readFile(absolutePath, 'utf8')).toBe(before)
  })

  it('rejects artifact paths that escape the reserved .kun-design version layout', async () => {
    const workspace = await workspaceWithSvg()
    const result = await createDesignSvgInspectTool().execute(
      {},
      context(workspace, '../outside/v1.svg')
    )
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ ok: false, error: expect.stringContaining('workspace root') })
  })

  it('reports unsafe content in a hand-authored SVG', async () => {
    const workspace = await workspaceWithSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script id="bad">alert(1)</script><image id="remote" href="https://example.com/x.png" /></svg>'
    )
    const result = await createDesignSvgValidateTool().execute({}, context(workspace))
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ ok: false })
    expect(JSON.stringify(result.output)).toContain('unsafe-element')
    expect(JSON.stringify(result.output)).toContain('unsafe-attribute')
  })
})

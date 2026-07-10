import { describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentSdkRuntime, resolveTurnPlanContext, waitForGate } from './agent-sdk-runtime-factory.js'
import { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type { UserInputGate, UserInputRequest, UserInputResolution } from '../../ports/user-input-gate.js'
import { InstructionRuntime } from '../../instructions/instruction-runtime.js'
import { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'

function fakeGate(pending: Promise<UserInputResolution>): {
  gate: UserInputGate
  resolvedWith: UserInputResolution[]
} {
  const resolvedWith: UserInputResolution[] = []
  const gate = {
    request: () => pending,
    resolve: (_id: string, resolution: UserInputResolution) => {
      resolvedWith.push(resolution)
      return true
    },
    get: () => undefined,
    pending: () => []
  } as unknown as UserInputGate
  return { gate, resolvedWith }
}

const req: UserInputRequest = { id: 'in1', threadId: 'th', turnId: 'tn', itemId: 'it1', prompt: 'pick', questions: [] }

describe('waitForGate', () => {
  test('resolves with the gate answer when the user submits', async () => {
    const answer: UserInputResolution = { status: 'submitted', answers: [] }
    const { gate } = fakeGate(Promise.resolve(answer))
    expect(await waitForGate(gate, req, new AbortController().signal)).toEqual(answer)
  })

  test('an already-aborted turn cancels the request immediately', async () => {
    const { gate, resolvedWith } = fakeGate(new Promise(() => {})) // never resolves
    const ac = new AbortController()
    ac.abort()
    expect(await waitForGate(gate, req, ac.signal)).toEqual({ status: 'cancelled' })
    expect(resolvedWith).toEqual([{ status: 'cancelled' }])
  })

  test('aborting mid-wait cancels the pending request and rejects', async () => {
    const { gate, resolvedWith } = fakeGate(new Promise(() => {}))
    const ac = new AbortController()
    const waiting = waitForGate(gate, req, ac.signal)
    ac.abort()
    await expect(waiting).rejects.toThrow(/cancelled/)
    expect(resolvedWith).toEqual([{ status: 'cancelled' }])
  })
})

function threadWith(partial: Partial<ThreadRecord>): ThreadRecord {
  return {
    id: 'th',
    title: 't',
    workspace: '/ws',
    model: 'claude-haiku-4-5',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    relation: 'primary',
    createdAt: '2026-06-27T00:00:00Z',
    updatedAt: '2026-06-27T00:00:00Z',
    turns: [],
    ...partial
  } as ThreadRecord
}

const planTurn = (id: string, workspaceRoot: string): ThreadRecord['turns'][number] =>
  ({
    id,
    prompt: 'plan it',
    guiPlan: { operation: 'draft', workspaceRoot, relativePath: '.kun/plan.md', planId: 'p1' }
  }) as ThreadRecord['turns'][number]

describe('resolveTurnPlanContext', () => {
  test('exposes the GUI plan + planMode for a plan turn in the same workspace', () => {
    const thread = threadWith({ workspace: '/ws', turns: [planTurn('tn', '/ws')] })
    const resolved = resolveTurnPlanContext(thread, 'tn')
    expect(resolved.planMode).toBe(true)
    expect(resolved.guiPlan?.relativePath).toBe('.kun/plan.md')
    expect(resolved.guiPlan?.turnId).toBe('tn')
  })

  test('drops a stale plan whose workspace does not match the thread', () => {
    const thread = threadWith({ workspace: '/ws', turns: [planTurn('tn', '/other-ws')] })
    const resolved = resolveTurnPlanContext(thread, 'tn')
    expect(resolved.guiPlan).toBeUndefined()
    // mode falls back to the thread mode (no live plan to force plan mode)
    expect(resolved.planMode).toBe(false)
  })

  test('plan mode via thread.mode without a GUI plan', () => {
    const thread = threadWith({ mode: 'plan', turns: [{ id: 'tn', prompt: 'x' } as ThreadRecord['turns'][number]] })
    const resolved = resolveTurnPlanContext(thread, 'tn')
    expect(resolved.planMode).toBe(true)
    expect(resolved.guiPlan).toBeUndefined()
  })

  test('a normal agent turn is not a plan turn', () => {
    const thread = threadWith({ turns: [{ id: 'tn', prompt: 'x' } as ThreadRecord['turns'][number]] })
    expect(resolveTurnPlanContext(thread, 'tn')).toEqual({ planMode: false })
  })
})

// handlesProvider only reads providerConfigs / agentSdkProviderIds / defaultIsAgentSdk,
// so the heavy service deps can be stubbed for this routing test.
function make(opts: { agentSdk: string[]; http: string[]; defaultIsAgentSdk: boolean }): {
  handlesProvider(id: string | undefined): boolean
} {
  const providerConfigs: Record<string, { baseUrl?: string; apiKey: string; kind?: 'http' | 'agent-sdk' }> = {}
  for (const id of opts.agentSdk) providerConfigs[id] = { kind: 'agent-sdk', apiKey: 'tok' }
  for (const id of opts.http) providerConfigs[id] = { baseUrl: 'https://x', apiKey: 'key' }
  return createAgentSdkRuntime({
    registry: {} as never,
    turns: {} as never,
    sessionStore: {} as never,
    threadStore: {} as never,
    events: {} as never,
    ids: { next: (p: string) => p },
    prefix: { systemPrompt: '' },
    providerConfigs: providerConfigs as never,
    agentSdkProviderIds: new Set(opts.agentSdk),
    defaultApprovalPolicy: 'auto',
    defaultIsAgentSdk: opts.defaultIsAgentSdk,
    defaultToken: 'tok'
  })
}

describe('createAgentSdkRuntime handlesProvider', () => {
  test('claims only explicit agent-sdk providers when default is not agent-sdk', () => {
    const r = make({ agentSdk: ['claude-subscription'], http: ['deepseek'], defaultIsAgentSdk: false })
    expect(r.handlesProvider('claude-subscription')).toBe(true)
    expect(r.handlesProvider('deepseek')).toBe(false)
    expect(r.handlesProvider(undefined)).toBe(false)
  })

  test('when the default provider is agent-sdk, also claims absent/default providerId', () => {
    const r = make({ agentSdk: ['claude-subscription'], http: ['deepseek'], defaultIsAgentSdk: true })
    expect(r.handlesProvider(undefined)).toBe(true) // default turn → SDK (the reported 401 case)
    expect(r.handlesProvider('claude-subscription')).toBe(true)
    expect(r.handlesProvider('deepseek')).toBe(false) // an explicit HTTP provider stays HTTP
  })
})

describe('createAgentSdkRuntime turn context', () => {
  test('exposes Design tools and the Design intent policy only for Design canvas turns', async () => {
    const listedContexts: Array<{ guiDesignCanvas?: boolean; guiDesignArtifact?: { kind: 'svg'; artifactId: string; relativePath: string } }> = []
    const executedContexts: Array<{ guiDesignCanvas?: boolean; guiDesignArtifact?: { kind: 'svg'; artifactId: string; relativePath: string } }> = []
    const designTurn = {
      id: 'tn',
      prompt: '做一个登录页',
      guiDesignCanvas: true,
      guiDesignMode: true,
      guiDesignArtifact: {
        kind: 'svg',
        artifactId: 'motion',
        relativePath: '.kun-design/doc/motion/v1.svg'
      }
    } as ThreadRecord['turns'][number]
    const runtime = createAgentSdkRuntime({
      registry: {
        listTools: (context: { guiDesignCanvas?: boolean; guiDesignArtifact?: { kind: 'svg'; artifactId: string; relativePath: string } }) => {
          listedContexts.push(context)
          return context.guiDesignCanvas
            ? [{ name: 'design_create_screen', description: 'Create screens', inputSchema: {} }]
            : []
        },
        resolveTool: (_name: string, context: { guiDesignCanvas?: boolean; guiDesignArtifact?: { kind: 'svg'; artifactId: string; relativePath: string } }) => ({
          tool: {
            execute: async () => {
              executedContexts.push(context)
              return { output: { ok: true } }
            }
          }
        })
      } as never,
      toolHost: {
        id: 'test-host',
        listTools: async () => [],
        execute: async (_call: unknown, context: { guiDesignCanvas?: boolean; guiDesignArtifact?: { kind: 'svg'; artifactId: string; relativePath: string } }) => {
          executedContexts.push(context)
          return { item: { kind: 'tool_result', output: { ok: true } }, approved: true }
        }
      } as never,
      turns: { updateTurnMetadata: async () => undefined } as never,
      sessionStore: {
        loadItems: async () => [{
          id: 'item_user',
          turnId: 'tn',
          threadId: 'th',
          kind: 'user_message',
          role: 'user',
          status: 'completed',
          text: '做一个登录页',
          createdAt: '2026-07-10T00:00:00.000Z'
        }]
      } as never,
      threadStore: {
        get: async () => threadWith({
          id: 'th',
          providerId: 'claude-subscription',
          turns: [designTurn]
        })
      } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: { 'claude-subscription': { kind: 'agent-sdk', apiKey: 'tok' } } as never,
      agentSdkProviderIds: new Set(['claude-subscription']),
      defaultApprovalPolicy: 'auto'
    })
    const deps = (runtime as unknown as {
      deps: {
        loadTurnContext(threadId: string, turnId: string): Promise<{
          contextInstructions?: string[]
          bridgeableTools: Array<{ name: string }>
        } | null>
        executeKunTool(
          threadId: string,
          turnId: string,
          toolName: string,
          args: Record<string, unknown>
        ): Promise<unknown>
      }
    }).deps

    const context = await deps.loadTurnContext('th', 'tn')
    await deps.executeKunTool('th', 'tn', 'design_create_screen', { name: 'Login' })

    expect(listedContexts).toEqual([expect.objectContaining({
      guiDesignCanvas: true,
      guiDesignArtifact: { kind: 'svg', artifactId: 'motion', relativePath: '.kun-design/doc/motion/v1.svg' }
    })])
    expect(executedContexts).toEqual([expect.objectContaining({
      guiDesignCanvas: true,
      guiDesignArtifact: { kind: 'svg', artifactId: 'motion', relativePath: '.kun-design/doc/motion/v1.svg' }
    })])
    expect(context?.bridgeableTools.map((tool) => tool.name)).toContain('design_create_screen')
    expect(context?.contextInstructions?.join('\n')).toContain('SINGLE SCREEN')
    expect(context?.contextInstructions?.join('\n')).toContain('COMPLETE MULTI-SCREEN EXPERIENCE')
  })

  test('does not fall back to the process workspace when a thread or turn has disappeared', async () => {
    const runtime = createAgentSdkRuntime({
      registry: {
        resolveTool: () => {
          throw new Error('a stale turn must not resolve a tool')
        }
      } as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: { get: async () => null } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto'
    })
    const deps = (runtime as unknown as {
      deps: {
        loadTurnContext(threadId: string, turnId: string): Promise<unknown>
        executeKunTool(
          threadId: string,
          turnId: string,
          toolName: string,
          args: Record<string, unknown>,
          signal?: AbortSignal
        ): Promise<{ output: unknown; isError: boolean }>
      }
    }).deps

    await expect(deps.loadTurnContext('deleted-thread', 'deleted-turn')).resolves.toBeNull()
    await expect(deps.executeKunTool(
      'deleted-thread',
      'deleted-turn',
      'bash',
      {},
      new AbortController().signal
    )).resolves.toEqual({
      output: 'turn is no longer active; tool execution was cancelled',
      isError: true
    })
  })

  test('runs bridged Kun tools through the canonical host policy boundary', async () => {
    const executed: string[] = []
    const tools = [
      LocalToolHost.defineTool({
        name: 'approval_required',
        description: 'Requires approval',
        inputSchema: { type: 'object', properties: {} },
        policy: 'on-request',
        toolKind: 'command_execution',
        execute: async () => {
          executed.push('approval_required')
          return { output: 'should not execute' }
        }
      }),
      LocalToolHost.defineTool({
        name: 'disabled_tool',
        description: 'Disabled',
        inputSchema: { type: 'object', properties: {} },
        policy: 'never',
        execute: async () => {
          executed.push('disabled_tool')
          return { output: 'should not execute' }
        }
      })
    ]
    const registry = CapabilityRegistry.fromLocalTools(tools)
    const runtime = createAgentSdkRuntime({
      registry,
      toolHost: new LocalToolHost({ registry }),
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: {
        get: async () => threadWith({
          workspace: '/ws',
          approvalPolicy: 'on-request',
          turns: [{ id: 'tn', prompt: 'run tool' } as ThreadRecord['turns'][number]]
        })
      } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'on-request'
    })
    const deps = (runtime as unknown as {
      deps: {
        executeKunTool(
          threadId: string,
          turnId: string,
          toolName: string,
          args: Record<string, unknown>
        ): Promise<{ output: unknown; isError?: boolean }>
      }
    }).deps

    await expect(deps.executeKunTool('th', 'tn', 'approval_required', {})).resolves.toMatchObject({
      isError: true,
      output: expect.objectContaining({ code: 'approval_denied' })
    })
    await expect(deps.executeKunTool('th', 'tn', 'disabled_tool', {})).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining('disabled by policy')
    })
    expect(executed).toEqual([])
  })

  test('uses the thread approval policy to gate SDK built-in tools', async () => {
    const events: Array<{ kind: string; approvalPolicy?: string }> = []
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: { get: async () => threadWith({ approvalPolicy: 'always' }) } as never,
      events: { record: async (event: { kind: string; approvalPolicy?: string }) => { events.push(event) } } as never,
      ids: { next: (prefix) => `${prefix}_1` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      approvalGate: {
        request: async () => 'allow', decide: () => false, pending: () => [], get: () => undefined
      } as never
    })
    const deps = (runtime as unknown as {
      deps: {
        decideToolApproval(threadId: string, turnId: string, toolName: string, input: Record<string, unknown>): Promise<{ allow: boolean }>
      }
    }).deps

    await expect(deps.decideToolApproval('th', 'tn', 'Bash', { command: 'pwd' })).resolves.toEqual({ allow: true })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'approval_requested', approvalPolicy: 'always' }))
  })

  test('denies SDK built-in tools under a thread never policy', async () => {
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: { get: async () => threadWith({ approvalPolicy: 'never' }) } as never,
      events: {} as never,
      ids: { next: (prefix) => `${prefix}_1` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto'
    })
    const deps = (runtime as unknown as {
      deps: {
        decideToolApproval(threadId: string, turnId: string, toolName: string, input: Record<string, unknown>): Promise<{ allow: boolean; message?: string }>
      }
    }).deps

    await expect(deps.decideToolApproval('th', 'tn', 'Bash', { command: 'pwd' })).resolves.toMatchObject({
      allow: false, message: expect.stringContaining('never')
    })
  })

  test('does not duplicate an HTTP-recorded user input resolution event', async () => {
    const events: Array<{ kind: string; inputId?: string }> = []
    const runtime = createAgentSdkRuntime({
      registry: {
        resolveTool: () => ({
          tool: {
            execute: async (_args: unknown, context: { awaitUserInput?: (input: {
              id: string; itemId: string; prompt: string; questions: []
            }) => Promise<unknown> }) => {
              await context.awaitUserInput?.({ id: 'in_sdk', itemId: 'item_sdk', prompt: 'Pick', questions: [] })
              return { output: {} }
            }
          }
        })
      } as never,
      toolHost: {
        id: 'test-host',
        listTools: async () => [],
        execute: async (_call: unknown, context: { awaitUserInput?: (input: {
          id: string; itemId: string; prompt: string; questions: []
        }) => Promise<unknown> }) => {
          await context.awaitUserInput?.({ id: 'in_sdk', itemId: 'item_sdk', prompt: 'Pick', questions: [] })
          return { item: { kind: 'tool_result', output: {} }, approved: true }
        }
      } as never,
      turns: { applyItem: async () => undefined, updateItem: async () => undefined } as never,
      sessionStore: {
        loadEventsSince: async () => [{ kind: 'user_input_resolved', inputId: 'in_sdk' }]
      } as never,
      threadStore: {
        get: async () => threadWith({
          workspace: '/ws',
          turns: [{ id: 'tn', prompt: 'ask' } as ThreadRecord['turns'][number]]
        })
      } as never,
      events: { record: async (event: { kind: string; inputId?: string }) => { events.push(event) } } as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      userInputGate: {
        request: async () => ({ status: 'submitted', answers: [] }),
        resolve: () => true,
        get: () => undefined,
        pending: () => []
      } as never
    })
    const deps = (runtime as unknown as {
      deps: { executeKunTool(threadId: string, turnId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> }
    }).deps

    await deps.executeKunTool('th', 'tn', 'user_input', {})

    expect(events.filter((event) => event.kind === 'user_input_requested')).toHaveLength(1)
    expect(events.filter((event) => event.kind === 'user_input_resolved')).toHaveLength(0)
  })

  test('injects native AGENTS.md instructions and records turn metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sdk-instructions-'))
    try {
      const home = join(root, 'home')
      const workspace = join(root, 'workspace')
      await mkdir(workspace, { recursive: true })
      await writeFile(join(workspace, 'AGENTS.md'), 'SDK workspace rule.', 'utf8')
      const updatedMetadata: unknown[] = []
      const runtime = createAgentSdkRuntime({
        registry: { listTools: () => [] } as never,
        turns: {
          updateTurnMetadata: async (_threadId: string, _turnId: string, patch: unknown) => {
            updatedMetadata.push(patch)
          }
        } as never,
        sessionStore: {
          loadItems: async () => [{
            id: 'item_user',
            turnId: 'tn',
            threadId: 'th',
            kind: 'user_message',
            role: 'user',
            status: 'completed',
            text: 'hello',
            createdAt: '2026-07-03T00:00:00.000Z'
          }]
        } as never,
        threadStore: {
          get: async () => threadWith({
            id: 'th',
            workspace,
            providerId: 'claude-subscription',
            turns: [{ id: 'tn', prompt: 'hello' } as ThreadRecord['turns'][number]]
          })
        } as never,
        events: {} as never,
        ids: { next: (p: string) => p },
        prefix: { systemPrompt: '' },
        providerConfigs: { 'claude-subscription': { kind: 'agent-sdk', apiKey: 'tok' } } as never,
        agentSdkProviderIds: new Set(['claude-subscription']),
        defaultApprovalPolicy: 'auto',
        instructionRuntime: new InstructionRuntime(
          KunCapabilitiesConfig.parse({ instructions: { enabled: true } }).instructions,
          { homeDir: home }
        )
      })
      const deps = (runtime as unknown as {
        deps: { loadTurnContext(threadId: string, turnId: string): Promise<{ contextInstructions?: string[] } | null> }
      }).deps

      const ctx = await deps.loadTurnContext('th', 'tn')

      expect(ctx?.contextInstructions?.join('\n')).toContain('SDK workspace rule.')
      expect(updatedMetadata[0]).toMatchObject({
        injectedInstructionSources: [expect.objectContaining({ scope: 'workspace', path: join(workspace, 'AGENTS.md') })],
        instructionInjectionBytes: expect.any(Number)
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

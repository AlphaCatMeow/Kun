import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { LayoutGrid, List as ListIcon, Loader2, X } from 'lucide-react'
import {
  normalizeWorkflowSettings,
  type WorkflowNodeRunStatus,
  type WorkflowRuntimeStatus,
  type WorkflowV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { NODE_ICONS, WorkflowRunStatusContext, workflowNodeTypes } from './WorkflowNodes'
import { toFlowEdges, toFlowNodes } from './workflow-types'

const POLL_MS = 1500

function statusDotClass(status: WorkflowNodeRunStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'bg-amber-500 animate-pulse'
    case 'success':
      return 'bg-emerald-500'
    case 'error':
      return 'bg-red-500'
    case 'skipped':
      return 'bg-ds-border'
    default:
      return 'bg-ds-border/50'
  }
}

type Props = {
  /** Poll + show only where it makes sense (e.g. the chat view, not the workflow editor itself). */
  enabled: boolean
}

/**
 * A live drawer that surfaces the running workflow's canvas (current step
 * highlighted) when a run is in progress — including agent-invoked runs. Polls
 * the WorkflowRuntime status; switchable between a read-only canvas and a step
 * list for troubleshooting. Dismissible; re-opens when a new run starts.
 */
export function WorkflowRunPanel({ enabled }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<WorkflowRuntimeStatus | null>(null)
  const [workflow, setWorkflow] = useState<WorkflowV1 | null>(null)
  const [shownId, setShownId] = useState<string | null>(null)
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'canvas' | 'list'>('canvas')
  const shownIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setStatus(null)
      return
    }
    let cancelled = false
    const poll = async (): Promise<void> => {
      if (typeof window.kunGui?.getWorkflowStatus !== 'function') return
      try {
        const next = await window.kunGui.getWorkflowStatus()
        if (!cancelled) setStatus(next)
      } catch {
        /* ignore transient status errors */
      }
    }
    void poll()
    const id = window.setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [enabled])

  // When a run starts, latch onto it (and un-dismiss if it's a fresh run).
  const runningId = status?.runningWorkflowIds[0] ?? null
  useEffect(() => {
    if (runningId && runningId !== shownIdRef.current) {
      shownIdRef.current = runningId
      setShownId(runningId)
      setDismissedId(null)
      setMode('canvas')
    }
  }, [runningId])

  const nodeStatus = useMemo<Record<string, WorkflowNodeRunStatus>>(
    () => (shownId && status?.nodeStatus[shownId]) || {},
    [shownId, status]
  )
  const isRunning = Boolean(shownId && status?.runningWorkflowIds.includes(shownId))
  const hasLiveStatus = Object.keys(nodeStatus).length > 0

  // Load the workflow definition for the shown run; reload when the run finishes
  // so the step list can pick up the persisted per-node results.
  useEffect(() => {
    if (!enabled || !shownId) {
      setWorkflow(null)
      return
    }
    let cancelled = false
    void rendererRuntimeClient.getSettings().then((settings) => {
      if (cancelled) return
      const found = normalizeWorkflowSettings(settings.workflow).workflows.find((item) => item.id === shownId) ?? null
      setWorkflow(found)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, shownId, isRunning])

  const flowNodes = useMemo(() => (workflow ? toFlowNodes(workflow.nodes) : []), [workflow])
  const flowEdges = useMemo(
    () => (workflow ? toFlowEdges(workflow.connections, nodeStatus) : []),
    [workflow, nodeStatus]
  )

  const visible = enabled && Boolean(shownId && workflow && dismissedId !== shownId && (isRunning || hasLiveStatus))
  if (!visible || !workflow) return null

  const lastRun = workflow.runs[workflow.runs.length - 1]

  return (
    <div className="ds-no-drag fixed right-0 top-0 z-[55] flex h-full w-[400px] flex-col border-l border-ds-border bg-ds-card shadow-xl">
      <div className="flex items-center gap-2 border-b border-ds-border px-3 py-2.5">
        {isRunning ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" strokeWidth={2} />
        ) : (
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass('success')}`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ds-ink">{workflow.name}</div>
          <div className="text-[11px] text-ds-faint">
            {isRunning ? t('workflowStatus_running') : t('workflowRunFinished')}
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-ds-border p-0.5">
          <button
            type="button"
            onClick={() => setMode('canvas')}
            title={t('workflowViewCanvas')}
            aria-label={t('workflowViewCanvas')}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
              mode === 'canvas' ? 'bg-accent/10 text-accent' : 'text-ds-faint hover:text-ds-ink'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={() => setMode('list')}
            title={t('workflowViewList')}
            aria-label={t('workflowViewList')}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
              mode === 'list' ? 'bg-accent/10 text-accent' : 'text-ds-faint hover:text-ds-ink'
            }`}
          >
            <ListIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDismissedId(shownId)}
          title={t('cancel')}
          aria-label={t('cancel')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      {mode === 'canvas' ? (
        <div className="relative min-h-0 flex-1">
          <ReactFlowProvider>
            <WorkflowRunStatusContext.Provider value={nodeStatus}>
              <ReactFlow
                className="ds-workflow-canvas"
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={workflowNodeTypes}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
                minZoom={0.2}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              </ReactFlow>
            </WorkflowRunStatusContext.Provider>
          </ReactFlowProvider>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
          {workflow.nodes.map((node) => {
            const Icon = NODE_ICONS[node.type]
            const result = lastRun?.nodeResults.find((entry) => entry.nodeId === node.id)
            const detail = result?.error || result?.message || ''
            return (
              <div key={node.id} className="flex items-start gap-2 rounded-lg border border-ds-border px-2.5 py-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDotClass(nodeStatus[node.id])}`} />
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-ds-ink">
                    {node.name.trim() || t(`workflowNode_${node.type}`)}
                  </div>
                  {detail ? (
                    <div className="mt-0.5 line-clamp-2 break-words text-[11px] leading-4 text-ds-faint">{detail}</div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

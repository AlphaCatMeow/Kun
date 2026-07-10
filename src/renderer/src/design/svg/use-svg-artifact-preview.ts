import { useEffect, useMemo, useState } from 'react'
import { buildSvgPreviewDocument, parseAndSanitizeSvgDocument, type SvgDiagnostic } from './svg-document'

export type SvgArtifactPreviewState = {
  status: 'loading' | 'ready' | 'invalid' | 'missing'
  srcDoc: string
  diagnostics: SvgDiagnostic[]
  animationCount: number
  visualElementCount: number
  durationMs: number
  revision: number
}

const INITIAL: SvgArtifactPreviewState = {
  status: 'loading',
  srcDoc: '',
  diagnostics: [],
  animationCount: 0,
  visualElementCount: 0,
  durationMs: 4000,
  revision: 0
}

export function useSvgArtifactPreview(
  workspaceRoot: string,
  relativePath: string,
  background: 'transparent' | 'light' | 'dark'
): SvgArtifactPreviewState {
  const [state, setState] = useState<SvgArtifactPreviewState>(INITIAL)

  useEffect(() => {
    let cancelled = false
    let watchId = ''
    let offChanged: (() => void) | undefined
    const api = typeof window !== 'undefined' ? window.kunGui : undefined
    setState(INITIAL)
    if (!workspaceRoot || !relativePath || typeof api?.readWorkspaceFile !== 'function') return

    const apply = (content: string): void => {
      if (cancelled) return
      const parsed = parseAndSanitizeSvgDocument(content)
      if (!parsed.ok) {
        setState((current) => ({
          ...current,
          status: 'invalid',
          diagnostics: parsed.diagnostics,
          revision: current.revision + 1
        }))
        return
      }
      setState((current) => ({
        status: 'ready',
        srcDoc: buildSvgPreviewDocument(parsed.svg, background),
        diagnostics: parsed.diagnostics,
        animationCount: parsed.animationCount,
        visualElementCount: parsed.visualElementCount,
        durationMs: parsed.durationMs,
        revision: current.revision + 1
      }))
    }

    const load = async (): Promise<void> => {
      const result = await api.readWorkspaceFile({ path: relativePath, workspaceRoot }).catch(() => null)
      if (cancelled) return
      if (!result?.ok) {
        setState((current) => ({ ...current, status: 'missing', revision: current.revision + 1 }))
        return
      }
      apply(result.content)
    }

    void load()
    if (api.watchWorkspaceFile && api.unwatchWorkspaceFile && api.onWorkspaceFileChanged) {
      offChanged = api.onWorkspaceFileChanged((payload) => {
        if (!cancelled && watchId && payload.watchId === watchId) {
          if (payload.ok) apply(payload.content)
          else void load()
        }
      })
      void api.watchWorkspaceFile({ path: relativePath, workspaceRoot }).then((result) => {
        if (cancelled) {
          if (result.ok) void api.unwatchWorkspaceFile?.(result.watchId)
          return
        }
        if (result.ok) {
          watchId = result.watchId
          apply(result.content)
        }
      }).catch(() => undefined)
    }

    return () => {
      cancelled = true
      offChanged?.()
      if (watchId) void api.unwatchWorkspaceFile?.(watchId).catch(() => undefined)
    }
  }, [background, relativePath, workspaceRoot])

  return useMemo(() => state, [state])
}

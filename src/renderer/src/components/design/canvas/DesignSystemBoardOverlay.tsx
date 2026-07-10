import { useMemo, useRef, useState, type ReactElement } from 'react'
import type { CanvasDocument, CanvasShape, Fill, Rect, ViewBox } from '../../../design/canvas/canvas-types'
import { getCanvasDocumentContentBounds } from '../../../design/canvas/canvas-placement'
import { useDesignSystemStore } from '../../../design/canvas/design-system-store'
import type { ComponentDef, DesignToken } from '../../../design/canvas/design-system-types'
import { PROJECT_DESIGN_SYSTEM_PATH } from '../../../design/canvas/project-design-system'
import { useProjectDesignSystemStore } from '../../../design/canvas/project-design-system-store'

type Props = {
  workspaceRoot: string
  document: CanvasDocument
  viewBox: ViewBox
}

const BOARD_WIDTH = 1520
const SECTION_BG = '#ffffff'

export function shouldRenderDesignSystemBoard(
  status: 'loading' | 'missing' | 'ready' | 'invalid'
): boolean {
  return status === 'ready' || status === 'invalid'
}

function solidColor(fills: Fill[] | undefined, fallback = '#e2e8f0'): string {
  const fill = fills?.find((item) => item.type === 'solid')
  return fill?.type === 'solid' ? fill.color : fallback
}

function previewObjects(component: ComponentDef, variantKey: string | null): Record<string, CanvasShape> {
  const overrides = variantKey ? component.variants?.[variantKey]?.overrides ?? {} : {}
  return Object.fromEntries(component.tree.map((shape) => [shape.id, { ...shape, ...(overrides[shape.id] ?? {}) }]))
}

function ComponentNode({ id, objects }: { id: string; objects: Record<string, CanvasShape> }): ReactElement | null {
  const shape = objects[id]
  if (!shape || shape.visible === false) return null
  const children = shape.children.map((childId) => <ComponentNode key={childId} id={childId} objects={objects} />)
  if (shape.type === 'text') {
    return (
      <g>
        <text
          x={shape.x}
          y={shape.y + (shape.fontSize ?? 16)}
          fill={shape.fontColor ?? '#0f172a'}
          fontFamily={shape.fontFamily ?? 'Inter, system-ui, sans-serif'}
          fontSize={shape.fontSize ?? 16}
          fontWeight={shape.fontWeight ?? 400}
        >
          {shape.textContent ?? shape.name}
        </text>
        {children}
      </g>
    )
  }
  if (shape.type === 'ellipse') {
    return (
      <g>
        <ellipse cx={shape.x + shape.width / 2} cy={shape.y + shape.height / 2} rx={shape.width / 2} ry={shape.height / 2} fill={solidColor(shape.fills)} />
        {children}
      </g>
    )
  }
  if (shape.type === 'image') {
    return (
      <g>
        <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={8} fill="#e2e8f0" />
        <text x={shape.x + 12} y={shape.y + 24} fill="#64748b" fontSize={12}>Image</text>
        {children}
      </g>
    )
  }
  return (
    <g>
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        rx={typeof shape.cornerRadius === 'number' ? shape.cornerRadius : 0}
        fill={solidColor(shape.fills, shape.type === 'group' ? 'transparent' : '#f8fafc')}
        stroke={shape.strokes?.[0]?.color ?? 'transparent'}
        strokeWidth={shape.strokes?.[0]?.width ?? 0}
      />
      {children}
    </g>
  )
}

function ComponentPreview({ component, variantKey }: { component: ComponentDef; variantKey: string | null }): ReactElement {
  const objects = useMemo(() => previewObjects(component, variantKey), [component, variantKey])
  const root = objects[component.tree[0]?.id]
  const width = Math.max(1, root?.width ?? 320)
  const height = Math.max(1, root?.height ?? 180)
  return (
    <svg className="h-44 w-full rounded-xl bg-slate-50" viewBox={`-12 -12 ${width + 24} ${height + 24}`} preserveAspectRatio="xMidYMid meet">
      {root ? <ComponentNode id={root.id} objects={objects} /> : null}
    </svg>
  )
}

function tokenValueText(token: DesignToken): string {
  return typeof token.value === 'string' || typeof token.value === 'number'
    ? String(token.value)
    : JSON.stringify(token.value)
}

function ProjectTokenEditor({ token }: { token: DesignToken }): ReactElement {
  const setToken = useDesignSystemStore((state) => state.setToken)
  const update = (raw: string): void => {
    if (token.kind === 'color') setToken({ ...token, value: raw })
    else if (token.kind === 'space' || token.kind === 'radius') {
      const value = Number(raw)
      if (Number.isFinite(value)) setToken({ ...token, value })
    }
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        {token.kind === 'color' ? (
          <input
            type="color"
            value={token.value}
            className="h-10 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
            onChange={(event) => update(event.target.value)}
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">{token.kind.slice(0, 2).toUpperCase()}</div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{token.name}</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">{token.kind}</div>
        </div>
      </div>
      {(token.kind === 'color' || token.kind === 'space' || token.kind === 'radius') ? (
        <input
          value={tokenValueText(token)}
          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-xs text-slate-700 outline-none focus:border-blue-400"
          onChange={(event) => update(event.target.value)}
        />
      ) : (
        <div className="max-h-16 overflow-hidden break-all font-mono text-[10px] leading-4 text-slate-500">{tokenValueText(token)}</div>
      )}
    </div>
  )
}

function ComponentEditor({ component }: { component: ComponentDef }): ReactElement {
  const setComponent = useDesignSystemStore((state) => state.setComponent)
  const variantKeys = Object.keys(component.variants ?? {})
  const [variantKey, setVariantKey] = useState<string | null>(null)
  const editLayer = (shapeId: string, patch: Partial<CanvasShape>): void => {
    if (variantKey) {
      const currentVariant = component.variants?.[variantKey]
      if (!currentVariant) return
      setComponent({
        ...component,
        version: component.version + 1,
        variants: {
          ...(component.variants ?? {}),
          [variantKey]: {
            ...currentVariant,
            overrides: {
              ...currentVariant.overrides,
              [shapeId]: { ...(currentVariant.overrides[shapeId] ?? {}), ...patch }
            }
          }
        }
      })
      return
    }
    setComponent({
      ...component,
      version: component.version + 1,
      tree: component.tree.map((shape) => shape.id === shapeId ? { ...shape, ...patch } : shape)
    })
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">{component.name}</div>
          <div className="text-xs text-slate-400">v{component.version} · {component.tree.length} layers</div>
        </div>
        <div className="flex max-w-[55%] gap-1 overflow-x-auto">
          <button type="button" className={`rounded-full px-2 py-1 text-[10px] ${variantKey === null ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setVariantKey(null)}>Base</button>
          {variantKeys.map((key) => (
            <button key={key} type="button" className={`rounded-full px-2 py-1 text-[10px] ${variantKey === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setVariantKey(key)}>{key}</button>
          ))}
        </div>
      </div>
      <ComponentPreview component={component} variantKey={variantKey} />
      <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
        {component.tree.map((shape) => {
          const active = variantKey ? component.variants?.[variantKey]?.overrides[shape.id] ?? {} : shape
          return (
            <div key={shape.id} className="grid grid-cols-[minmax(90px,1fr)_80px_80px] gap-2 text-xs">
              {shape.type === 'text' ? (
                <input className="min-w-0 rounded border border-slate-200 px-2 py-1" value={String(active.textContent ?? shape.textContent ?? '')} onChange={(event) => editLayer(shape.id, { textContent: event.target.value })} />
              ) : (
                <div className="truncate rounded bg-slate-50 px-2 py-1 text-slate-600">{shape.name}</div>
              )}
              <input type="number" title="Width" className="rounded border border-slate-200 px-2 py-1" value={Number(active.width ?? shape.width)} onChange={(event) => editLayer(shape.id, { width: Number(event.target.value) })} />
              <input type="number" title="Height" className="rounded border border-slate-200 px-2 py-1" value={Number(active.height ?? shape.height)} onChange={(event) => editLayer(shape.id, { height: Number(event.target.value) })} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function boardPlacement(document: CanvasDocument, viewBox: ViewBox): Rect {
  const bounds = getCanvasDocumentContentBounds(document)
  return bounds
    ? { x: bounds.x - BOARD_WIDTH - 160, y: bounds.y, width: BOARD_WIDTH, height: 1100 }
    : { x: viewBox.x + 80, y: viewBox.y + 80, width: BOARD_WIDTH, height: 1100 }
}

export function DesignSystemBoardOverlay({ workspaceRoot, document, viewBox }: Props): ReactElement | null {
  const status = useProjectDesignSystemStore((state) => state.status)
  const project = useProjectDesignSystemStore((state) => state.document)
  const errors = useProjectDesignSystemStore((state) => state.errors)
  const updateMeta = useProjectDesignSystemStore((state) => state.updateMeta)
  const system = useDesignSystemStore((state) => state.system)
  const placementRef = useRef<{ workspaceRoot: string; rect: Rect } | null>(null)
  if (!placementRef.current || placementRef.current.workspaceRoot !== workspaceRoot) {
    placementRef.current = { workspaceRoot, rect: boardPlacement(document, viewBox) }
  }
  // The design-system board is a projection of an actual workspace file. A
  // missing file is not a canvas object and must not create an empty-state
  // card on every design board.
  if (!shouldRenderDesignSystemBoard(status)) return null
  const rect = placementRef.current.rect
  const components = Object.values(system.components).sort((a, b) => a.name.localeCompare(b.name))
  const tokens = Object.values(system.tokens).sort((a, b) => a.name.localeCompare(b.name))
  const height = Math.max(420, 360 + Math.ceil(tokens.length / 4) * 160 + Math.ceil(components.length / 2) * 500)

  return (
    <foreignObject x={rect.x} y={rect.y} width={rect.width} height={height}>
      <div
        className="h-full w-full overflow-hidden rounded-[32px] border-2 border-slate-200 bg-slate-100 p-8 font-sans text-slate-900 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <div className="mb-7 flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Project Design System · Schema v1</div>
            <input
              value={project?.meta.name ?? 'Project design system'}
              className="w-full border-0 bg-transparent p-0 text-4xl font-bold tracking-tight outline-none"
              onChange={(event) => updateMeta({ name: event.target.value })}
            />
            <div className="mt-2 font-mono text-xs text-slate-400">{PROJECT_DESIGN_SYSTEM_PATH}</div>
          </div>
          <div className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white">{tokens.length} tokens · {components.length} components</div>
        </div>
        {status === 'invalid' ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Invalid file; showing the last valid design system. {errors.join(' ')}</div>
        ) : null}
        <section className="mb-8 rounded-3xl p-5" style={{ background: SECTION_BG }}>
          <h2 className="mb-4 text-lg font-semibold">Tokens</h2>
          {tokens.length ? <div className="grid grid-cols-4 gap-3">{tokens.map((token) => <ProjectTokenEditor key={token.name} token={token} />)}</div> : <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No tokens yet. Add them from the Design agent or edit the JSON file.</div>}
        </section>
        <section>
          <h2 className="mb-4 text-lg font-semibold">Components</h2>
          {components.length ? <div className="grid grid-cols-2 gap-5">{components.map((component) => <ComponentEditor key={component.id} component={component} />)}</div> : <div className="rounded-2xl bg-white p-6 text-sm text-slate-500">No component trees yet.</div>}
        </section>
      </div>
    </foreignObject>
  )
}

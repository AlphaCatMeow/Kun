import { describe, expect, it } from 'vitest'
import {
  nextInspectorOpenForSelection,
  propertiesPanelShellClass,
  propertiesPanelTriggerClass,
  shouldShowImageAnnotationAction
} from './PropertiesPanel'

describe('PropertiesPanel surface layout', () => {
  it('uses a compact inspector shell on the code whiteboard', () => {
    const className = propertiesPanelShellClass('code')

    expect(className).toContain('right-[64px]')
    expect(className).toContain('top-[60px]')
    expect(className).toContain('bottom-[92px]')
    expect(className).toContain('w-[236px]')
    expect(className).toContain('max-w-[calc(100%-80px)]')
    expect(className).toContain('rounded-[14px]')
    expect(className).not.toContain('right-[76px]')
    expect(className).not.toContain('w-[252px]')
  })

  it('keeps the full canvas inspector shell on the design surface', () => {
    const className = propertiesPanelShellClass('design')

    expect(className).toContain('right-[76px]')
    expect(className).toContain('top-[72px]')
    expect(className).toContain('bottom-[104px]')
    expect(className).toContain('w-[252px]')
    expect(className).toContain('rounded-[18px]')
    expect(className).not.toContain('max-w-[calc(100%-80px)]')
  })

  it('positions the collapsed inspector trigger for both whiteboards', () => {
    const codeClass = propertiesPanelTriggerClass('code')
    const designClass = propertiesPanelTriggerClass('design')

    expect(codeClass).toContain('right-[64px]')
    expect(codeClass).toContain('top-[60px]')
    expect(codeClass).toContain('rounded-full')
    expect(designClass).toContain('right-[76px]')
    expect(designClass).toContain('top-[72px]')
    expect(designClass).toContain('rounded-full')
  })

  it('shows image annotation actions on both design and code surfaces', () => {
    expect(shouldShowImageAnnotationAction('design', true)).toBe(true)
    expect(shouldShowImageAnnotationAction('code', true)).toBe(true)
    expect(shouldShowImageAnnotationAction('code', false)).toBe(false)
  })

  it('collapses the inspector by default for a newly selected object', () => {
    expect(nextInspectorOpenForSelection('', 'shape-1', false, false)).toBe(false)
  })

  it('keeps the inspector open for the same selection after the user expands it', () => {
    expect(nextInspectorOpenForSelection('shape-1', 'shape-1', true, false)).toBe(true)
  })

  it('opens a new selection only when the inspector is pinned', () => {
    expect(nextInspectorOpenForSelection('shape-1', 'shape-2', true, false)).toBe(false)
    expect(nextInspectorOpenForSelection('shape-1', 'shape-2', false, true)).toBe(true)
  })

  it('collapses when the canvas selection is cleared', () => {
    expect(nextInspectorOpenForSelection('shape-1', '', true, true)).toBe(false)
  })
})

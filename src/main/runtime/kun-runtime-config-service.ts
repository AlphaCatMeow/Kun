import type { KunConfig } from '../../../kun/src/config/kun-config.js'
import {
  resolveKunRuntimeSettings,
  resolveModelProviderProxyUrl,
  type AppSettingsV1
} from '../../shared/app-settings'
import { resolveCodexOAuthApiKey } from '../codex-auth'

export type ManagedRuntimeHotApplyResult = 'applied' | 'restart_required' | 'failed'

export type ManagedRuntimeHotApplyResponse = {
  result: ManagedRuntimeHotApplyResult
  message: string
}

/** Pure request projection for the serve runtime's hot-config endpoint. */
export function buildManagedRuntimeHotApplyBody(
  settings: AppSettingsV1,
  config: KunConfig
): KunConfig {
  const runtime = resolveKunRuntimeSettings(settings)
  const serve = config.serve ?? {}
  const defaultClientApiKey = resolveCodexOAuthApiKey(runtime.apiKey).apiKey
  return {
    ...config,
    serve: {
      ...serve,
      apiKey: defaultClientApiKey || runtime.apiKey,
      baseUrl: runtime.baseUrl,
      modelProxyUrl: resolveModelProviderProxyUrl(settings),
      endpointFormat: runtime.endpointFormat,
      model: runtime.model,
      approvalPolicy: runtime.approvalPolicy,
      sandboxMode: runtime.sandboxMode,
      tokenEconomyMode: runtime.tokenEconomyMode,
      tokenEconomy: runtime.tokenEconomy,
      toolOutputLimits: runtime.toolOutputLimits,
      providers: serve.providers ?? {}
    }
  }
}

/** Pure response policy: callers own logging, retry, restart, and status effects. */
export function classifyManagedRuntimeHotApplyResponse(
  status: number,
  ok: boolean,
  text: string
): ManagedRuntimeHotApplyResponse {
  if (status === 404 || status === 405) {
    return { result: 'restart_required', message: 'runtime does not support hot config apply' }
  }
  const parsed = parseResponseObject(text)
  if (ok && parsed?.ok === true) return { result: 'applied', message: '' }
  const message = String(parsed?.message ?? text).trim()
  if (parsed?.code === 'restart_required') {
    return { result: 'restart_required', message }
  }
  return {
    result: 'failed',
    message: message || `Kun hot config apply failed with HTTP ${status}`
  }
}

function parseResponseObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

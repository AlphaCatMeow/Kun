/** Returns true only for local bind addresses that cannot expose serve on a LAN. */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return normalized === 'localhost' ||
    normalized === '::1' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('::ffff:127.')
}

// ----------------------------
// LoggerService.ts
// Must be imported before any other application code (e.g. in index.tsx)

// Buffer to hold all log entries and registered listeners
declare global {
  interface Window {
    logBacklog: Array<{ method: string; text: string }>
    logListeners: Array<(entry: { method: string; text: string }) => void>
  }
}
window.logBacklog = []
window.logListeners = []

// Preserve originals
const originalConsole: Record<string, any> = {
  log: console.log,
  info: console.info,
  debug: console.debug,
  warn: console.warn,
  error: console.error,
  trace: console.trace,
}

// Safe JSON stringify
function safeStringify(obj: any): string {
  const seen = new WeakSet()
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  })
}
// Immediately patch console methods
;(function patchConsole() {
  for (method of ['log', 'info', 'debug', 'warn', 'error', 'trace']) {
    ;(console as any)[method] = (...args: any[]) => {
      originalConsole[method].apply(console, args)
      const text = args.map((a) => (a && typeof a === 'object' ? safeStringify(a) : String(a))).join(' ')
      const entry = { method, text }
      window.logBacklog.push(entry)
      for (fn of window.logListeners) {
        fn(entry)
      }
      if (method === 'trace') {
        const stack = new Error().stack
          ?.split('\n')
          .slice(1)
          .map((l) => `  ${l.trim()}`)
          .join('\n')
        if (stack) {
          const traceEntry = { method: 'trace', text: stack }
          window.logBacklog.push(traceEntry)
          for (fn of window.logListeners) {
            fn(traceEntry)
          }
        }
      }
    }
  }
})()

export function registerLogListener(fn: (entry: { method: string; text: string }) => void) {
  window.logListeners.push(fn)
}

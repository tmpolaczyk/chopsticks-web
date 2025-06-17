import { Terminal } from '@xterm/xterm'
import type React from 'react'
import { useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'

// 1) Declare your handler
let writeEntry = null
const handler = (e: MessageEvent) => {
  if (writeEntry && e.data?.type === 'console') {
    // TODO: if writeEntry == null, maybe buffer logs somewhere?
    writeEntry(e.data.method, e.data.text)
  }
}

// 2) Monkey-patch window.Worker (or globalThis.Worker)
{
  const NativeWorker = window.Worker
  window.Worker = class WorkerWrapped extends NativeWorker {
    constructor(...args) {
      super(...args)
      // every time any code does `new Worker(...)`—including getWorker’s startWorker—
      // your handler gets wired up automatically
      this.addEventListener('message', handler)
    }
  }
  // keep the prototype chain intact so `instanceof Worker` still works
  //window.Worker.prototype = NativeWorker.prototype;
}

const ConsoleTerminal: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Initialize xterm.js with FitAddon for full-width
    const term = new Terminal({ cursorBlink: true })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    // Fit on first paint
    requestAnimationFrame(() => {
      fitAddon.fit()
      term.writeln('\x1b[32m— Console attached and ready —\x1b[0m')
    })

    // Write each console entry into the terminal
    const writeEntry2 = (method: string, text: string) => {
      const prefix = ''
      /*switch (method) {
        case 'info':  prefix = '\x1b[34m[INFO]\x1b[0m ';  break;
        case 'debug': prefix = '\x1b[36m[DEBUG]\x1b[0m '; break;
        case 'warn':  prefix = '\x1b[33m[WARN]\x1b[0m ';  break;
        case 'error': prefix = '\x1b[31m[ERROR]\x1b[0m '; break;
        case 'trace': prefix = '\x1b[35m[TRACE]\x1b[0m '; break;
      }*/
      term.writeln(prefix + text)
    }
    writeEntry = writeEntry2

    // Listen for global console messages
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'console') {
        writeEntry(e.data.method, e.data.text)
      }
    }

    // Cleanup
    return () => {
      term.dispose()
      writeEntry = null
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: 300, border: '1px solid #ccc', overflow: 'hidden' }} />
}

export default ConsoleTerminal

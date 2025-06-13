import { Terminal } from '@xterm/xterm'
import type React from 'react'
import { useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'

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
    const writeEntry = (method: string, text: string) => {
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

    // Listen for global console messages
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'console') {
        writeEntry(e.data.method, e.data.text)
      }
    }
    window.addEventListener('message', handler)

    // Cleanup
    return () => {
      window.removeEventListener('message', handler)
      term.dispose()
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: 300, border: '1px solid #ccc', overflow: 'hidden' }} />
}

export default ConsoleTerminal

import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

function browserWasmExecutorPatch() {
  // hard-coded source and destination:
  const src = './node_modules/@acala-network/chopsticks-core/dist/esm/wasm-executor/browser-wasm-executor.js'
  const dest = './node_modules/.vite/deps/browser-wasm-executor.js'

  const srcPath = path.resolve(process.cwd(), src)
  const destPath = path.resolve(process.cwd(), dest)

  // Console patch header
  const consolePatch = `
    // Patch console.* to postMessage back to main
    const orig = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      trace: console.trace.bind(console),
    };
    function safeStringify(obj) {
      const seen = new WeakSet();
      return JSON.stringify(obj, (_k, v) => {
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      });
    }
    for (const m of ['log','info','debug','warn','error','trace']) {
      console[m] = (...args) => {
        orig[m](...args);
        const text = args.map(a => (a && typeof a === 'object') ? safeStringify(a) : String(a)).join(' ');
        self.postMessage({ type: 'console', method: m, text });
      };
    }
    // Ensure nested workers remain using the native Worker
    globalThis.Worker = Worker;
    
        // catch any uncaught in the loader before import
    self.addEventListener('error', e => {
      self.postMessage({
        type: 'console',
        method: 'error',
        text: \`Uncaught loader error: \${e.message} at \${e.filename}:\${e.lineno}\`
      });
    });
  `

  // load source file as text
  const original = fs.readFileSync(srcPath, 'utf8')
  // make sure dest folder exists
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  // copy
  fs.writeFileSync(destPath, consolePatch + original, 'utf8')

  console.warn(`[copy-file-plugin] copied ${src} → ${dest}`)
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-file-plugin',
      configureServer() {
        browserWasmExecutorPatch()
      },
      closeBundle() {
        browserWasmExecutorPatch()
      },
    },
  ],
  base: '/chopsticks-web',
  define: {
    'process.env.LOG_LEVEL': JSON.stringify('trace'),
    'process.env.VERBOSE_LOG': JSON.stringify('true'),
  },
})

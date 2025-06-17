// src/patchAllWorkers.ts
// Monkey-patches the global Worker constructor to inject console.* overrides into every module worker
// Must be imported as the very first module in your main entry (e.g. main.tsx)
//import WorkerFactory from '@acala-network/chopsticks-core/dist/esm/wasm-executor/browser-wasm-executor.js?worker';

// Cache for preloaded worker script sources
const scriptCache: Record<string, string> = {}
window.scriptCache = scriptCache

// Expose a preload function to fetch and cache worker scripts ahead of time
declare global {
  interface Window {
    preloadWorkerScript(url: string): Promise<void>
    populateCache(): Promise<void>
  }
}

window.preloadWorkerScript = async (url: string) => {
  if (!scriptCache[url]) {
    const res = await fetch(url)
    const code = await res.text()
    scriptCache[url] = code
    console.info(`preloadWorkerScript: cached ${url}`)
  }
}
/*
window.preloadWorkerScript = async (url: string) => {
  if (!scriptCache[url]) {
    const res = await fetch(url)
    const code = await res.text()
    scriptCache[url] = code
    console.info(`preloadWorkerScript: cached ${url}`)

    // Also cache the Vite-generated URL variant, if applicable
    try {
      const parts = url.split('/')
      const filename = parts[parts.length - 1]
      const viteUrl = new URL(`../node_modules/.vite/deps/${filename}?worker_file&type=module`, url).toString()
      const viteRes = await fetch(viteUrl)
      const viteCode = await viteRes.text()
      scriptCache[viteUrl] = viteCode
      console.info(`preloadWorkerScript: also cached Vite URL ${viteUrl}`)
    } catch (e) {
      console.warn(`preloadWorkerScript: failed to cache Vite URL variant for ${url}`, e)
    }
  }
}
*/

window.populateCache = async () => {
  // 1) Compute the exact worker URL
  const workerUrl = new URL('../node_modules/.vite/deps/browser-wasm-executor.js?worker_file&type=module', import.meta.url).toString()

  // 2) Preload it into the patchAllWorkers cache
  await window.preloadWorkerScript(workerUrl)
  //await window.preloadWorkerScript(WorkerFactory);
}

// Preserve the native Worker constructor
const NativeWorker = globalThis.Worker
// Counter for assigning unique IDs to workers
let globalWorkerId = 1
;(globalThis as any).Worker = class PatchedWorker extends NativeWorker {
  private __workerId: number

  constructor(scriptURL: string | URL, options?: WorkerOptions) {
    // Avoid breaking any other workers
    // if it's a URL (i.e. not a string) OR if it's the raw browser-wasm-executor path, just bail out to native:
    if (!scriptURL.toString().includes('browser-wasm-executor')) {
      console.log('PatchedWorker: not patching', scriptURL, scriptURL.toString(), options)
      super(scriptURL, options)
      return
    }
    // Assign a unique ID
    const workerId = globalWorkerId++
    console.info(`PatchedWorker: spawning worker #${workerId}`, scriptURL, options)

    // Create a patched blob URL for the worker code
    const blobUrl = createPatchedBlobURL(scriptURL.toString())
    super(blobUrl, options)
    this.__workerId = workerId

    /*
    // main-thread handlers for any uncaught or message errors
    this.onerror = (event: ErrorEvent) => {
      console.error(
        `Worker#${workerId} uncaught error:\n`,
        ` message:    ${event.message}\n`,
        ` filename:   ${event.filename}\n`,
        ` lineno:     ${event.lineno}\n`,
        ` colno:      ${event.colno}\n`,
        ' error obj:  ',
        event.error,
      )
    }
    this.onmessageerror = (e) => console.error(`Worker#${workerId} message error:`, e)
    */

    // Relay console messages from this worker to window with workerId tag
    this.addEventListener('message', (e: MessageEvent) => {
      const data = e.data
      if (data && data.type === 'console') {
        window.postMessage({ ...data, workerId }, '*')
      }
    })
  }
}

/**
 * Builds a blob URL embedding console patches and either inlining a cached script
 * or dynamically importing the real worker module.
 */
function createPatchedBlobURL(realScriptUrl: string): string {
  // Check for cached source
  const executorCode = scriptCache[realScriptUrl] || null

  if (executorCode) {
    console.info(`PatchedWorker: using CACHED script for ${realScriptUrl}`)
  } else {
    console.info(`PatchedWorker: using DYNAMIC import for ${realScriptUrl}`)

    //return realScriptUrl;
  }

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

  // Force module workers
  const loaderBody = `
      ${consolePatch}
      (async () => {
        // Load the real worker module
        await import(${JSON.stringify(String(realScriptUrl))});
	// TODO: do we need to export any functions?
        //debugger;
      })();
    `

  const cachedBody = `
      ${consolePatch}
      \n\n
      ${executorCode}
    `

  // build a tiny blob that first runs console-patch, then loads the real script
  //const blob = new Blob([executorCode ? cachedBody : loaderBody], { type: 'text/javascript' })
  const blob = new Blob([cachedBody], { type: 'text/javascript' })

  return URL.createObjectURL(blob)
}

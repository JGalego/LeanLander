const root = document.getElementById('root')
const pending = new Map()
const storage = new Map()
let nextRequestId = 1
let infoviewApi = null

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(String(key)) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
    get length() { return storage.size },
    removeItem: (key) => storage.delete(String(key)),
    setItem: (key, value) => storage.set(String(key), String(value)),
  },
})

function callEditor(method, args) {
  const transferableArgs = method === 'sendClientRequest'
    ? args.slice(0, 3)
    : args
  const id = nextRequestId++
  parent.postMessage({
    source: 'leanlander-infoview',
    type: 'request',
    id,
    method,
    args: transferableArgs,
  }, '*')
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

const editorApi = new Proxy({}, {
  get(_target, method) {
    return (...args) => callEditor(String(method), args)
  },
})

window.addEventListener('message', async (event) => {
  const message = event.data
  if (event.source !== parent || message?.source !== 'leanlander-host') return

  if (message.type === 'response') {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error))
    else request.resolve(message.result)
    return
  }

  if (message.type === 'event' && infoviewApi) {
    await infoviewApi[message.method](...message.args)
    return
  }

  if (message.type !== 'initialize') return
  if (infoviewApi) return
  const style = document.createElement('style')
  style.textContent = message.modules.css
  document.head.append(style)

  const moduleUrl = (source) => URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const imports = {
    '@leanprover/infoview': moduleUrl(message.modules.infoview),
    react: moduleUrl(message.modules.react),
    'react/jsx-runtime': moduleUrl(message.modules.jsxRuntime),
    'react-dom': moduleUrl(message.modules.reactDom),
  }
  const loader = await import(moduleUrl(message.modules.loader))
  loader.loadRenderInfoview(imports, [editorApi, root], (api) => {
    infoviewApi = api
    parent.postMessage({ source: 'leanlander-infoview', type: 'ready' }, '*')
  })
})

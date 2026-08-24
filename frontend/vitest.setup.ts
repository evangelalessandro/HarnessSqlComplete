// Polyfill minimi per far girare Monaco (editor reale) nei test jsdom
if (typeof document !== 'undefined') {
  // jsdom non implementa le API clipboard/queryCommand usate da Monaco all'import
  const d = document as unknown as Record<string, unknown>
  if (typeof d.queryCommandSupported !== 'function') {
    d.queryCommandSupported = () => false
  }
  if (typeof d.queryCommandState !== 'function') {
    d.queryCommandState = () => false
  }
  if (typeof d.queryCommandValue !== 'function') {
    d.queryCommandValue = () => ''
  }
  if (typeof d.execCommand !== 'function') {
    d.execCommand = () => false
  }
}

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// localStorage in-memory per i test della cronologia utente (environment node)
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  const localStorageMock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = localStorageMock
}

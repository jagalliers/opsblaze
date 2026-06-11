/**
 * Shared vitest setup.
 *
 * Node >= 25 ships an experimental WebStorage `localStorage` global that
 * evaluates to `undefined` unless Node is started with --localstorage-file.
 * Because the property already exists on `globalThis`, the jsdom test
 * environment does not install its own implementation on top of it, leaving
 * `localStorage` undefined in DOM tests. Install an in-memory implementation
 * when that happens so the test signal matches Node 20/22/24.
 */

if (typeof window !== "undefined" && globalThis.localStorage === undefined) {
  const store = new Map<string, string>();

  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(String(key)) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(String(key)),
    setItem: (key: string, value: string) => void store.set(String(key), String(value)),
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

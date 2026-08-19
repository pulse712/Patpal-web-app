// When a new deploy ships while a tab is already open, that tab's loaded JS
// still references the OLD deployment's content-hashed chunk filenames.
// Vercel only serves the current deployment's /assets, so a later dynamic
// import() for a route the user hasn't visited yet 404s — surfacing as
// "Failed to fetch dynamically imported module" (or Vite's own
// `vite:preloadError` event). The fix is simply a fresh page load, which
// fetches the current entry and resolves the new hashes. Guarded with
// sessionStorage so a genuinely broken deploy doesn't reload in a loop.

const RELOAD_GUARD_KEY = "chunk-reload-attempted";
const GUARD_RESET_MS = 10_000;

const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|cannot read properties of undefined \(reading ['"]component['"]\)|loading css chunk|loading chunk \d+ failed|chunkloaderror/i;

export function isChunkLoadError(error: unknown): boolean {
  // React can wrap the real failure (e.g. its concurrent-render recovery,
  // "error #520", after a first attempt at rendering a lazy chunk fails and
  // it retries synchronously) in a new Error with the original one attached
  // as `.cause` instead of surfacing our message directly — check the whole
  // cause chain, not just the outermost error.
  let current: unknown = error;
  for (let i = 0; i < 5 && current != null; i++) {
    const message = current instanceof Error ? current.message : String(current);
    if (CHUNK_ERROR_PATTERN.test(message)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/** Reloads once per problem window; returns false (does nothing) if already tried recently. */
export function reloadForStaleChunkOnce(): boolean {
  if (typeof window === "undefined") return false;
  if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return false;
  sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  // A plain reload() can reuse a cached HTML shell that still points at the
  // old hashed chunks. Bust the URL so the browser fetches the current deploy.
  const url = new URL(window.location.href);
  url.searchParams.set("_r", Date.now().toString());
  window.location.replace(`${url.pathname}${url.search}${url.hash}`);
  return true;
}

/** Call once the app is confirmed running fine, so a future deploy still gets one fresh-reload attempt. */
export function clearStaleChunkGuardAfterDelay(): () => void {
  if (typeof window === "undefined") return () => {};
  const url = new URL(window.location.href);
  if (url.searchParams.has("_r")) {
    url.searchParams.delete("_r");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  const timer = window.setTimeout(() => {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  }, GUARD_RESET_MS);
  return () => window.clearTimeout(timer);
}

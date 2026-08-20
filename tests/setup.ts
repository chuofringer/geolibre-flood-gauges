// jsdom does not implement window.matchMedia, which uPlot uses to track
// devicePixelRatio changes. Polyfill a minimal stub for suites that mount
// a real Hydrograph/uPlot instance (jsdom environment only).
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

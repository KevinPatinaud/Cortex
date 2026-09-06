const INDEX_KEY = "cortexNavigationIndex";

export function getNavigationIndex(): number | null {
  const index: unknown = window.history.state?.[INDEX_KEY];
  return typeof index === "number" && Number.isFinite(index) ? index : null;
}

export function initializeNavigation(): void {
  if (getNavigationIndex() === null) {
    window.history.replaceState({ ...window.history.state, [INDEX_KEY]: 0 }, "");
  }
}

export function updateBrowserUrl(url: URL, replace = false): void {
  initializeNavigation();
  const index = getNavigationIndex()! + (replace ? 0 : 1);
  window.history[replace ? "replaceState" : "pushState"](
    { ...window.history.state, [INDEX_KEY]: index }, "", url
  );
}

/** Map-visible load/retry chrome. Ports flood.live StatusBar behavior
 * (last-updated, spinner, NOAA-fail + retry) into the plugin's .fg- DOM.
 * Not a second data pipeline — the layer manager still owns the fetch.
 */

export type LoadState = "loading" | "ok" | "error";

export interface StatusChipView {
  state: LoadState;
  hasData: boolean;
  lastOkAt: number | null;
  onRetry: () => void;
}

export class StatusChip {
  private root: HTMLDivElement | null = null;

  mount(): void {
    if (this.root || typeof document === "undefined") return;
    const el = document.createElement("div");
    el.className = "fg-status";
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    this.root = el;
  }

  render(view: StatusChipView): void {
    if (!this.root) this.mount();
    const el = this.root;
    if (!el) return;
    el.replaceChildren();

    if (view.state === "loading") {
      el.dataset.state = "loading";
      const spin = document.createElement("span");
      spin.className = "fg-status-spinner";
      spin.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = view.hasData ? "Refreshing gauges…" : "Loading gauges…";
      el.append(spin, label);
      return;
    }

    if (view.state === "error") {
      el.dataset.state = "error";
      el.setAttribute("role", "alert");
      const label = document.createElement("span");
      label.textContent = view.hasData
        ? "Unable to reach NOAA. Showing last load."
        : "Unable to reach NOAA.";
      el.append(label, retryButton(view.onRetry));
      return;
    }

    el.removeAttribute("role");
    el.dataset.state = "ok";
    const time = document.createElement("span");
    time.className = "fg-status-time";
    time.textContent = formatClock(view.lastOkAt);
    el.append(time, retryButton(view.onRetry, "Refresh gauge data"));
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }
}

function retryButton(onRetry: () => void, label = "Retry"): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fg-status-retry";
  btn.textContent = label === "Retry" ? "Retry" : "↻";
  btn.setAttribute("aria-label", label);
  btn.addEventListener("click", onRetry);
  return btn;
}

function formatClock(at: number | null): string {
  if (at == null) return "--:--";
  return new Date(at).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Map-visible load/retry chrome. Ports the flood.live StatusBar *states*
 * that matter here (spinner, NOAA-fail + retry) — not the permanent clock.
 * Hidden when NOAA is healthy so it does not sit on GeoLibre's viewport
 * (or linger after the user hides the layer). Not a second data pipeline.
 */

export type LoadState = "loading" | "ok" | "error";

export interface StatusChipView {
  state: LoadState;
  hasData: boolean;
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
    if (view.state === "ok") {
      this.unmount();
      return;
    }
    if (!this.root) this.mount();
    const el = this.root;
    if (!el) return;
    el.replaceChildren();

    if (view.state === "loading") {
      el.dataset.state = "loading";
      el.removeAttribute("role");
      const spin = document.createElement("span");
      spin.className = "fg-status-spinner";
      spin.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = view.hasData ? "Refreshing gauges…" : "Loading gauges…";
      el.append(spin, label);
      return;
    }

    el.dataset.state = "error";
    el.setAttribute("role", "alert");
    const label = document.createElement("span");
    label.textContent = view.hasData
      ? "Unable to reach NOAA. Showing last load."
      : "Unable to reach NOAA.";
    el.append(label, retryButton(view.onRetry));
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
  }
}

function retryButton(onRetry: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fg-status-retry";
  btn.textContent = "Retry";
  btn.setAttribute("aria-label", "Retry");
  btn.addEventListener("click", onRetry);
  return btn;
}

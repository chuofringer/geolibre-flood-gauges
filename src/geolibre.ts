import "./styles/plugin.css";
import { GaugeLayerManager } from "./layer";
import { registerPanel, openGaugePanel, openGaugeNotFound, PANEL_ID } from "./panel/gaugePanel";
import { handleDeepLink, DEEP_LINK_PARAM } from "./deepLink";
import { parseProjectState, buildProjectState, type ProjectStateV1 } from "./projectState";
import type { GaugeFeature } from "./core/types";
import type { GeoLibreAppAPI, GeoLibrePlugin } from "./host/geolibre-api";

const PLUGIN_ID = "geolibre-flood-gauges";
const PLUGIN_VERSION = "0.4.1"; // must equal geolibre-plugin/plugin.json and package.json

let manager: GaugeLayerManager | null = null;
let currentSelectedGauge: string | null = null;
let currentRefreshMinutes: number | null = null;
/** applyProjectState arriving before activate (host contract, plan §3.5). */
let pendingState: ProjectStateV1 | null = null;

function openAndTrack(app: GeoLibreAppAPI, feature: GaugeFeature): void {
  currentSelectedGauge = feature.properties.gaugelid;
  openGaugePanel(app, feature.properties);
}

function applyState(app: GeoLibreAppAPI, state: ProjectStateV1): void {
  if (state.refreshMinutes) {
    currentRefreshMinutes = state.refreshMinutes;
    manager?.setRefreshIntervalMinutes(state.refreshMinutes);
  }
  if (state.selectedGauge && manager) {
    const lid = state.selectedGauge;
    void manager.findGauge(lid).then((feature) => {
      if (feature) openAndTrack(app, feature);
    });
  }
}

export const plugin: GeoLibrePlugin = {
  id: PLUGIN_ID,
  name: "US Live Flood Gauges",
  version: PLUGIN_VERSION,
  urlParameterNames: [DEEP_LINK_PARAM],

  activate(app) {
    manager = new GaugeLayerManager(app, (properties) => {
      currentSelectedGauge = properties.gaugelid;
      openGaugePanel(app, properties);
    });
    // Fire-and-forget: a failed first fetch logs, keeps the interval, and
    // surfaces retry on the map chip — never an unhandled rejection.
    void manager.start();
    registerPanel(app);

    // T4 test hook (plan §5): lets the Playwright e2e suite force an
    // immediate refresh cycle via `manager.refreshNow()` without waiting
    // out the 30-min interval. Harmless in production — just a window
    // global exposing the same manager the plugin already owns.
    if (typeof window !== "undefined") {
      (window as unknown as { __floodGaugesManager?: GaugeLayerManager }).__floodGaugesManager = manager;
    }

    if (currentRefreshMinutes) manager.setRefreshIntervalMinutes(currentRefreshMinutes);

    if (pendingState) {
      const state = pendingState;
      pendingState = null;
      void manager.ready.then(() => applyState(app, state));
    }
  },

  deactivate(app) {
    manager?.stop();
    manager = null;
    if (typeof window !== "undefined") {
      delete (window as unknown as { __floodGaugesManager?: GaugeLayerManager }).__floodGaugesManager;
    }
    app.unregisterFloatingPanel?.(PANEL_ID);
  },

  async handleUrlParameters(app, params) {
    if (!manager) return;
    await handleDeepLink(app, params, manager, openAndTrack, openGaugeNotFound);
  },

  getProjectState() {
    return buildProjectState(currentSelectedGauge, currentRefreshMinutes);
  },

  applyProjectState(app, raw) {
    const state = parseProjectState(raw);
    if (!state) return; // untrusted/garbage payload — ignore, keep defaults

    if (manager) {
      // Host applies state to an already-active plugin without
      // re-activating it (plan §3.5) — act immediately.
      applyState(app, state);
    } else {
      // Inactive plugin: cache it, `activate` will apply it once the
      // layer manager exists and its initial fetch has resolved.
      pendingState = state;
    }
  },
};

export default plugin;

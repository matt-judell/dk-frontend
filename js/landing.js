// Landing page: a deck.gl IconLayer over a MapLibre basemap showing the newest
// filing per CVR. Clicking a marker navigates to that CVR's detail page.

import {
  loadRows,
  latestPerCvrWithLocation,
  formatAddress,
  formatNumber,
} from "./data.js";

const { DeckGL, IconLayer } = deck;

// A teardrop pin, inlined as an SVG data URL so there are no extra assets to
// host. `mask: false` tells deck.gl to render the SVG's own colors.
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
    fill="#4f8cff" stroke="#0b1220" stroke-width="1"/>
  <circle cx="12" cy="9" r="2.6" fill="#ffffff"/>
</svg>`;
const ICON_URL =
  "data:image/svg+xml;charset=utf-8," + encodeURIComponent(PIN_SVG);

// Centered on Denmark.
const INITIAL_VIEW_STATE = {
  longitude: 10.4,
  latitude: 56.0,
  zoom: 6,
  pitch: 0,
  bearing: 0,
};

const statusEl = document.getElementById("status");

function setStatus(html) {
  statusEl.innerHTML = html;
}

function setError(message) {
  statusEl.innerHTML = `<span style="color:#dc2626">⚠ ${message}</span>`;
}

async function main() {
  // Render the basemap immediately so the page feels responsive while the
  // parquet file downloads and parses.
  const deckgl = new DeckGL({
    container: "map",
    mapStyle:
      "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    initialViewState: INITIAL_VIEW_STATE,
    controller: true,
    layers: [],
    getTooltip: ({ object }) => {
      if (!object) return null;
      const address = formatAddress(object);
      const employees =
        object.employees !== null
          ? `Employees: ${formatNumber(object.employees)}`
          : "";
      return {
        html: `<div style="font-weight:600">${escapeHtml(
          object.name || "Unknown"
        )}</div>
          <div>CVR ${object.cvr}</div>
          ${address ? `<div>${escapeHtml(address)}</div>` : ""}
          ${employees ? `<div>${employees}</div>` : ""}
          <div style="opacity:.7;margin-top:4px">Click for details →</div>`,
        style: {
          background: "#0f172a",
          color: "#fff",
          fontSize: "12px",
          padding: "8px 10px",
          borderRadius: "8px",
          maxWidth: "220px",
        },
      };
    },
  });

  let rows;
  try {
    rows = await loadRows();
  } catch (err) {
    console.error(err);
    setError(`Failed to load data: ${err.message}`);
    return;
  }

  const points = latestPerCvrWithLocation(rows);

  const layer = new IconLayer({
    id: "entities",
    data: points,
    pickable: true,
    getPosition: (d) => [d.longitude, d.latitude],
    getIcon: () => ({
      url: ICON_URL,
      width: 48,
      height: 48,
      anchorY: 48,
      mask: false,
    }),
    getSize: 34,
    sizeUnits: "pixels",
    sizeMinPixels: 12,
    onClick: (info) => {
      if (info.object) {
        window.location.href = `detail.html?cvr=${info.object.cvr}`;
      }
    },
  });

  deckgl.setProps({
    layers: [layer],
    getCursor: ({ isHovering }) => (isHovering ? "pointer" : "grab"),
  });

  setStatus(
    `<span class="count">${formatNumber(points.length)}</span>&nbsp;entities · newest filing per CVR`
  );
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );
}

main();

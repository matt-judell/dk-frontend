// Landing page: a deck.gl IconLayer over a MapLibre basemap showing the newest
// filing per CVR. Includes search (name/location) and range filters (price,
// employees). Clicking a marker navigates to that CVR's detail page.

import {
  loadRows,
  latestPerCvrWithLocation,
  formatAddress,
  formatNumber,
  formatCurrency,
} from "./data.js";

const { DeckGL, IconLayer, WebMercatorViewport, FlyToInterpolator } = deck;

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

// Module-level state.
let deckgl;
let viewState = INITIAL_VIEW_STATE;
let allPoints = []; // newest filing per CVR, with coordinates
let filtered = [];
let tableVisible = false;
let sortKey = "price";
let sortDir = "desc";

// Cap DOM rows so a huge unfiltered result set doesn't freeze the page.
const MAX_TABLE_ROWS = 1000;

// Street address without the city (city gets its own column).
function addressText(p) {
  const street = [p.streetName, p.houseNumber].filter(Boolean).join(" ");
  return [street, p.postalCode].filter(Boolean).join(", ");
}

function cityText(p) {
  return p.city || p.postalDistrict || "";
}

// Column definitions: `get` returns the raw value (for sorting), `render`
// returns the display cell HTML. `numeric` columns sort numerically.
const TABLE_COLUMNS = [
  {
    key: "name",
    label: "Name",
    get: (p) => p.name || "",
    render: (p) => escapeHtml(p.name || "Unknown"),
  },
  {
    key: "cvr",
    label: "CVR",
    numeric: true,
    get: (p) => p.cvr,
    render: (p) => p.cvr,
  },
  {
    key: "address",
    label: "Address",
    get: (p) => addressText(p),
    render: (p) => (addressText(p) ? escapeHtml(addressText(p)) : "—"),
  },
  {
    key: "city",
    label: "City",
    get: (p) => cityText(p),
    render: (p) => (cityText(p) ? escapeHtml(cityText(p)) : "—"),
  },
  {
    key: "employees",
    label: "Employees",
    numeric: true,
    get: (p) => p.employees,
    render: (p) => (p.employees !== null ? formatNumber(p.employees) : "—"),
  },
  {
    key: "price",
    label: "Price",
    numeric: true,
    get: (p) => p.price,
    render: (p) => (p.price !== null ? formatCurrency(p.price) : "—"),
  },
];

// ---------------------------------------------------------------------------
// View-state control (needed so we can programmatically fly/fit the camera)
// ---------------------------------------------------------------------------

function setViewState(next) {
  viewState = next;
  deckgl.setProps({ viewState });
}

function fitToPoints(points) {
  if (!points.length) return;
  const mapEl = document.getElementById("map");
  const width = mapEl.clientWidth || window.innerWidth;
  const height = mapEl.clientHeight || window.innerHeight;

  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const p of points) {
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
  }

  let target;
  if (minLng === maxLng && minLat === maxLat) {
    // Single point: just center on it at a reasonable zoom.
    target = { longitude: minLng, latitude: minLat, zoom: 13 };
  } else {
    const vp = new WebMercatorViewport({ width, height });
    const { longitude, latitude, zoom } = vp.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 60 }
    );
    target = { longitude, latitude, zoom: Math.min(zoom, 15) };
  }

  setViewState({
    ...viewState,
    ...target,
    transitionDuration: 800,
    transitionInterpolator: new FlyToInterpolator(),
  });
}

// ---------------------------------------------------------------------------
// Layer + status rendering
// ---------------------------------------------------------------------------

function buildLayer(data) {
  return new IconLayer({
    id: "entities",
    data,
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
}

function updateLayer() {
  deckgl.setProps({ layers: [buildLayer(filtered)] });
}

function updateStatus() {
  if (filtered.length === allPoints.length) {
    statusEl.innerHTML = `<span class="count">${formatNumber(
      allPoints.length
    )}</span>&nbsp;entities · newest filing per CVR`;
  } else {
    statusEl.innerHTML = `<span class="count">${formatNumber(
      filtered.length
    )}</span>&nbsp;of ${formatNumber(allPoints.length)} entities match`;
  }
}

function setError(message) {
  statusEl.innerHTML = `<span style="color:#f87171">⚠ ${message}</span>`;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

// Accepts plain numbers, thousands separators, and shorthand suffixes so users
// can type values like "20M", "1.5b", or "500k" (price values reach billions).
function parseNum(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim().toLowerCase().replace(/[,_\s]/g, "");
  if (!s) return null;

  const m = s.match(/^(-?\d*\.?\d+)([kmbt])?$/);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]] ?? 1;
  return num * mult;
}

const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompact(v) {
  if (v === null || v === undefined) return "—";
  return compactFmt.format(v);
}

// Populate the range hints under the price / employees fields once data is in.
function updateHints() {
  setRangeHint("price-hint", allPoints, (p) => p.price, {
    example: "e.g. 20M",
  });
  setRangeHint("emp-hint", allPoints, (p) => p.employees, { example: "" });
}

function setRangeHint(id, points, accessor, { example }) {
  const el = document.getElementById(id);
  if (!el) return;
  const values = points
    .map(accessor)
    .filter((v) => v !== null && v !== undefined)
    .sort((a, b) => a - b);
  if (!values.length) {
    el.textContent = "";
    return;
  }
  const median = values[Math.floor(values.length / 2)];
  const range = `Range ${formatCompact(values[0])} – ${formatCompact(
    values[values.length - 1]
  )} · median ${formatCompact(median)}`;
  el.textContent = example ? `${range} · ${example}` : range;
}

function getControls() {
  return {
    q: document.getElementById("search").value.trim().toLowerCase(),
    priceMin: parseNum(document.getElementById("price-min").value),
    priceMax: parseNum(document.getElementById("price-max").value),
    empMin: parseNum(document.getElementById("emp-min").value),
    empMax: parseNum(document.getElementById("emp-max").value),
  };
}

function matchesSearch(point, q) {
  if (!q) return true;
  const haystack = [
    point.name,
    point.city,
    point.postalDistrict,
    point.streetName,
    point.postalCode,
  ]
    .filter((v) => v !== null && v !== undefined)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function applyFilters() {
  const { q, priceMin, priceMax, empMin, empMax } = getControls();

  filtered = allPoints.filter((p) => {
    if (!matchesSearch(p, q)) return false;

    // Numeric range filters. A row with a null value can't satisfy an active
    // bound, so it's excluded when that bound is set.
    if (priceMin !== null && (p.price === null || p.price < priceMin)) return false;
    if (priceMax !== null && (p.price === null || p.price > priceMax)) return false;
    if (empMin !== null && (p.employees === null || p.employees < empMin)) return false;
    if (empMax !== null && (p.employees === null || p.employees > empMax)) return false;

    return true;
  });

  updateLayer();
  updateStatus();
  if (tableVisible) renderTable();
}

let debounceTimer = null;
function scheduleFilter() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 150);
}

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------

function compareBy(col, dir) {
  const s = dir === "asc" ? 1 : -1;
  return (a, b) => {
    const va = col.get(a);
    const vb = col.get(b);
    const na = va === null || va === undefined || va === "";
    const nb = vb === null || vb === undefined || vb === "";
    if (na && nb) return 0;
    if (na) return 1; // missing values always sort last
    if (nb) return -1;
    if (col.numeric) return (va - vb) * s;
    return String(va).localeCompare(String(vb)) * s;
  };
}

function renderHeader() {
  document.getElementById("table-head").innerHTML = `<tr>${TABLE_COLUMNS.map(
    (col) => {
      const active = col.key === sortKey;
      const indicator = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
      return `<th data-key="${col.key}" class="sortable${
        active ? " active" : ""
      }">${col.label}${indicator}</th>`;
    }
  ).join("")}</tr>`;
}

function renderTable() {
  document.getElementById("table-count").textContent = formatNumber(
    filtered.length
  );

  renderHeader();

  const col = TABLE_COLUMNS.find((c) => c.key === sortKey) ?? TABLE_COLUMNS[0];
  const sorted = [...filtered].sort(compareBy(col, sortDir));
  const shown = sorted.slice(0, MAX_TABLE_ROWS);

  document.getElementById("table-body").innerHTML = shown
    .map(
      (p) =>
        `<tr data-cvr="${p.cvr}">${TABLE_COLUMNS.map(
          (c) => `<td>${c.render(p)}</td>`
        ).join("")}</tr>`
    )
    .join("");

  const note = document.getElementById("table-note");
  if (filtered.length > MAX_TABLE_ROWS) {
    note.textContent = `Showing ${formatNumber(
      MAX_TABLE_ROWS
    )} of ${formatNumber(
      filtered.length
    )} matches (current sort). Refine the filters to narrow the list.`;
  } else {
    note.textContent = "";
  }
}

function showTable() {
  tableVisible = true;
  renderTable();
  document.getElementById("table-view").classList.remove("hidden");
}

function hideTable() {
  tableVisible = false;
  document.getElementById("table-view").classList.add("hidden");
}

function resetFilters() {
  for (const id of ["search", "price-min", "price-max", "emp-min", "emp-max"]) {
    document.getElementById(id).value = "";
  }
  applyFilters();
}

function wireControls() {
  for (const id of ["search", "price-min", "price-max", "emp-min", "emp-max"]) {
    document.getElementById(id).addEventListener("input", scheduleFilter);
  }
  document
    .getElementById("reset-filters")
    .addEventListener("click", resetFilters);
  document
    .getElementById("zoom-matches")
    .addEventListener("click", () => fitToPoints(filtered));

  document.getElementById("view-table").addEventListener("click", showTable);
  document.getElementById("close-table").addEventListener("click", hideTable);

  // Row click -> detail page (event delegation).
  document.getElementById("table-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-cvr]");
    if (tr) window.location.href = `detail.html?cvr=${tr.dataset.cvr}`;
  });

  // Header click -> sort (toggle direction when re-clicking the same column).
  document.getElementById("table-head").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-key]");
    if (!th) return;
    const key = th.dataset.key;
    if (key === sortKey) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir = "asc";
    }
    renderTable();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  // Render the basemap immediately so the page feels responsive while the
  // parquet file downloads and parses.
  deckgl = new DeckGL({
    container: "map",
    mapStyle: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    initialViewState: INITIAL_VIEW_STATE,
    controller: true,
    // Controlled view state so we can fly/fit the camera programmatically.
    viewState,
    onViewStateChange: ({ viewState: vs }) => {
      viewState = vs;
      deckgl.setProps({ viewState: vs });
    },
    layers: [],
    getCursor: ({ isHovering }) => (isHovering ? "pointer" : "grab"),
    getTooltip: ({ object }) => {
      if (!object) return null;
      const address = formatAddress(object);
      const employees =
        object.employees !== null
          ? `Employees: ${formatNumber(object.employees)}`
          : "";
      const price =
        object.price !== null ? `Price: ${formatCurrency(object.price)}` : "";
      return {
        html: `<div style="font-weight:600">${escapeHtml(
          object.name || "Unknown"
        )}</div>
          <div>CVR ${object.cvr}</div>
          ${address ? `<div>${escapeHtml(address)}</div>` : ""}
          ${employees ? `<div>${employees}</div>` : ""}
          ${price ? `<div>${price}</div>` : ""}
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

  wireControls();

  let rows;
  try {
    rows = await loadRows();
  } catch (err) {
    console.error(err);
    setError(`Failed to load data: ${err.message}`);
    return;
  }

  allPoints = latestPerCvrWithLocation(rows);
  filtered = allPoints;
  updateHints();
  updateLayer();
  updateStatus();
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

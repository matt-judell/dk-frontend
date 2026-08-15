// Shared data-access layer.
//
// Loads the whole parquet file (~11 MB) in the browser using hyparquet, with
// hyparquet-compressors so every parquet compression codec is supported
// (Polars writes zstd by default). The parsed + normalized rows are cached in
// module scope so navigating between pages within the same tab is cheap, and
// the browser's HTTP cache keeps the raw file around across page loads.

import { parquetReadObjects } from "https://esm.sh/hyparquet@1.28.2";
import { compressors } from "https://esm.sh/hyparquet-compressors@1.1.1";

// Resolve the data file relative to this module so it works both locally and
// when served from a GitHub Pages project sub-path (e.g. /dk-frontend/).
export const DATA_URL = new URL("../data/fundamental_data.pq", import.meta.url)
  .href;

let rowsPromise = null;

/**
 * Load and normalize every row in the parquet file. Cached after first call.
 * @returns {Promise<Array<object>>}
 */
export function loadRows() {
  if (!rowsPromise) {
    rowsPromise = fetchAndParse().catch((err) => {
      // Reset so a later retry can attempt the fetch again.
      rowsPromise = null;
      throw err;
    });
  }
  return rowsPromise;
}

async function fetchAndParse() {
  const resp = await fetch(DATA_URL);
  if (!resp.ok) {
    throw new Error(`Could not fetch data file (${resp.status} ${resp.statusText})`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const rows = await parquetReadObjects({ file: arrayBuffer, compressors });
  return rows.map(normalizeRow);
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Parquet DATE columns may surface as a JS Date, a day-count integer, or a
 * millisecond timestamp depending on reader/version. Normalize to both a
 * sortable epoch-ms value and an ISO `YYYY-MM-DD` string.
 */
function toDate(v) {
  if (v === null || v === undefined) return { ms: null, iso: null };
  let date;
  if (v instanceof Date) {
    date = v;
  } else if (typeof v === "bigint" || typeof v === "number") {
    const n = Number(v);
    // Small magnitudes are day counts since the Unix epoch; larger values are
    // already millisecond timestamps.
    date = Math.abs(n) < 1e7 ? new Date(n * 86400000) : new Date(n);
  } else {
    date = new Date(String(v));
  }
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return { ms: null, iso: toText(v) };
  return { ms, iso: date.toISOString().slice(0, 10) };
}

function normalizeRow(r) {
  const filing = toDate(r.filing_date);
  return {
    cvr: toNumber(r.cvr),
    filingDate: filing.iso,
    filingDateMs: filing.ms,
    filingUrl: toText(r.filing_url),
    filename: toText(r.filename),
    name: toText(r.name),
    employees: toNumber(r.employees),
    houseNumber: toNumber(r.house_number),
    streetName: toText(r.street_name),
    city: toText(r.city),
    postalDistrict: toText(r.postal_district),
    postalCode: toNumber(r.postal_code),
    addressId: toText(r.addressId),
    netIncome: toNumber(r.net_income),
    assets: toNumber(r.assets),
    debt: toNumber(r.debt),
    cash: toNumber(r.cash),
    longitude: toNumber(r.longitude),
    latitude: toNumber(r.latitude),
    price: toNumber(r.price),
    multiple: toNumber(r.multiple),
  };
}

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------

/**
 * One row per CVR: the newest filing (by filing_date) that has usable
 * coordinates. Used for the landing-page map.
 */
export function latestPerCvrWithLocation(rows) {
  const byCvr = new Map();
  for (const row of rows) {
    if (row.cvr === null) continue;
    if (row.longitude === null || row.latitude === null) continue;
    // Guard against obviously invalid coordinates.
    if (Math.abs(row.latitude) > 90 || Math.abs(row.longitude) > 180) continue;
    const prev = byCvr.get(row.cvr);
    const prevMs = prev ? prev.filingDateMs ?? -Infinity : -Infinity;
    const curMs = row.filingDateMs ?? -Infinity;
    if (!prev || curMs >= prevMs) byCvr.set(row.cvr, row);
  }
  return [...byCvr.values()];
}

/**
 * All filings for a single CVR, sorted oldest -> newest.
 */
export function filingsForCvr(rows, cvr) {
  const target = Number(cvr);
  return rows
    .filter((r) => r.cvr === target)
    .sort((a, b) => (a.filingDateMs ?? 0) - (b.filingDateMs ?? 0));
}

// ---------------------------------------------------------------------------
// Formatting helpers (shared by pages)
// ---------------------------------------------------------------------------

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatNumber(v) {
  if (v === null || v === undefined) return "—";
  return numberFmt.format(v);
}

export function formatCurrency(v) {
  if (v === null || v === undefined) return "—";
  return numberFmt.format(Math.round(v));
}

export function formatAddress(row) {
  const line1 = [row.streetName, row.houseNumber].filter(Boolean).join(" ");
  const line2 = [row.postalCode, row.city || row.postalDistrict]
    .filter(Boolean)
    .join(" ");
  return [line1, line2].filter((s) => s && s.length).join(", ");
}

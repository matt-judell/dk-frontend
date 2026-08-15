// Detail page: a financial table + a price-over-time bar chart for a single CVR.

import {
  loadRows,
  filingsForCvr,
  formatCurrency,
  formatNumber,
  formatAddress,
} from "./data.js";

const contentEl = document.getElementById("content");

function showMessage(text, isError = false) {
  contentEl.innerHTML = `<div class="message${isError ? " error" : ""}">${text}</div>`;
}

function numberCell(value, { currency = true } = {}) {
  if (value === null || value === undefined) return "<td>—</td>";
  const text = currency ? formatCurrency(value) : formatNumber(value);
  const cls = value < 0 ? ' class="neg"' : "";
  return `<td${cls}>${text}</td>`;
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const cvrParam = params.get("cvr");

  if (!cvrParam || Number.isNaN(Number(cvrParam))) {
    showMessage("No valid CVR specified.", true);
    return;
  }
  const cvr = Number(cvrParam);

  let rows;
  try {
    rows = await loadRows();
  } catch (err) {
    console.error(err);
    showMessage(`Failed to load data: ${escapeHtml(err.message)}`, true);
    return;
  }

  const filings = filingsForCvr(rows, cvr);
  if (filings.length === 0) {
    showMessage(`No filings found for CVR ${escapeHtml(cvrParam)}.`, true);
    return;
  }

  render(cvr, filings);
}

function render(cvr, filings) {
  const latest = filings[filings.length - 1];
  const address = formatAddress(latest);

  document.title = `${latest.name || "CVR " + cvr} · Denmark Explorer`;

  const badges = [
    latest.employees !== null
      ? `<span class="badge">Employees <strong>${formatNumber(
          latest.employees
        )}</strong></span>`
      : "",
    latest.filingUrl
      ? `<span class="badge"><a href="${encodeURI(
          latest.filingUrl
        )}" target="_blank" rel="noopener">Latest filing ↗</a></span>`
      : "",
    `<span class="badge">Filings <strong>${filings.length}</strong></span>`,
  ]
    .filter(Boolean)
    .join("");

  // Table rows: newest first for readability.
  const tableRows = [...filings]
    .reverse()
    .map(
      (f) => `<tr>
        <td>${f.filingDate ?? "—"}</td>
        ${numberCell(f.assets)}
        ${numberCell(f.debt)}
        ${numberCell(f.cash)}
        ${numberCell(f.netIncome)}
        ${numberCell(f.price)}
        ${numberCell(f.multiple, { currency: false })}
      </tr>`
    )
    .join("");

  contentEl.innerHTML = `
    <header class="entity-header">
      <h1>${escapeHtml(latest.name || "Unknown entity")}</h1>
      <div class="subtitle">
        CVR ${cvr}${address ? " · " + escapeHtml(address) : ""}
      </div>
    </header>

    <div class="badges">${badges}</div>

    <section class="card">
      <h2>Price over time</h2>
      <div class="chart-wrap"><canvas id="price-chart"></canvas></div>
    </section>

    <section class="card">
      <h2>Financial history</h2>
      <table>
        <thead>
          <tr>
            <th>Filing date</th>
            <th>Assets</th>
            <th>Debt</th>
            <th>Cash</th>
            <th>Net income</th>
            <th>Price</th>
            <th>Multiple</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p style="font-size:12px;color:var(--text-muted);margin:12px 0 0">
        Monetary values shown in the source units (DKK).
      </p>
    </section>
  `;

  renderChart(filings);
}

function renderChart(filings) {
  const labels = filings.map((f) => f.filingDate ?? "—");
  const data = filings.map((f) => f.price);

  const gridColor = "rgba(148, 163, 189, 0.15)";
  const tickColor = "#93a3bd";

  const ctx = document.getElementById("price-chart").getContext("2d");
  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Price",
          data,
          backgroundColor: "#4f8cff",
          hoverBackgroundColor: "#7aa9ff",
          borderRadius: 4,
          maxBarThickness: 60,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) =>
              item.raw === null || item.raw === undefined
                ? "No data"
                : `Price: ${formatCurrency(item.raw)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: tickColor },
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            callback: (value) => formatCurrency(value),
          },
        },
      },
    },
  });
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

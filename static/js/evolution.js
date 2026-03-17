/**
 * evolution.js — Graphiques Chart.js pour la page Evolution.
 * Choix : Chart.js (déjà chargé en CDN dans base.html) plutôt que Plotly
 *         pour alléger le bundle côté Flask (Plotly = 3.5 MB, Chart.js = 200 KB).
 */

(() => {
  "use strict";

  const META = window.APP_META;
  const COULEURS = {
    REF:   "#2e7d9e",
    GWL15: "#f0a500",
    GWL20: "#e07030",
    GWL30: "#c0392b",
  };
  const SCENARIOS_LABELS = {
    REF:   "Référence 1976-2005",
    GWL15: "+1.5°C — 2037-2056",
    GWL20: "+2°C — 2052-2071",
    GWL30: "+3°C — 2079-2098",
  };

  let allData  = null;
  let chartInst = null;

  // ── Chargement des données ──────────────────────────────────────────
  async function loadData() {
    const r = await fetch("/api/data");
    allData = await r.json();
    updateChart();
  }

  // ── Moyenne mobile ──────────────────────────────────────────────────
  function movingAverage(values, window = 5) {
    return values.map((_, i) => {
      const half = Math.floor(window / 2);
      const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1));
      return slice.reduce((s, v) => s + (v ?? 0), 0) / slice.filter(v => v != null).length;
    });
  }

  // ── Mise à jour des métriques ───────────────────────────────────────
  function updateMetrics(ind) {
    if (!allData) return;
    const mean = (niv) => {
      const vals = allData.filter(d => d.Niveau === niv).map(d => d[ind]).filter(v => v != null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    const ref = mean("REF");
    const fmt = v => v != null ? v.toFixed(1) : "—";

    document.getElementById("m-ref").textContent   = fmt(ref);
    document.getElementById("d-ref").textContent   = "moyenne période";

    ["GWL15", "GWL20", "GWL30"].forEach(niv => {
      const v  = mean(niv);
      const el = document.getElementById(`m-${niv.toLowerCase()}`);
      const de = document.getElementById(`d-${niv.toLowerCase()}`);
      el.textContent = fmt(v);
      if (v != null && ref != null) {
        const delta = v - ref;
        const sign  = delta > 0 ? "+" : "";
        de.textContent = `${sign}${delta.toFixed(2)} vs REF`;
        de.className = `metric-delta ${delta > 0 ? "delta-pos" : "delta-neg"}`;
      }
    });
  }

  // ── Construction du graphique ───────────────────────────────────────
  function updateChart() {
    if (!allData) return;

    const ind        = document.getElementById("sel-indicateur").value;
    const showTrend  = document.getElementById("chk-tendance").checked;
    const scenarios  = [...document.querySelectorAll("input[name=scenario]:checked")]
                       .map(el => el.value);

    updateMetrics(ind);

    const label = META.labels[ind] || ind;
    document.getElementById("chart-title").textContent = label;

    const datasets = [];

    scenarios.forEach(niv => {
      const subset = allData
        .filter(d => d.Niveau === niv)
        .sort((a, b) => a.Annee - b.Annee);

      if (!subset.length) return;

      const couleur = COULEURS[niv];

      // Série brute
      datasets.push({
        label:           SCENARIOS_LABELS[niv],
        data:            subset.map(d => ({ x: d.Annee, y: d[ind] })),
        borderColor:     couleur,
        backgroundColor: couleur + "22",
        borderWidth:     2,
        pointRadius:     3,
        pointHoverRadius: 6,
        tension:         0.2,
        fill:            false,
      });

      // Tendance lissée
      if (showTrend && subset.length >= 5) {
        const lissées = movingAverage(subset.map(d => d[ind]));
        datasets.push({
          label:       `${SCENARIOS_LABELS[niv]} (tendance)`,
          data:        subset.map((d, i) => ({ x: d.Annee, y: lissées[i] })),
          borderColor: couleur,
          borderWidth: 3,
          borderDash:  [6, 3],
          pointRadius: 0,
          tension:     0.3,
          fill:        false,
          showInLegend: false,
        });
      }
    });

    const ctx = document.getElementById("chart-evolution").getContext("2d");

    if (chartInst) {
      chartInst.data.datasets = datasets;
      chartInst.update("none");
      return;
    }

    chartInst = new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              font: { family: "'DM Sans', sans-serif", size: 11 },
              filter: item => !item.text.includes("(tendance)"),
              usePointStyle: true,
              pointStyleWidth: 14,
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (!ctx.parsed.y) return null;
                const unite = (label.match(/\(([^)]+)\)/) || [])[1] || "";
                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} ${unite}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "Année", font: { size: 11 } },
            grid: { color: "#e8edf0" },
          },
          y: {
            title: {
              display: true,
              text: (label.match(/\(([^)]+)\)/) || [])[1] || "",
              font: { size: 11 },
            },
            grid: { color: "#e8edf0" },
          },
        },
      },
    });
  }

  // ── Peuplement du select indicateur ────────────────────────────────
  function majSelectIndicateur() {
    const cat  = document.getElementById("sel-categorie").value;
    const sel  = document.getElementById("sel-indicateur");
    const inds = META.categories[cat] || [];
    sel.innerHTML = inds.map(ind =>
      `<option value="${ind}">${META.labels[ind] || ind}</option>`
    ).join("");
    updateChart();
  }

  // ── Événements ──────────────────────────────────────────────────────
  document.getElementById("sel-categorie").addEventListener("change", majSelectIndicateur);
  document.getElementById("sel-indicateur").addEventListener("change", updateChart);
  document.getElementById("chk-tendance").addEventListener("change", updateChart);
  document.querySelectorAll("input[name=scenario]").forEach(el =>
    el.addEventListener("change", updateChart)
  );

  // ── Init ────────────────────────────────────────────────────────────
  majSelectIndicateur();
  loadData();

})();

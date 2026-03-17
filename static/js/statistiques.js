/**
 * statistiques.js — Boxplots, histogrammes et tableau statistique.
 * Choix : Chart.js avec plugin chartjs-chart-box-and-violin-plot absent du CDN
 *         -> boxplot simulé via un dataset de type bar avec Q1/Q3/whiskers custom,
 *            dessiné manuellement sur un LineChart.
 *         Alternative simple retenue : représentation via violin-like overlay
 *         ou segment chart. On implémente un boxplot minimal via
 *         un plugin Chart.js inline (plus léger qu'une dépendance externe).
 */

(() => {
  "use strict";

  const META = window.APP_META;
  const COULEURS = {
    REF: "#2e7d9e",
    GWL15: "#f0a500",
    GWL20: "#e07030",
    GWL30: "#c0392b",
  };
  const LABELS = {
    REF: "Référence 1976-2005",
    GWL15: "+1.5°C — 2037-2056",
    GWL20: "+2°C — 2052-2071",
    GWL30: "+3°C — 2079-2098",
  };

  let allData = null;
  let charts = {};

  // ── Onglets ──────────────────────────────────────────────────────────
  document.querySelectorAll(".switch-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".switch-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      updateAll();
    });
  });

  // ── Statistiques descriptives ────────────────────────────────────────
  function calcStats(values) {
    const v = [...values].filter(x => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const n = v.length;
    const sum = v.reduce((s, x) => s + x, 0);
    const avg = sum / n;
    const std = Math.sqrt(v.reduce((s, x) => s + (x - avg) ** 2, 0) / n);
    const pct = p => v[Math.floor(p * (n - 1))];
    return {
      n,
      mean: avg,
      median: pct(0.5),
      std,
      min: v[0],
      max: v[n - 1],
      p10: pct(0.1),
      p25: pct(0.25),
      p75: pct(0.75),
      p90: pct(0.9),
    };
  }

  // ── Tableau stats ────────────────────────────────────────────────────
  function updateTable(ind, scenarios) {
    const tbody = document.getElementById("tbody-stats");
    tbody.innerHTML = "";
    scenarios.forEach(niv => {
      const vals = allData.filter(d => d.Niveau === niv).map(d => d[ind]);
      const s = calcStats(vals);
      if (!s) return;
      const fmt = v => v.toFixed(3);
      const coul = COULEURS[niv];
      tbody.insertAdjacentHTML("beforeend", `
        <tr>
          <td><span style="display:inline-block;width:10px;height:10px;background:${coul};border-radius:2px;margin-right:6px;"></span>${LABELS[niv]}</td>
          <td>${s.n}</td>
          <td>${fmt(s.mean)}</td>
          <td>${fmt(s.median)}</td>
          <td>${fmt(s.std)}</td>
          <td>${fmt(s.min)}</td>
          <td>${fmt(s.max)}</td>
          <td>${fmt(s.p10)}</td>
          <td>${fmt(s.p90)}</td>
        </tr>
      `);
    });
  }

  // ── Boxplot (simulé via barres + custom draw) ────────────────────────
  // Plugin inline : dessine les moustaches sur un bar chart vide
  const boxplotPlugin = {
    id: "boxplot",
    afterDatasetsDraw(chart) {
      const { ctx, data, scales } = chart;
      if (!chart._boxData) return;
      const xScale = scales.x;
      const yScale = scales.y;

      chart._boxData.forEach((s, i) => {
        if (!s) return;
        const barMeta = chart.getDatasetMeta(i);
        if (!barMeta.data[0]) return;
        const x = barMeta.data[0].x;
        const bw = 30;
        const couleur = chart._boxColors[i];

        ctx.strokeStyle = couleur;
        ctx.lineWidth = 2;
        ctx.fillStyle = couleur + "40";

        const yQ1 = yScale.getPixelForValue(s.p25);
        const yQ3 = yScale.getPixelForValue(s.p75);
        const yMed = yScale.getPixelForValue(s.median);
        const yMin = yScale.getPixelForValue(s.p10);
        const yMax = yScale.getPixelForValue(s.p90);

        // Boite Q1-Q3
        ctx.fillRect(x - bw / 2, yQ3, bw, yQ1 - yQ3);
        ctx.strokeRect(x - bw / 2, yQ3, bw, yQ1 - yQ3);

        // Médiane
        ctx.beginPath();
        ctx.moveTo(x - bw / 2, yMed);
        ctx.lineTo(x + bw / 2, yMed);
        ctx.lineWidth = 3;
        ctx.strokeStyle = couleur;
        ctx.stroke();
        ctx.lineWidth = 2;

        // Moustaches
        ctx.beginPath();
        ctx.moveTo(x, yQ1); ctx.lineTo(x, yMin);
        ctx.moveTo(x, yQ3); ctx.lineTo(x, yMax);
        ctx.stroke();

        // Caps
        [yMin, yMax].forEach(y => {
          ctx.beginPath();
          ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y);
          ctx.stroke();
        });
      });
    },
  };
  Chart.register(boxplotPlugin);

  function updateBoxplot(ind, scenarios) {
    // Enregistrer le plugin une seule fois
    if (!Chart.registry.plugins.get("boxplot")) {
      Chart.register(boxplotPlugin);
    }
    const statsArr = scenarios.map(niv => {
      const vals = allData.filter(d => d.Niveau === niv).map(d => d[ind]);
      return calcStats(vals);
    });

    const ctx = document.getElementById("chart-boxplot").getContext("2d");
    if (charts.boxplot) { charts.boxplot.destroy(); }

    charts.boxplot = new Chart(ctx, {
      type: "bar",
      data: {
        labels: scenarios.map(n => LABELS[n]),
        datasets: scenarios.map((niv, i) => ({
          label: LABELS[niv],
          data: [statsArr[i]?.mean ?? 0],
          backgroundColor: "transparent",
          borderColor: "transparent",
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: "#e8edf0" } },
        },
      },
    });

    charts.boxplot._boxData = statsArr;
    charts.boxplot._boxColors = scenarios.map(n => COULEURS[n]);
    charts.boxplot.update();
  }

  // ── Histogramme ──────────────────────────────────────────────────────
  function updateHisto(ind, scenarios) {
    const ctx = document.getElementById("chart-histo").getContext("2d");
    if (charts.histo) { charts.histo.destroy(); }

    // Calculer les bins sur l'ensemble des données
    const allVals = allData
      .filter(d => scenarios.includes(d.Niveau))
      .map(d => d[ind])
      .filter(v => v != null);

    if (!allVals.length) return;

    const vmin = Math.min(...allVals);
    const vmax = Math.max(...allVals);
    const nbBins = 15;
    const step = (vmax - vmin) / nbBins;
    const edges = Array.from({ length: nbBins + 1 }, (_, i) => vmin + i * step);
    const labels = edges.slice(0, -1).map(v => v.toFixed(1));

    const datasets = scenarios.map(niv => {
      const vals = allData.filter(d => d.Niveau === niv).map(d => d[ind]).filter(v => v != null);
      const bins = new Array(nbBins).fill(0);
      vals.forEach(v => {
        const i = Math.min(Math.floor((v - vmin) / step), nbBins - 1);
        bins[i]++;
      });
      return {
        label: LABELS[niv],
        data: bins,
        backgroundColor: COULEURS[niv] + "80",
        borderColor: COULEURS[niv],
        borderWidth: 1,
      };
    });

    charts.histo = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { font: { size: 11 }, usePointStyle: true },
          },
        },
        scales: {
          x: { grid: { display: false }, stacked: false },
          y: { grid: { color: "#e8edf0" }, title: { display: true, text: "Fréquence" } },
        },
      },
    });
  }

  // ── Orchestration ────────────────────────────────────────────────────
  function updateAll() {
    if (!allData) return;
    const ind = document.getElementById("sel-indicateur").value;
    const scenarios = [...document.querySelectorAll("input[name=scenario]:checked")]
      .map(el => el.value);
    document.getElementById("bp-title").textContent =
      `Distribution — ${META.labels[ind] || ind}`;
    updateBoxplot(ind, scenarios);
    updateHisto(ind, scenarios);
    updateTable(ind, scenarios);
  }

  function majSelectIndicateur() {
    const cat = document.getElementById("sel-categorie").value;
    const sel = document.getElementById("sel-indicateur");
    sel.innerHTML = (META.categories[cat] || []).map(ind =>
      `<option value="${ind}">${META.labels[ind] || ind}</option>`
    ).join("");
    updateAll();
  }

  // ── Événements ──────────────────────────────────────────────────────
  document.getElementById("sel-categorie").addEventListener("change", majSelectIndicateur);
  document.getElementById("sel-indicateur").addEventListener("change", updateAll);
  document.querySelectorAll("input[name=scenario]").forEach(el =>
    el.addEventListener("change", updateAll)
  );

  // ── Init ────────────────────────────────────────────────────────────
  fetch("/api/data").then(r => r.json()).then(d => {
    allData = d;
    majSelectIndicateur();
  });

})();
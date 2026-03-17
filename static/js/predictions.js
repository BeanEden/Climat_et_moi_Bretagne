/**
 * predictions.js — Affiche les courbes prédictives 2006 -> 2100 issues du Modèle (tracc_projections_2100.json).
 */
(() => {
    "use strict";
  
    const META = window.APP_META;
    const ctx = document.getElementById("chart-predictions").getContext("2d");
    let chartInstance = null;
    let predictionsData = [];
  
    // Couleurs "Climat & Moi"
    const SCENARIOS = {
      "optimiste": { label: "Hypothèse Optimiste", color: "#f0a500" }, // jaune-orangé (GWL1.5)
      "reguliere": { label: "Tendance Régulière", color: "#e07030" },  // orange (GWL2.0)
      "pessimiste":{ label: "Hypothèse Pessimiste", color: "#c0392b" } // rouge (GWL3.0)
    };
  
    // ── Contrôles ────────────────────────────────────────────────────────
    function majSelectIndicateur() {
      const cat = document.getElementById("sel-categorie").value;
      const sel = document.getElementById("sel-indicateur");
      sel.innerHTML = (META.categories[cat] || []).map(ind =>
        `<option value="${ind}" ${ind === 'TMm_yr' ? 'selected' : ''}>${META.labels[ind] || ind}</option>`
      ).join("");
      updatePredictions();
    }
  
    // ── Moteur Graphique ─────────────────────────────────────────────────
    function updatePredictions() {
      if (!predictionsData.length) return;
  
      const ind = document.getElementById("sel-indicateur").value;
      
      // Update Title
      const unite = (META.units && META.units[ind]) ? META.units[ind] : "";
      document.getElementById("chart-title").textContent = `Évolution projetée : ${META.labels[ind] || ind} ${unite ? '('+unite+')' : ''}`;
  
      // X Axis (Années 2006 -> 2100)
      const annees = [...new Set(predictionsData.map(d => d.Annee))].sort((a,b) => a - b);
      
      // Extraction des 3 courbes
      const datasets = [];
      
      Object.entries(SCENARIOS).forEach(([hypo, config]) => {
        // Filtrer la donnée pour cette hypothèse
        const pts = predictionsData.filter(d => d.Hypothese === hypo);
        
        // Aligner sur les axes
        const dataMap = new Map();
        pts.forEach(p => { dataMap.set(p.Annee, p[ind]); });
  
        const yData = annees.map(a => dataMap.get(a) ?? null);
  
        datasets.push({
          label: config.label,
          data: yData,
          borderColor: config.color,
          backgroundColor: config.color + "20",
          borderWidth: 3,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 6,
        });
  
        // Mise à jour de la carte KPI pour 2100 et écart 2026
        const val2100 = dataMap.has(2100) ? dataMap.get(2100) : null;
        const val2026 = dataMap.has(2026) ? dataMap.get(2026) : null;
        
        let valStr = "—";
        let deltaStr = "—";
        let deltaColor = "";
        
        if (typeof val2100 === 'number') {
            valStr = `${val2100.toFixed(2)} ${unite}`.trim();
        }

        if (typeof val2100 === 'number' && typeof val2026 === 'number') {
            const diff = val2100 - val2026;
            const sign = diff > 0 ? "+" : "";
            deltaStr = `Écart vs 2026 : ${sign}${diff.toFixed(2)} ${unite}`;
            
            if (diff > 0) {
               deltaColor = "var(--c-red)";
            } else if (diff < 0) {
               deltaColor = "var(--c-blue)";
            } else {
               deltaColor = "var(--c-muted)";
            }
        }

        let idKPI = null, idDelta = null;
        if(hypo === "optimiste") { idKPI = "val-opt"; idDelta = "delta-opt"; }
        if(hypo === "reguliere") { idKPI = "val-reg"; idDelta = "delta-reg"; }
        if(hypo === "pessimiste") { idKPI = "val-pes"; idDelta = "delta-pes"; }

        if (idKPI) {
            document.getElementById(idKPI).textContent = valStr;
            const elDelta = document.getElementById(idDelta);
            elDelta.textContent = deltaStr;
            elDelta.style.color = deltaColor;
        }
      });
  
      // Render
      if(chartInstance) chartInstance.destroy();
  
      chartInstance = new Chart(ctx, {
        type: "line",
        data: { labels: annees, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              position: "top",
              labels: { font: { family: "Outfit, sans-serif", size: 13, weight: 600 }, usePointStyle: true, boxWidth: 8 }
            },
            tooltip: {
              backgroundColor: "rgba(255,255,255,0.95)",
              titleColor: "#1d2b38",
              bodyColor: "#57606a",
              borderColor: "#e8edf0",
              borderWidth: 1,
              titleFont: { family: "Outfit" },
              bodyFont: { family: "Inter" }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { maxTicksLimit: 12 }
            },
            y: {
              grid: { color: "#e8edf0" }
            }
          }
        }
      });
  
    }
  
    // ── Events ───────────────────────────────────────────────────────────
    document.getElementById("sel-categorie").addEventListener("change", majSelectIndicateur);
    document.getElementById("sel-indicateur").addEventListener("change", updatePredictions);
  
    // ── Initialisation ───────────────────────────────────────────────────
    fetch("/api/predictions")
      .then(r => r.json())
      .then(d => {
        if(d.error) {
            console.error(d.error);
            document.getElementById("chart-title").textContent = "Données temporelles non trouvées.";
            return;
        }
        predictionsData = d;
        majSelectIndicateur();
      })
      .catch(e => console.error("Forecast API fail:", e));
  
  })();

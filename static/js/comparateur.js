// Configuration globale
let metaData = {};
let traccData = [];
let mode = "annee"; // "annee" ou "periode"

// Éléments DOM Section 1 (Spécifique)
const selInd   = document.getElementById("spec-ind");
const selA1    = document.getElementById("spec-a1");
const selA2    = document.getElementById("spec-a2");
const selP1    = document.getElementById("spec-p1");
const selP2    = document.getElementById("spec-p2");
const inputsAn = document.getElementById("inputs-annee");
const inputsPe = document.getElementById("inputs-periode");
const btnMoAn  = document.getElementById("btn-mode-annee");
const btnMoPe  = document.getElementById("btn-mode-periode");

const uiL1 = document.getElementById("lbl-val1");
const uiV1 = document.getElementById("kpi-val1");
const uiU1 = document.getElementById("kpi-unit1");
const uiL2 = document.getElementById("lbl-val2");
const uiV2 = document.getElementById("kpi-val2");
const uiU2 = document.getElementById("kpi-unit2");
const uiAbs = document.getElementById("kpi-ecart-abs");
const uiRel = document.getElementById("kpi-ecart-rel");

// DOM Section 2 (Global)
const globP1 = document.getElementById("glob-p1");
const globP2 = document.getElementById("glob-p2");

// Instances Chart.js
let specChart = null;
let globRadar = null;
let globBar   = null;

// Palette
const color1 = "rgba(46, 125, 158, 0.85)";  // Bleu
const color2 = "rgba(240, 165, 0, 0.85)";   // Ocre
const line1  = "rgba(46, 125, 158, 1)";
const line2  = "rgba(240, 165, 0, 1)";


// ==========================================
// 1. Initialisation
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    // Récupération des données
    Promise.all([
        fetch("/api/data").then(r => r.json()),
        fetch("/api/spatial/points").then(r => r.json()) // Juste pour vérifier, mais meta est dispo
    ]).then(([d, _]) => {
        traccData = d;
        // Extraction des métadonnées injectées dans app.py pour le front
        // Normalement on les lit depuis un /api/meta mais on les passe du DOM ou on bricole
        fetch("/health").then(r => r.json()).then(() => {
            // on reconstruit meta.labels localement si besoin, ou on le passe par script variable
        });
        
        // Initial hooks
        setupListeners();
        updateAll();
    });
});

function setupListeners() {
    [selInd, selA1, selA2, selP1, selP2, globP1, globP2].forEach(el => {
        if(el) el.addEventListener("change", updateAll);
    });
}

function setMode(newMode) {
    mode = newMode;
    if(mode === "annee") {
        btnMoAn.classList.add("active");
        btnMoPe.classList.remove("active");
        inputsAn.style.display = "flex";
        inputsPe.style.display = "none";
    } else {
        btnMoPe.classList.add("active");
        btnMoAn.classList.remove("active");
        inputsPe.style.display = "flex";
        inputsAn.style.display = "none";
    }
    updateAll();
}

// ==========================================
// 2. Fonctions de Calcul des Moyennes
// ==========================================

// Retourne la moyenne d'un indicateur sur la BRETAGNE pour UNE année exacte
function getMoyenneAnnee(annee, ind) {
    const records = traccData.filter(d => String(d.Annee) === String(annee) && d[ind] !== null);
    if(records.length === 0) return null;
    const sum = records.reduce((acc, curr) => acc + curr[ind], 0);
    return sum / records.length;
}

// Retourne la moyenne d'un indicateur sur la BRETAGNE + SUR LA DECENNIE entière
function getMoyennePeriode(startAnnee, ind) {
    const start = parseInt(startAnnee);
    const end = start + 9;
    const records = traccData.filter(d => d.Annee >= start && d.Annee <= end && d[ind] !== null);
    if(records.length === 0) return null;
    const sum = records.reduce((acc, curr) => acc + curr[ind], 0);
    return sum / records.length;
}

// Retourne un array chronologique [val 1980, val 1981, ...] pour une décennie
function getSeriePeriode(startAnnee, ind) {
    const start = parseInt(startAnnee);
    const serie = [];
    for(let i=0; i<10; i++) {
        const y = start + i;
        serie.push(getMoyenneAnnee(y, ind));
    }
    return serie;
}

// ==========================================
// 3. Mise à jour des UI (Master Function)
// ==========================================
function updateAll() {
    if(traccData.length === 0) return;
    updateSectionSpecifique();
    updateSectionGlobale();
}

function updateSectionSpecifique() {
    const ind = selInd.value;
    const isAnnee = (mode === "annee");
    const valName = selInd.options[selInd.selectedIndex].text;
    
    let v1 = null, v2 = null, lbl1 = "", lbl2 = "";
    
    // Détermination des valeurs (Année vs Période)
    if(isAnnee) {
        lbl1 = selA1.value;
        lbl2 = selA2.value;
        v1 = getMoyenneAnnee(lbl1, ind);
        v2 = getMoyenneAnnee(lbl2, ind);
    } else {
        const p1 = parseInt(selP1.value);
        const p2 = parseInt(selP2.value);
        lbl1 = p1 + "-" + (p1+9);
        lbl2 = p2 + "-" + (p2+9);
        v1 = getMoyennePeriode(p1, ind);
        v2 = getMoyennePeriode(p2, ind);
    }

    // Mise à jour des cartes KPI
    uiL1.textContent = lbl1;
    uiL2.textContent = lbl2;
    uiU1.textContent = valName;
    uiU2.textContent = valName;

    if(v1 !== null) uiV1.textContent = v1.toFixed(1); else uiV1.textContent = "N/A";
    if(v2 !== null) uiV2.textContent = v2.toFixed(1); else uiV2.textContent = "N/A";

    if(v1 !== null && v2 !== null) {
        const diff = v2 - v1;
        const pct  = (v1 !== 0) ? (diff / v1) * 100 : 0;
        
        uiAbs.textContent = (diff > 0 ? "+" : "") + diff.toFixed(1);
        uiAbs.style.color = diff > 0 ? "var(--c-red)" : "var(--c-green)";
        if(diff === 0) uiAbs.style.color = "var(--c-muted)";

        uiRel.textContent = (pct > 0 ? "+" : "") + pct.toFixed(1) + " %";
        uiRel.style.color = pct > 0 ? "var(--c-red)" : "var(--c-green)";
        if(pct === 0) uiRel.style.color = "var(--c-muted)";
    } else {
        uiAbs.textContent = "-";
        uiRel.textContent = "-";
        uiAbs.style.color = "var(--c-dark)";
        uiRel.style.color = "var(--c-dark)";
    }

    // --- Mise à jour Graphique ---
    const ctx = document.getElementById("spec-chart").getContext("2d");
    if(specChart) specChart.destroy();

    if(isAnnee) {
        // Bar Chart (2 colonnes simples)
        specChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [lbl1, lbl2],
                datasets: [{
                    label: valName,
                    data: [v1, v2],
                    backgroundColor: [color1, color2],
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    } else {
        // Line Chart (Superposition de deux décennies, Axe X = Année 1 à 10)
        const serie1 = getSeriePeriode(selP1.value, ind);
        const serie2 = getSeriePeriode(selP2.value, ind);
        const labelsX = ["Année 1", "Année 2", "Année 3", "Année 4", "Année 5", "Année 6", "Année 7", "Année 8", "Année 9", "Année 10"];
        
        specChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labelsX,
                datasets: [
                    {
                        label: `Période ${lbl1}`,
                        data: serie1,
                        borderColor: line1,
                        backgroundColor: color1,
                        fill: false,
                        tension: 0.3
                    },
                    {
                        label: `Période ${lbl2}`,
                        data: serie2,
                        borderColor: line2,
                        backgroundColor: color2,
                        fill: false,
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } }
            }
        });
    }
}


function updateSectionGlobale() {
    const listInds = Array.from(selInd.querySelectorAll("option")).map(o => o.value);
    const listNames = Array.from(selInd.querySelectorAll("option")).map(o => o.text);
    
    // Seulement prendre les ~8 indicateurs les plus pertinents pour éviter un radar illisible
    const coreInds = ["TMm_yr", "Pr_yr", "TxD25_yr", "TxD35_yr", "TnM20_yr", "Dtr_yr", "Rx1d_yr", "R20_yr"];
    const indices = coreInds.map(i => listInds.indexOf(i)).filter(i => i >= 0);
    const radarIndNames = indices.map(i => listNames[i]);
    const radarIndIds = indices.map(i => listInds[i]);
    
    const p1 = parseInt(globP1.value);
    const p2 = parseInt(globP2.value);
    const lbl1 = p1 + "-" + (p1+9);
    const lbl2 = p2 + "-" + (p2+9);

    const dataP1 = radarIndIds.map(ind => getMoyennePeriode(p1, ind));
    const dataP2 = radarIndIds.map(ind => getMoyennePeriode(p2, ind));
    
    // -- 2a. Radar (Normalisé en % pour tenir sur un seul graphe) --
    // Base 100 = Période 1
    const p1Radar = [];
    const p2Radar = [];
    for(let i=0; i<dataP1.length; i++) {
        p1Radar.push(100); // Référence
        if(dataP1[i] !== 0 && dataP1[i] !== null && dataP2[i] !== null) {
            p2Radar.push( (dataP2[i] / dataP1[i]) * 100 );
        } else {
            p2Radar.push(100);
        }
    }

    const ctxRadar = document.getElementById("glob-radar-chart").getContext("2d");
    if(globRadar) globRadar.destroy();
    globRadar = new Chart(ctxRadar, {
        type: 'radar',
        data: {
            labels: radarIndNames,
            datasets: [
                {
                    label: `Ref. ${lbl1} (Base 100)`,
                    data: p1Radar,
                    backgroundColor: "rgba(46, 125, 158, 0.2)",
                    borderColor: line1,
                    pointBackgroundColor: line1
                },
                {
                    label: `Proj. ${lbl2}`,
                    data: p2Radar,
                    backgroundColor: "rgba(240, 165, 0, 0.3)",
                    borderColor: line2,
                    pointBackgroundColor: line2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: { suggestedMin: 50, suggestedMax: 150 }
            }
        }
    });

    // -- 2b. Histogramme Absolu Global --
    const ctxBar = document.getElementById("glob-bar-chart").getContext("2d");
    if(globBar) globBar.destroy();
    globBar = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: radarIndNames.map(n => n.substring(0, 15)+"..."), // Trim names
            datasets: [
                { label: lbl1, data: dataP1, backgroundColor: color1 },
                { label: lbl2, data: dataP2, backgroundColor: color2 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } }
        }
    });

}

/**
 * carte_ml.js — Heatmap Leaflet extrapolée par ML.
 * Calcule l'écart prédit par tracc_projections_2100 et l'applique à la typologie spatiale de référence.
 */

(function () {
    "use strict";
  
    var C = window.CARTE_ML_CONFIG;
  
    var mapLoading = document.getElementById("map-loading");
    var sliderAnnee = document.getElementById("slider-annee");
    var anneeVal = document.getElementById("annee-val");
    var selInd = document.getElementById("sel-indicateur");
    var selScenario = document.getElementById("sel-scenario-ml");
    var btnPlay = document.getElementById("btn-play");
    var selSpeed = document.getElementById("sel-speed");
  
    var sliderRadius = document.getElementById("slider-radius");
    var sliderBlur = document.getElementById("slider-blur");
    var sliderOpac = document.getElementById("slider-opacity");
    var radiusVal = document.getElementById("radius-val");
    var blurVal = document.getElementById("blur-val");
    var opacityVal = document.getElementById("opacity-val");
  
    var legendeMin = document.getElementById("legende-min");
    var legendeMid = document.getElementById("legende-mid");
    var legendeMax = document.getElementById("legende-max");
    var legendeUnite = document.getElementById("legende-unite");
    var legendeGrad = document.getElementById("legende-gradient");

    var hoverSection = document.getElementById("hover-section");
    var hoverValue = document.getElementById("hover-value");
    var hoverCoords = document.getElementById("hover-coords");

    var inputAdresse = document.getElementById("input-adresse");
    var btnGeocode = document.getElementById("btn-geocode");
    var geocodeSt = document.getElementById("geocode-status");
    var listeSugg = document.getElementById("adresse-suggestions");
  
    var IND_PRECIP = new Set(["RR_yr", "RR_seas_JJA", "RR_seas_DJF", "RRq99_yr", "Rx1d_yr", "RRq99refD_yr"]);
    var GRAD_THERM = { 0.0: "#2b83ba", 0.25: "#abdda4", 0.50: "#ffffbf", 0.75: "#fdae61", 1.0: "#d7191c" };
    var GRAD_PRECIP = { 0.0: "#f7fbff", 0.2: "#c6dbef", 0.4: "#6baed6", 0.65: "#2171b5", 0.85: "#084594", 1.0: "#08114a" };
    var CSS_THERM = "linear-gradient(to right, #2b83ba 0%, #abdda4 25%, #ffffbf 50%, #fdae61 75%, #d7191c 100%)";
    var CSS_PRECIP = "linear-gradient(to right, #f7fbff 0%, #c6dbef 20%, #6baed6 40%, #2171b5 65%, #084594 85%, #08114a 100%)";
  
    var TILES = {
      osm: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr: "© OpenStreetMap", maxZ: 18 },
      topo: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr: "© OpenTopoMap", maxZ: 17 },
      carto: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attr: "© CartoDB", maxZ: 19 },
      "carto-dark": { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attr: "© CartoDB", maxZ: 19 },
      satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: "© ESRI", maxZ: 18 },
    };
  
    // Init Leaflet
    var map = L.map("map", { center: [48.0, -2.8], zoom: 8 });
    var tileLayer = L.tileLayer(TILES.topo.url, { attribution: TILES.topo.attr, maxZoom: TILES.topo.maxZ }).addTo(map);
  
    // State
    var heat = null;
    var isPlaying = false;
    var playTimer = null;
    var spatialRefYear = null;
  
    var debounceTimer = null;
    var abortCtrl = null;
    var indexActif = -1;
    var suggsBrutes = [];
    var markerAdresse = null;

    var globalPoints = [];
    var currentHoveredPoint = null;
    var hoverChart = null;
    window.phenomenesData = [];
  
    var globalData = {
        spatialBase: {},
        mlPredictions: [],
        plages: {}
    };
  
    function setHeat(points, ind) {
      if (heat) map.removeLayer(heat);
      
      var opts = {
        radius: parseInt(sliderRadius.value),
        blur: parseInt(sliderBlur.value),
        max: 1.0,
        minOpacity: 0.4,
        gradient: IND_PRECIP.has(ind) ? GRAD_PRECIP : GRAD_THERM,
      };
      
      heat = L.heatLayer(points, opts).addTo(map);
      var canvas = heat._canvas;
      if (canvas) canvas.style.opacity = sliderOpac.value;
  
      if (radiusVal) radiusVal.textContent = sliderRadius.value;
      if (blurVal) blurVal.textContent = sliderBlur.value;
      if (opacityVal) opacityVal.textContent = parseFloat(sliderOpac.value).toFixed(2);
    }
  
    function majLegende(ind) {
        if(!globalData.plages[ind]) return;
        var unit = C.units[ind] || "";
        legendeUnite.textContent = unit;
        legendeGrad.style.background = IND_PRECIP.has(ind) ? CSS_PRECIP : CSS_THERM;
        
        var p = globalData.plages[ind];
        var minV = p.p10 !== undefined ? p.p10 : p.min;
        var maxV = p.p90 !== undefined ? p.p90 : p.max;
        
        legendeMin.textContent = minV.toFixed(1);
        legendeMid.textContent = ((minV+maxV)/2).toFixed(1);
        legendeMax.textContent = maxV.toFixed(1);
    }
  
    function fetchBaseSpatial(ind) {
        if (!spatialRefYear) return Promise.resolve();
        if (globalData.spatialBase[ind]) return Promise.resolve();
        
        mapLoading.style.display = "block";
        return fetch("/api/spatial/annee/" + spatialRefYear + "?ind=" + ind + "&normalize=false")
            .then(r => r.json())
            .then(data => {
                globalData.spatialBase[ind] = data.points.map(p => ({ lat: p[0], lon: p[1], val: p[2] }));
            })
            .catch(e => console.error("Erreur chargement fond spatial", e))
            .finally(() => { mapLoading.style.display = "none"; });
    }
  
    function updatePhenomenes(yr) {
        if(!window.phenomenesData) return;
        var inset = document.getElementById("phenomenes-inset");
        var content = document.getElementById("phenomenes-content");
        var gwlSpan = document.getElementById("phenomenes-gwl");
        
        if (!inset || !content || !gwlSpan) return;
        
        var yrNum = parseInt(yr);
        var scen = yrNum >= 2079 ? "GWL30" : yrNum >= 2052 ? "GWL20" : yrNum >= 2037 ? "GWL15" : "REF";
        
        if (scen === "REF" || window.phenomenesData.length === 0) {
            inset.style.display = "none";
            return;
        }
        
        var levelKey = "Impact à 1,5°C";
        var levelDisplay = "+1.5°C";
        if (scen === "GWL20" || scen === "GWL30") {
            levelKey = "Impact à 2°C";
            levelDisplay = "+2°C";
            if(scen === "GWL30") levelDisplay = "> +2°C";
        }
        
        gwlSpan.textContent = levelDisplay;
        gwlSpan.style.background = C.scenarios ? C.scenarios[scen] : "var(--c-primary)";
        
        var html = "";
        window.phenomenesData.forEach(function(item) {
            if (item[levelKey]) {
                html += "<div style='background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:6px; border-left:3px solid " + (C.scenarios ? C.scenarios[scen] : "var(--c-primary)") + ";'>" +
                        "<strong style='display:block; color:#ffcc00; font-size:0.9rem; margin-bottom:4px;'>" + item["Phénomène"] + "</strong>" +
                        "<span style='line-height:1.3; opacity:0.9;'>" + item[levelKey] + "</span>" +
                        "</div>";
            }
        });
        content.innerHTML = html;
        inset.style.display = "block";
    }

    function initOrUpdateChart(labels, dataY, unit) {
        var ctx = document.getElementById("hover-chart").getContext("2d");
        if (hoverChart) {
            hoverChart.data.labels = labels;
            hoverChart.data.datasets[0].data = dataY;
            hoverChart.options.scales.y.title.text = unit;
            hoverChart.update();
        } else {
            hoverChart = new Chart(ctx, {
                type: "line",
                data: {
                    labels: labels,
                    datasets: [{
                        label: "Évolution Projetée (ML)",
                        data: dataY,
                        borderColor: "rgba(54, 162, 235, 1)",
                        backgroundColor: "rgba(54, 162, 235, 0.2)",
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        fill: true,
                        tension: 0.2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { maxTicksLimit: 5, font: { size: 9 } }, grid: { display: false } },
                        y: { title: { display: true, text: unit, font: { size: 9 } }, ticks: { font: { size: 9 } } }
                    }
                }
            });
        }
    }

    function renderChartAndHoverValue() {
        if(!currentHoveredPoint) return;
        var ind = selInd.value;
        var hypo = selScenario.value;
        var yearInputIndex = parseInt(sliderAnnee.value);
        var year = parseInt(C.annees[yearInputIndex]);
        
        var mlBase2006 = globalData.mlPredictions.find(p => p.Annee === 2006 && p.Hypothese === hypo);
        if (!mlBase2006 || mlBase2006[ind] === undefined) return;
        
        var lbl = C.labels[ind] || ind;
        var mu = lbl.match(/\(([^)]+)\)/);
        var unit = mu ? mu[1] : "";

        var labels = [];
        var dataY = [];
        C.annees.forEach(yr => {
            var mlTarget = globalData.mlPredictions.find(p => p.Annee === parseInt(yr) && p.Hypothese === hypo);
            if(mlTarget && mlTarget[ind] !== undefined) {
                var delta = mlTarget[ind] - mlBase2006[ind];
                var extVal = currentHoveredPoint.val + delta;
                labels.push(yr);
                dataY.push(extVal);
            }
        });
        initOrUpdateChart(labels, dataY, unit);

        var currentMlTarget = globalData.mlPredictions.find(p => p.Annee === year && p.Hypothese === hypo);
        if(currentMlTarget && currentMlTarget[ind] !== undefined) {
            var curDelta = currentMlTarget[ind] - mlBase2006[ind];
            var curVal = currentHoveredPoint.val + curDelta;
            hoverSection.style.display = "block";
            hoverValue.textContent = curVal.toFixed(2) + " " + unit;
            hoverCoords.textContent = currentHoveredPoint.lat.toFixed(4) + "° N, " + currentHoveredPoint.lon.toFixed(4) + "° E";
        }
    }

    function chargerPoints() {
        fetch("/api/spatial/points")
            .then(function (r) { return r.json(); })
            .then(function (d) {
                globalPoints = d.points;
                d.points.forEach(function (pt) {
                    L.circle([pt.lat, pt.lon], { radius: 3500, fillOpacity: 0, stroke: false })
                        .addTo(map)
                        .on("mouseover", function () {
                            var basePoint = null;
                            if (globalData.spatialBase[selInd.value]) {
                                basePoint = globalData.spatialBase[selInd.value].find(p => Math.abs(p.lat - pt.lat) < 0.001 && Math.abs(p.lon - pt.lon) < 0.001);
                            }
                            if (basePoint) {
                                currentHoveredPoint = { lat: pt.lat, lon: pt.lon, val: basePoint.val };
                                renderChartAndHoverValue();
                            }
                        });
                });
            });
    }

    function renderMap() {
        var ind = selInd.value;
        var hypo = selScenario.value;
        var yearInputIndex = parseInt(sliderAnnee.value);
        var year = parseInt(C.annees[yearInputIndex]);
        anneeVal.textContent = year;
        
        updatePhenomenes(year);
  
        if (!globalData.spatialBase[ind] || !globalData.mlPredictions.length) return;
  
        // Base de comparaison 2006 pour isoler le delta ML
        var mlBase2006 = globalData.mlPredictions.find(p => p.Annee === 2006 && p.Hypothese === hypo);
        var mlTarget = globalData.mlPredictions.find(p => p.Annee === year && p.Hypothese === hypo);
  
        if(!mlBase2006 || !mlTarget || mlBase2006[ind]===undefined || mlTarget[ind]===undefined) {
            setHeat([], ind);
            return; // Donnée indisponible pour cet horizon/hypothèse
        }
  
        // Calcul du delta de projection
        var deltaML = mlTarget[ind] - mlBase2006[ind];
  
        // Plages de normalisation pour la ColorMap
        var pInfo = globalData.plages[ind];
        var minV = pInfo.p10 !== undefined ? pInfo.p10 : pInfo.min;
        var maxV = pInfo.p90 !== undefined ? pInfo.p90 : pInfo.max;
        var vrange = maxV - minV; if(vrange===0) vrange=1;
  
        // Application du delta sur la maille spatiale
        var pointsNorm = globalData.spatialBase[ind].map(basePt => {
            var valExtrapolee = basePt.val + deltaML;
            var valNorm = Math.max(0, Math.min(1, (valExtrapolee - minV) / vrange));
            return [basePt.lat, basePt.lon, valNorm];
        });
  
        setHeat(pointsNorm, ind);
        majLegende(ind);

        if(currentHoveredPoint) {
             var basePoint = globalData.spatialBase[ind].find(p => Math.abs(p.lat - currentHoveredPoint.lat) < 0.001 && Math.abs(p.lon - currentHoveredPoint.lon) < 0.001);
             if (basePoint) {
                 currentHoveredPoint.val = basePoint.val;
                 renderChartAndHoverValue();
             }
        }
    }
  
    // INITIALISATION CASCADE
    Promise.all([
        fetch("/api/spatial/points").then(r => r.json()),
        fetch("/api/predictions").then(r => r.json())
    ]).then(([spatialRes, mlProj]) => {
        globalData.plages = spatialRes.plages;
        globalData.mlPredictions = mlProj;
        
        // Utiliser la première année dispo comme référentiel du micro-climat (ex: 1976 / 2006)
        if(spatialRes.annees_disponibles && spatialRes.annees_disponibles.length > 0) {
            spatialRefYear = spatialRes.annees_disponibles[0];
        }
  
        fetchBaseSpatial(selInd.value).then(renderMap);
    }).catch(e => {
        console.error("Critical error loading ML Maps dependencies", e);
        mapLoading.textContent = "Erreur fatale de chargement.";
    });

    // ADRESSE & GEOCODING
    function fermerSugg() {
        listeSugg.style.display = "none";
        listeSugg.innerHTML = "";
        indexActif = -1;
        suggsBrutes = [];
    }
    function nomCourt(item) {
        var a = item.address || {};
        var rue = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(" ");
        var loc = a.village || a.town || a.city || a.municipality || "";
        var dep = a.county || a.state_district || "";
        return {
            main: rue || item.name || item.display_name.split(",")[0],
            sub: [loc, dep].filter(Boolean).join(", ")
        };
    }
    function renderSugg(items) {
        listeSugg.innerHTML = "";
        indexActif = -1;
        if (!items.length) {
            listeSugg.innerHTML = "<li class='sug-empty'>Aucun résultat</li>";
            listeSugg.style.display = "block";
            return;
        }
        items.forEach(function (item, i) {
            var nc = nomCourt(item);
            var li = document.createElement("li");
            li.innerHTML = "<div class='sug-main'>" + nc.main + "</div>" + (nc.sub ? "<div class='sug-sub'>" + nc.sub + "</div>" : "");
            li.addEventListener("mousedown", function (e) { e.preventDefault(); selectionnerSugg(i); });
            listeSugg.appendChild(li);
        });
        listeSugg.style.display = "block";
    }
    function majSurbrillance() {
        listeSugg.querySelectorAll("li:not(.sug-loading):not(.sug-empty)").forEach(function (li, i) {
            li.classList.toggle("active", i === indexActif);
        });
        if (indexActif >= 0 && suggsBrutes[indexActif]) {
            inputAdresse.value = nomCourt(suggsBrutes[indexActif]).main;
        }
    }
    function placerMarqueur(lat, lon, label) {
        if (markerAdresse) map.removeLayer(markerAdresse);
        markerAdresse = L.marker([lat, lon]).addTo(map);
        markerAdresse.bindTooltip(label.split(",").slice(0, 2).join(","), { permanent: true, direction: "top" });
        markerAdresse.openTooltip();
        map.setView([lat, lon], Math.max(map.getZoom(), 11));
        geocodeSt.textContent = "Adresse localisée";
        geocodeSt.style.color = "#3a8c5c";

        if (globalPoints.length > 0) {
            var closest = null;
            var minDist = Infinity;
            globalPoints.forEach(function(p) {
                var d2 = Math.pow(p.lat - lat, 2) + Math.pow(p.lon - lon, 2);
                if (d2 < minDist) { minDist = d2; closest = p; }
            });
            if (closest) {
                var basePoint = null;
                if (globalData.spatialBase[selInd.value]) {
                    basePoint = globalData.spatialBase[selInd.value].find(p => Math.abs(p.lat - closest.lat) < 0.001 && Math.abs(p.lon - closest.lon) < 0.001);
                }
                if(basePoint) {
                    currentHoveredPoint = { lat: closest.lat, lon: closest.lon, val: basePoint.val };
                    renderChartAndHoverValue();
                }
            }
        }
    }
    function selectionnerSugg(idx) {
        var item = suggsBrutes[idx];
        if (!item) return;
        var nc = nomCourt(item);
        inputAdresse.value = [nc.main, nc.sub].filter(Boolean).join(", ");
        fermerSugg();
        placerMarqueur(parseFloat(item.lat), parseFloat(item.lon), item.display_name);
    }
    function fetchSugg(texte) {
        if (abortCtrl) abortCtrl.abort();
        abortCtrl = new AbortController();
        listeSugg.innerHTML = "<li class='sug-loading'>Recherche...</li>";
        listeSugg.style.display = "block";
        var q = encodeURIComponent(texte + ", Bretagne, France");
        fetch(
            "https://nominatim.openstreetmap.org/search?q=" + q + "&format=json&limit=5&addressdetails=1&accept-language=fr",
            { signal: abortCtrl.signal, headers: { "Accept-Language": "fr" } }
        )
            .then(function (r) { return r.json(); })
            .then(function (res) { suggsBrutes = res; renderSugg(res); })
            .catch(function (e) { if (e.name !== "AbortError") fermerSugg(); });
    }
    function lancerRecherche() {
        var adresse = inputAdresse.value.trim();
        if (!adresse) return;
        fermerSugg();
        geocodeSt.textContent = "Géocodage en cours...";
        geocodeSt.style.color = "var(--c-muted)";
        btnGeocode.disabled = true;
        var q = encodeURIComponent(adresse + ", Bretagne, France");
        fetch(
            "https://nominatim.openstreetmap.org/search?q=" + q + "&format=json&limit=1&accept-language=fr",
            { headers: { "Accept-Language": "fr" } }
        )
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (!res.length) throw new Error("Adresse introuvable");
                placerMarqueur(parseFloat(res[0].lat), parseFloat(res[0].lon), res[0].display_name);
            })
            .catch(function (e) {
                geocodeSt.textContent = "Erreur : " + e.message;
                geocodeSt.style.color = "#c0392b";
            })
            .finally(function () { btnGeocode.disabled = false; });
    }

    // EVENTS UI
    inputAdresse.addEventListener("input", function () {
        clearTimeout(debounceTimer);
        var v = inputAdresse.value.trim();
        if (v.length < 3) { fermerSugg(); return; }
        debounceTimer = setTimeout(function () { fetchSugg(v); }, 350);
    });
    inputAdresse.addEventListener("keydown", function (e) {
        var items = listeSugg.querySelectorAll("li:not(.sug-loading):not(.sug-empty)");
        if (e.key === "ArrowDown") { e.preventDefault(); indexActif = Math.min(indexActif + 1, items.length - 1); majSurbrillance(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); indexActif = Math.max(indexActif - 1, -1); majSurbrillance(); }
        else if (e.key === "Enter") { e.preventDefault(); indexActif >= 0 ? selectionnerSugg(indexActif) : lancerRecherche(); }
        else if (e.key === "Escape") { fermerSugg(); }
    });
    inputAdresse.addEventListener("blur", function () { setTimeout(fermerSugg, 180); });
    document.addEventListener("click", function (e) {
        if (!inputAdresse.contains(e.target) && !listeSugg.contains(e.target)) fermerSugg();
    });
    btnGeocode.addEventListener("click", lancerRecherche);
    selInd.addEventListener("change", () => {
        fetchBaseSpatial(selInd.value).then(renderMap);
    });
    selScenario.addEventListener("change", renderMap);
    sliderAnnee.addEventListener("input", renderMap);
    
    [sliderRadius, sliderBlur, sliderOpac].forEach(el => el.addEventListener("input", renderMap));
  
    document.getElementById("sel-layer").addEventListener("change", function(e) {
        map.removeLayer(tileLayer);
        var t = TILES[e.target.value] || TILES.topo;
        tileLayer = L.tileLayer(t.url, { attribution: t.attr, maxZoom: t.maxZ }).addTo(map);
    });
  
    // ANIMATION
    function stepAnim() {
        if(!isPlaying) return;
        var idx = (parseInt(sliderAnnee.value) + 1) % C.annees.length;
        sliderAnnee.value = idx;
        renderMap();
        playTimer = setTimeout(stepAnim, parseInt(selSpeed.value));
    }
  
    btnPlay.addEventListener("click", () => {
        isPlaying = !isPlaying;
        btnPlay.innerHTML = isPlaying ? "&#9646;&#9646; Pause" : "&#9654; Animer";
        btnPlay.classList.toggle("playing", isPlaying);
        if(isPlaying) stepAnim();
        else { clearTimeout(playTimer); playTimer = null; }
    });

    chargerPoints();
    
    fetch("/api/phenomenes")
      .then(function(r) { return r.json(); })
      .then(function(d) { window.phenomenesData = d; });
  
  })();

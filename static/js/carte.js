/**
 * carte.js — Heatmap Leaflet interactive avec animation temporelle et recherche adresse.
 * Deux palettes : THERMIQUE (bleu->rouge) et PRECIPITATION (blanc->bleu nuit).
 * Autocomplétion Nominatim avec debounce 350ms + AbortController.
 */

(function () {
  "use strict";

  var C = window.CARTE_CONFIG;

  // ── DOM ─────────────────────────────────────────────────────────────
  var sliderAnnee = document.getElementById("slider-annee");
  var anneeVal = document.getElementById("annee-val");
  var anneeScen = document.getElementById("annee-scenario");
  var selInd = document.getElementById("sel-indicateur");
  var selLayer = document.getElementById("sel-layer");
  var btnPlay = document.getElementById("btn-play");
  var selSpeed = document.getElementById("sel-speed");
  var sliderRadius = document.getElementById("slider-radius");
  var sliderBlur = document.getElementById("slider-blur");
  var sliderOpac = document.getElementById("slider-opacity");
  var radiusVal = document.getElementById("radius-val");
  var blurVal = document.getElementById("blur-val");
  var opacityVal = document.getElementById("opacity-val");
  var mapLoading = document.getElementById("map-loading");
  var hoverSection = document.getElementById("hover-section");
  var hoverValue = document.getElementById("hover-value");
  var hoverCoords = document.getElementById("hover-coords");
  var legendeMin = document.getElementById("legende-min");
  var legendeMid = document.getElementById("legende-mid");
  var legendeMax = document.getElementById("legende-max");
  var legendeUnite = document.getElementById("legende-unite");
  var legendeGrad = document.getElementById("legende-gradient");
  var inputAdresse = document.getElementById("input-adresse");
  var btnGeocode = document.getElementById("btn-geocode");
  var geocodeSt = document.getElementById("geocode-status");
  var listeSugg = document.getElementById("adresse-suggestions");

  // ── Fonds de carte ───────────────────────────────────────────────────
  var TILES = {
    osm: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr: "© OpenStreetMap", maxZ: 18 },
    topo: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr: "© OpenTopoMap", maxZ: 17 },
    carto: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attr: "© CartoDB", maxZ: 19 },
    "carto-dark": { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attr: "© CartoDB", maxZ: 19 },
    satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: "© ESRI", maxZ: 18 },
  };

  // ── Init Leaflet ─────────────────────────────────────────────────────
  var map = L.map("map", { center: [48.0, -2.8], zoom: 8 });
  var tileLayer = L.tileLayer(TILES.topo.url, { attribution: TILES.topo.attr, maxZoom: TILES.topo.maxZ }).addTo(map);

  // ── Palettes ─────────────────────────────────────────────────────────
  var IND_PRECIP = new Set(["RR_yr", "RR_seas_JJA", "RR_seas_DJF", "RRq99_yr", "Rx1d_yr", "RRq99refD_yr"]);

  var GRAD_THERM = { 0.0: "#2b83ba", 0.25: "#abdda4", 0.50: "#ffffbf", 0.75: "#fdae61", 1.0: "#d7191c" };
  var GRAD_PRECIP = { 0.0: "#f7fbff", 0.2: "#c6dbef", 0.4: "#6baed6", 0.65: "#2171b5", 0.85: "#084594", 1.0: "#08114a" };
  var CSS_THERM = "linear-gradient(to right, #2b83ba 0%, #abdda4 25%, #ffffbf 50%, #fdae61 75%, #d7191c 100%)";
  var CSS_PRECIP = "linear-gradient(to right, #f7fbff 0%, #c6dbef 20%, #6baed6 40%, #2171b5 65%, #084594 85%, #08114a 100%)";

  // ── État ─────────────────────────────────────────────────────────────
  var heat = null;
  var cache = {};
  var currentAnnee = C.anneeDefaut;
  var currentInd = selInd.value;
  var isPlaying = false;
  var playTimer = null;
  var plagesCache = null;
  var phenomenesData = [];

  // ── Heatmap ───────────────────────────────────────────────────────────
  function heatOpts(ind, maxVal) {
    return {
      radius: parseInt(sliderRadius.value),
      blur: parseInt(sliderBlur.value),
      max: maxVal || 1.0,
      minOpacity: 0.4,
      gradient: IND_PRECIP.has(ind) ? GRAD_PRECIP : GRAD_THERM,
    };
  }

  function setHeat(points, ind) {
    var opts = heatOpts(ind, 0.85); 
    if (heat) {
      map.removeLayer(heat);
    }
    heat = L.heatLayer(points, opts).addTo(map);
    var canvas = heat._canvas;
    if (canvas) canvas.style.opacity = sliderOpac.value;
  }

  // ── Fetch avec cache ─────────────────────────────────────────────────
  function fetchAnnee(annee, ind) {
    var key = annee + "|" + ind;
    if (!cache[key]) {
      cache[key] = fetch("/api/spatial/annee/" + annee + "?ind=" + ind + "&normalize=true")
        .then(function (r) { return r.json(); });
    }
    return cache[key];
  }

  function prefetch(annee, ind) {
    var idx = C.annees.indexOf(String(annee));
    [-1, 0, 1, 2].forEach(function (o) {
      var a = C.annees[idx + o];
      if (a) fetchAnnee(a, ind);
    });
  }

  // ── Légende ──────────────────────────────────────────────────────────
  function majLegende(ind, plage) {
    if (!plagesCache) {
      fetch("/api/spatial/points")
        .then(function (r) { return r.json(); })
        .then(function (d) {
          plagesCache = d.plages;
          majLegende(ind, plagesCache[ind]);
        });
      return;
    }
    
    var lbl = C.labels[ind] || ind;
    var mu = lbl.match(/\(([^)]+)\)/);
    legendeUnite.textContent = mu ? mu[1] : "";
    legendeGrad.style.background = IND_PRECIP.has(ind) ? CSS_PRECIP : CSS_THERM;

    if (plage) {
      var minV = plage.p10 !== undefined ? plage.p10 : plage.min;
      var maxV = plage.p90 !== undefined ? plage.p90 : plage.max;
      var midV = (minV + maxV) / 2;
      legendeMin.textContent = minV.toFixed(1);
      legendeMid.textContent = midV.toFixed(1);
      legendeMax.textContent = maxV.toFixed(1);
    }
  }

  function updatePhenomenes(scen) {
    var inset = document.getElementById("phenomenes-inset");
    var content = document.getElementById("phenomenes-content");
    var gwlSpan = document.getElementById("phenomenes-gwl");
    
    if (!inset || !content || !gwlSpan) return;
    
    if (scen === "REF" || phenomenesData.length === 0) {
      inset.style.display = "none";
      return;
    }
    
    var levelKey = "Impact à 1,5°C";
    var levelDisplay = "+1.5°C";
    if (scen === "GWL20" || scen === "GWL30") {
      levelKey = "Impact à 2°C";
      levelDisplay = "+2°C";
      if(scen === "GWL30") levelDisplay = "> +2°C"; // Fallback as 3C data is missing
    }
    
    gwlSpan.textContent = levelDisplay;
    gwlSpan.style.background = CARTE_CONFIG.scenarios[scen] || "var(--c-primary)";
    
    var html = "";
    phenomenesData.forEach(function(item) {
      if (item[levelKey]) {
        html += "<div style='background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:6px; border-left:3px solid " + (CARTE_CONFIG.scenarios[scen] || "var(--c-primary)") + ";'>" +
                  "<strong style='display:block; color:#ffcc00; font-size:0.9rem; margin-bottom:4px;'>" + item["Phénomène"] + "</strong>" +
                  "<span style='line-height:1.3; opacity:0.9;'>" + item[levelKey] + "</span>" +
                "</div>";
      }
    });
    content.innerHTML = html;
    inset.style.display = "block";
  }

  // ── Afficher une année ────────────────────────────────────────────────
  function afficherAnnee(annee, ind) {
    currentAnnee = annee;
    mapLoading.style.display = "block";

    var yr = parseInt(annee);
    var scen = yr >= 2079 ? "GWL30" : yr >= 2052 ? "GWL20" : yr >= 2037 ? "GWL15" : "REF";
    anneeVal.textContent = annee;
    anneeScen.textContent = scen;
    anneeScen.className = "annee-scenario badge-scenario badge-" + scen;
    
    updatePhenomenes(scen);

    return fetchAnnee(annee, ind)
      .then(function (data) {
        setHeat(data.points || [], ind);
        prefetch(annee, ind);
        if (currentHoveredPoint) {
            updateHoverValueOnly();
        }
      })
      .catch(function (e) { console.error("heatmap:", e); })
      .finally(function () { mapLoading.style.display = "none"; });
  }

  // ── Animation ─────────────────────────────────────────────────────────
  function startAnim() {
    isPlaying = true;
    btnPlay.classList.add("playing");
    btnPlay.innerHTML = "&#9646;&#9646; Pause";
    function step() {
      if (!isPlaying) return;
      var idx = (parseInt(sliderAnnee.value) + 1) % C.annees.length;
      sliderAnnee.value = idx;
      afficherAnnee(C.annees[idx], currentInd).then(function () {
        if (isPlaying) playTimer = setTimeout(step, parseInt(selSpeed.value));
      });
    }
    step();
  }

  function stopAnim() {
    isPlaying = false;
    clearTimeout(playTimer);
    playTimer = null;
    btnPlay.classList.remove("playing");
    btnPlay.innerHTML = "&#9654; Animer";
  }

  // ── Hover mailles & Graphique ─────────────────────────────────────────
  var globalPoints = [];
  var currentHoveredPoint = null;
  var hoverChart = null;
  var currentChartLatLon = null;

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
            label: "Évolution",
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

  function fetchChartData(lat, lon) {
    var keyLatLon = lat + "_" + lon + "_" + currentInd;
    if (currentChartLatLon === keyLatLon) return; // Prevent re-fetching same point
    currentChartLatLon = keyLatLon;
    
    // Fetch non-normalized data for all available years locally
    var labels = [];
    var dataY = [];
    var promises = C.annees.map(function(yr) {
      return fetch("/api/spatial/annee/" + yr + "?ind=" + currentInd + "&normalize=false")
        .then(function(r) { return r.json(); })
        .then(function(res) {
          var slot = res.points.find(function(p) { return p[0] === lat && p[1] === lon; });
          return { yr: yr, val: slot ? slot[2] : null };
        });
    });

    Promise.all(promises).then(function(results) {
      if (currentChartLatLon !== keyLatLon) return; // Point changed while fetching
      results.sort(function(a, b) { return parseInt(a.yr) - parseInt(b.yr); });
      results.forEach(function(r) {
        if (r.val !== null) {
          labels.push(r.yr);
          dataY.push(r.val);
        }
      });
      var lbl = C.labels[currentInd] || currentInd;
      var mu = lbl.match(/\(([^)]+)\)/);
      initOrUpdateChart(labels, dataY, mu ? mu[1] : "");
    });
  }

  function updateHoverValueOnly() {
    if (!currentHoveredPoint) return;
    var pt = currentHoveredPoint;
    fetch("/api/spatial/annee/" + currentAnnee + "?ind=" + currentInd + "&normalize=false")
      .then(function (r) { return r.json(); })
      .then(function (raw) {
        if (currentHoveredPoint !== pt) return;
        var slot = raw.points.find(function (p) { return p[0] === pt.lat && p[1] === pt.lon; });
        if (slot) {
          hoverSection.style.display = "block";
          var lbl = C.labels[currentInd] || currentInd;
          var mu = lbl.match(/\(([^)]+)\)/);
          hoverValue.textContent = slot[2].toFixed(2) + " " + (mu ? mu[1] : "");
          hoverCoords.textContent = pt.lat.toFixed(4) + "° N, " + pt.lon.toFixed(4) + "° E";
        }
      });
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
               currentHoveredPoint = pt;
               updateHoverValueOnly();
               fetchChartData(pt.lat, pt.lon);
            });
            // We consciously remove on('mouseout') so the graph stays visible 
            // and users can examine it after moving the mouse off the circle explicitly.
        });
      });
  }

  // ── Autocomplétion Nominatim ──────────────────────────────────────────
  var debounceTimer = null;
  var abortCtrl = null;
  var indexActif = -1;
  var suggsBrutes = [];
  var markerAdresse = null;

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
    
    // Find closest point and trigger chart
    if (globalPoints.length > 0) {
      var closest = null;
      var minDist = Infinity;
      globalPoints.forEach(function(p) {
        var d2 = Math.pow(p.lat - lat, 2) + Math.pow(p.lon - lon, 2);
        if (d2 < minDist) { minDist = d2; closest = p; }
      });
      if (closest) {
        currentHoveredPoint = closest;
        updateHoverValueOnly();
        fetchChartData(closest.lat, closest.lon);
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

  // ── Événements adresse ────────────────────────────────────────────────
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

  // ── Événements carte ──────────────────────────────────────────────────
  sliderAnnee.addEventListener("input", function () {
    afficherAnnee(C.annees[parseInt(sliderAnnee.value)], currentInd);
  });

  selInd.addEventListener("change", function () {
    currentInd = selInd.value;
    majLegende(currentInd);
    afficherAnnee(currentAnnee, currentInd);
  });

  selLayer.addEventListener("change", function () {
    map.removeLayer(tileLayer);
    var t = TILES[selLayer.value] || TILES.topo;
    tileLayer = L.tileLayer(t.url, { attribution: t.attr, maxZoom: t.maxZ }).addTo(map);
  });

  btnPlay.addEventListener("click", function () { isPlaying ? stopAnim() : startAnim(); });

  function updateHeatOpts() {
    if (radiusVal) radiusVal.textContent = sliderRadius.value;
    if (blurVal) blurVal.textContent = sliderBlur.value;
    if (opacityVal) opacityVal.textContent = parseFloat(sliderOpac.value).toFixed(2);
    if (heat) {
      heat.setOptions(heatOpts(currentInd, null));
      var c = heat._canvas;
      if (c) c.style.opacity = sliderOpac.value;
    }
  }
  sliderRadius.addEventListener("input", updateHeatOpts);
  sliderBlur.addEventListener("input", updateHeatOpts);
  sliderOpac.addEventListener("input", updateHeatOpts);

  // ── Init ──────────────────────────────────────────────────────────────
  majLegende(currentInd);
  afficherAnnee(currentAnnee, currentInd);
  chargerPoints();
  
  fetch("/api/phenomenes")
    .then(function(r) { return r.json(); })
    .then(function(d) { phenomenesData = d; });

})();
import json
import math
import logging
import os
from pathlib import Path
from flask import Flask, render_template, jsonify, request
from flask import Flask, render_template, jsonify, request
import ollama

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)
DATA_DIR = Path(__file__).resolve().parent / "data"
_cache = {}


def get_data(key):
    if key not in _cache:

        # phenomenes.json is directly in data/, while others are sometimes generated. 
        # But for robustness we just allow any JSON file in DATA_DIR.
        path = DATA_DIR / f"{key}.json"
        if not path.exists():
            raise FileNotFoundError(f"Fichier manquant : {path}")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
            
        if key == "tracc_spatial":
            for ind, plage in data.get("plages", {}).items():
                vals = []
                for slots in data.get("annees", {}).values():
                    for slot in slots:
                        if slot and ind in slot and slot[ind] is not None:
                            vals.append(slot[ind])
                if vals:
                    vals.sort()
                    plage["p10"] = vals[int(len(vals) * 0.1)]
                    plage["p90"] = vals[int(len(vals) * 0.9)]
                    
        _cache[key] = data
    return _cache[key]


@app.route("/health")
def health():
    status = {}
    for key in ("tracc_data", "tracc_meta", "tracc_spatial", "phenomenes", "implications"):
        path = DATA_DIR / f"{key}.json"
        status[key] = {"ok": path.exists()}
    all_ok = all(v["ok"] for v in status.values())
    return jsonify({"status": "ok" if all_ok else "error", "files": status}), 200 if all_ok else 500


@app.route("/evolution")
def evolution():
    meta   = get_data("tracc_meta")
    data   = get_data("tracc_data")
    annees = sorted(set(d["Annee"] for d in data))
    return render_template("evolution.html", meta=meta, annees=annees, page="evolution")


@app.route("/recommandations")
def recommandations():
    return render_template("recommandations.html", page="recommandations")


@app.route("/comparateur")
def comparateur():
    meta = get_data("tracc_meta")
    spatial = get_data("tracc_spatial")
    return render_template(
        "comparateur.html", 
        meta=meta, 
        annees_disponibles=spatial["annees_disponibles"],
        page="comparateur"
    )


@app.route("/statistiques")
def statistiques():
    return render_template("statistiques.html", meta=get_data("tracc_meta"), page="statistiques")


@app.route("/predictions")
def predictions():
    meta = get_data("tracc_meta")
    if "units" not in meta:
        meta["units"] = {}
    return render_template("predictions.html", meta=meta, page="predictions")


@app.route("/")
@app.route("/carte")
def carte():
    meta    = get_data("tracc_meta")
    spatial = get_data("tracc_spatial")
    return render_template(
        "carte.html",
        meta=meta,
        annees_disponibles=spatial["annees_disponibles"],
        annee_min=spatial["annees_disponibles"][0],
        annee_max=spatial["annees_disponibles"][-1],
        page="carte",
    )

@app.route("/carte_ml")
def carte_ml():
    meta = get_data("tracc_meta")
    # Pour la carte ML, l'échelle temporelle est de 2006 à 2100 
    # conformément au tracc_projections_2100.
    annees_ml = [str(y) for y in range(2006, 2101)]
    return render_template(
        "carte_ml.html",
        meta=meta,
        annees_disponibles=annees_ml,
        annee_min="2006",
        annee_max="2100",
        page="carte_ml",
    )


@app.route("/api/data")
def api_data():
    return jsonify(get_data("tracc_data"))


@app.route("/api/predictions")
def api_predictions():
    # Load projections specifically from the nested folder.
    # The default get_data() function only looks at data/*.json.
    path = DATA_DIR / "predictions" / "data" / "tracc_projections_2100.json"
    if not path.exists():
        return jsonify({"error": "Predictions data not found"}), 404
    with open(path, encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.json
    if not data or "messages" not in data:
        return jsonify({"error": "Invalid payload"}), 400

    messages_history = data["messages"]
    
    # Préparation du prompt système global
    system_prompt = "Tu es un assistant virtuel expert du climat en Bretagne. Ton rôle est de vulgariser les données climatiques et les recommandations pour le grand public. Sois bienveillant, clair, et concis."
    
    ollama_msgs = [{"role": "system", "content": system_prompt}]
    for msg in messages_history:
        ollama_msgs.append({"role": msg["role"], "content": msg["content"]})

    try:
        # Appel du modèle Llama local via Ollama
        chat_response = ollama.chat(
            model="llama3.2",
            messages=ollama_msgs,
        )
        return jsonify({"response": chat_response["message"]["content"]})
    except Exception as e:
        log.error(f"Erreur API Ollama: {e}")
        return jsonify({"error": f"Erreur de communication avec le modèle local: {e}"}), 500


@app.route("/api/meta")
def api_meta():
    return jsonify(get_data("tracc_meta"))


@app.route("/api/phenomenes")
def api_phenomenes():
    return jsonify(get_data("phenomenes"))


@app.route("/api/implications")
def api_implications():
    return jsonify(get_data("implications"))


@app.route("/api/spatial/points")
def api_spatial_points():
    spatial = get_data("tracc_spatial")
    return jsonify({
        "points":             spatial["points"],
        "plages":             spatial["plages"],
        "scenario_par_annee": spatial["scenario_par_annee"],
        "annees_disponibles": spatial["annees_disponibles"],
    })


@app.route("/api/spatial/annee/<annee>")
def api_spatial_annee(annee):
    spatial = get_data("tracc_spatial")
    if annee not in spatial["annees"]:
        return jsonify({"error": f"Année {annee} non disponible"}), 404

    ind       = request.args.get("ind", "TMm_yr")
    normalise = request.args.get("normalize", "true").lower() == "true"
    slots     = spatial["annees"][annee]
    points    = spatial["points"]
    plage     = spatial["plages"].get(ind, {})
    vmin      = plage.get("p10", plage.get("min", 0))
    vmax      = plage.get("p90", plage.get("max", 1))
    vrange    = vmax - vmin if vmax != vmin else 1

    result = []
    for i, slot in enumerate(slots):
        if slot is None or slot.get(ind) is None:
            continue
        val = slot[ind]
        pt  = points[i]
        if normalise:
            result.append([pt["lat"], pt["lon"], round(max(0.0, min(1.0, (val - vmin) / vrange)), 4)])
        else:
            result.append([pt["lat"], pt["lon"], val])

    return jsonify({
        "annee":      annee,
        "indicateur": ind,
        "points":     result,
        "plage":      plage,
        "scenario":   spatial["scenario_par_annee"].get(annee, "?"),
    })


for key in ("tracc_data", "tracc_meta", "tracc_spatial", "phenomenes", "implications"):
    try:
        get_data(key)
    except FileNotFoundError as e:
        log.error("ERREUR DÉMARRAGE : %s", e)

if __name__ == "__main__":
    port  = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
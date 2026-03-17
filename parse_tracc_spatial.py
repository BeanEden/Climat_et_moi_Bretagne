"""
parse_tracc_spatial.py
----------------------
Besoin : générer un JSON spatial utilisable par Leaflet pour la heatmap.
         Chaque entrée = un point géographique x une année x les 15 indicateurs.

Choix technique :
  - Structure orientée "par année" pour permettre un accès O(1) à la slice
    annuelle dans le JS de la carte (pas de filtre côté client à chaque frame).
  - Union des grilles REF (347 pts) + GWL (426 pts) : les 79 points manquants
    en REF reçoivent null, Leaflet.heat les ignore.
  - JSON compact (séparateurs sans espaces) pour minimiser la taille (~8-10 MB).

Sortie :
  data/tracc_spatial.json  — { "points": [...], "annees": { "1976": [...], ... } }
  Chaque slot "annees[yr]" est une liste parallèle à "points" :
  [ { "TMm_yr": 11.3, "TX30D_yr": 0, ... } | null, ... ]
"""

import json
from pathlib import Path
from collections import defaultdict

FICHIERS = [
    "/mnt/user-data/uploads/TRACC_Bretagne_1976-2005.txt",
    "/mnt/user-data/uploads/TRACC_Bretagne_2037-2056.txt",
    "/mnt/user-data/uploads/TRACC_Bretagne_2052-2071.txt",
    "/mnt/user-data/uploads/TRACC_Bretagne_2079-2098.txt",
]

COLONNES_BASE = [
    "Point", "Latitude", "Longitude", "Niveau", "Annee",
    "TMm_yr", "TMm_seas_JJA", "TMm_seas_DJF", "TXm_seas_JJA",
    "TX35D_yr", "TX30D_yr", "TR_yr",
    "RR_yr", "RR_seas_JJA", "RR_seas_DJF",
    "RRq99_yr", "Rx1d_yr", "RRq99refD_yr",
    "IFM40_yr", "SWI04_yr",
]
INDICATEURS = COLONNES_BASE[5:]


def parse_fichier(chemin: str) -> dict:
    """
    Retourne { (point_id, annee): {ind: val, ...}, ... }
    et { point_id: (lat, lon) }
    """
    enregistrements = {}
    coords = {}

    with open(chemin, encoding="latin-1") as f:
        for ligne in f:
            ligne = ligne.strip()
            if not ligne or ligne.startswith("#"):
                continue
            champs = ligne.rstrip(";").split(";")
            if len(champs) < len(COLONNES_BASE):
                continue

            pid = champs[0]
            lat = float(champs[1])
            lon = float(champs[2])
            annee = int(champs[4])
            coords[pid] = (lat, lon)

            vals = {}
            for i, col in enumerate(INDICATEURS):
                try:
                    vals[col] = float(champs[5 + i])
                except (ValueError, IndexError):
                    vals[col] = None

            enregistrements[(pid, annee)] = vals

    return enregistrements, coords


def main():
    sortie = Path("/home/claude/data")
    sortie.mkdir(exist_ok=True)

    # 1. Lecture de tous les fichiers
    tous_enregs = {}   # (pid, annee) -> {ind: val}
    tous_coords = {}   # pid -> (lat, lon)

    for chemin in FICHIERS:
        print(f"Parsing {Path(chemin).name}...")
        enregs, coords = parse_fichier(chemin)
        tous_enregs.update(enregs)
        tous_coords.update(coords)

    # 2. Index des points (union de toutes les grilles, trié par lat/lon)
    points_tries = sorted(
        tous_coords.keys(),
        key=lambda pid: (tous_coords[pid][0], tous_coords[pid][1])
    )
    points_index = [
        {"id": pid, "lat": tous_coords[pid][0], "lon": tous_coords[pid][1]}
        for pid in points_tries
    ]

    # 3. Construction par année : liste parallèle à points_index
    annees_disponibles = sorted(set(annee for (_, annee) in tous_enregs.keys()))
    par_annee = {}

    for annee in annees_disponibles:
        slots = []
        for pt in points_index:
            pid = pt["id"]
            cle = (pid, annee)
            if cle in tous_enregs:
                # Arrondir pour réduire la taille JSON
                vals = {k: round(v, 3) if v is not None else None
                        for k, v in tous_enregs[cle].items()}
                slots.append(vals)
            else:
                slots.append(None)  # point absent pour ce scénario/année
        par_annee[str(annee)] = slots

    # 4. Métadonnées de plage par indicateur (pour calibrer les légendes)
    print("Calcul des plages globales par indicateur...")
    plages = {}
    for ind in INDICATEURS:
        valeurs = [
            v[ind]
            for v in tous_enregs.values()
            if v.get(ind) is not None
        ]
        if valeurs:
            plages[ind] = {
                "min": round(min(valeurs), 3),
                "max": round(max(valeurs), 3),
                "p05": round(sorted(valeurs)[int(len(valeurs) * 0.05)], 3),
                "p95": round(sorted(valeurs)[int(len(valeurs) * 0.95)], 3),
            }

    # 5. Scénario par année
    scenario_par_annee = {}
    niveaux_map = {
        range(1976, 2006): "REF",
        range(2037, 2057): "GWL15",
        range(2052, 2072): "GWL20",
        range(2079, 2099): "GWL30",
    }
    for annee in annees_disponibles:
        for plage, niv in niveaux_map.items():
            if annee in plage:
                scenario_par_annee[str(annee)] = niv
                break

    # 6. Écriture JSON compact
    resultat = {
        "points": points_index,
        "annees": par_annee,
        "plages": plages,
        "scenario_par_annee": scenario_par_annee,
        "annees_disponibles": [str(a) for a in annees_disponibles],
    }

    chemin_sortie = sortie / "tracc_spatial.json"
    with open(chemin_sortie, "w", encoding="utf-8") as f:
        json.dump(resultat, f, separators=(",", ":"), ensure_ascii=False)

    taille = chemin_sortie.stat().st_size / (1024 * 1024)
    print(f"\nOK — {len(points_index)} points, {len(annees_disponibles)} années")
    print(f"Sortie : {chemin_sortie} ({taille:.1f} MB)")


if __name__ == "__main__":
    main()

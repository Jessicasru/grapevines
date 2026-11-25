"""Shared settings for the region data builds: sources, region rules and downloads."""

import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
CACHE = DATA / ".cache"

# Pinned source files, so a rebuild gives the same result until we choose to update them.
INAO_PARCELS = "https://static.data.gouv.fr/resources/delimitation-parcellaire-des-aoc-viticoles-de-linao/20261109-223939/2026-11-09-delim-parcellaire-aoc-shp.zip"
INAO_AREAS = "https://static.data.gouv.fr/resources/delimitation-des-aires-geographiques-des-siqo/20261109-223413/2026-11-09-delim-aire-geographique-shp.zip"
OVERTURE_RELEASE = "2026-11-18.0"
DATATOURISME = "https://static.data.gouv.fr/resources/datatourisme-la-plateforme-nationale-des-donnees-touristiques/{}"
DATATOURISME_FILES = {
    "gde": "20261125-035833/datatourisme-reg-gde.csv",  # Grand Est
    "hdf": "20261125-040058/datatourisme-reg-hdf.csv",  # Hauts-de-France
    "idf": "20261125-040152/datatourisme-reg-idf.csv",  # Île-de-France
    "bfc": "20261125-035511/datatourisme-reg-bfc.csv",  # Bourgogne-Franche-Comté
    "pdl": "20261125-040838/datatourisme-reg-pdl.csv",  # Pays de la Loire
    "cvl": "20261125-035731/datatourisme-reg-cvl.csv",  # Centre-Val de Loire
    "naq": "20261125-040444/datatourisme-reg-naq.csv",  # Nouvelle-Aquitaine
    "ara": "20261125-035407/datatourisme-reg-ara.csv",  # Auvergne-Rhône-Alpes
    "pac": "20261125-040741/datatourisme-reg-pac.csv",  # Provence-Alpes-Côte d'Azur
    "occ": "20261125-040647/datatourisme-reg-occ.csv",  # Occitanie
}

# Beaujolais is its own region, so its appellations stay out of Bourgogne.
BEAUJOLAIS = {
    "Beaujolais", "Brouilly", "Chénas", "Chiroubles", "Côte de Brouilly", "Fleurie",
    "Juliénas", "Morgon", "Moulin-à-Vent", "Régnié", "Saint-Amour",
}

# Most regions are INAO's AOC vineyard parcels, picked by INAO office ("dt") and
# department. Only wine parcels count: the file also holds Camargue beef and a pear.
REGIONS = {
    "bourgogne": {
        "name": "Bourgogne",
        # Côte-d'Or and Saône-et-Loire, minus Beaujolais. The Yonne is Chablis.
        "parcels": {"offices": {"Dijon", "Mâcon"}, "departments": {"21", "71"}, "exclude": BEAUJOLAIS},
        "datatourisme": ["bfc"],
    },
    "chablis": {
        "name": "Chablis",
        # Every vineyard in the Yonne: Chablis, and the Auxerrois, Irancy, Saint-Bris, Vézelay.
        "parcels": {"offices": {"Dijon"}, "departments": {"89"}},
        "datatourisme": ["bfc"],
    },
    "loire": {
        "name": "Loire",
        # Muscadet to Sancerre, and the upper Loire (Saint-Pourçain, Côte roannaise, Auvergne).
        "parcels": {"offices": {"Angers", "Tours"}, "departments": {
            "03", "18", "36", "37", "41", "42", "44", "45", "49", "58", "63", "72", "79", "85", "86"}},
        "datatourisme": ["pdl", "cvl", "naq", "bfc", "ara"],
    },
    "bordeaux": {
        "name": "Bordeaux",
        # The Gironde. Bergerac, Duras and Buzet share INAO's Bordeaux office but are South-West.
        "parcels": {"offices": {"Bordeaux"}, "departments": {"33"}},
        "datatourisme": ["naq"],
    },
    "rhone": {
        "name": "Rhône",
        # North and south, with Costières de Nîmes, the Diois, Ventoux and Luberon.
        "parcels": {"offices": {"Avignon", "Valence"}},
        "datatourisme": ["ara", "pac", "occ"],
    },
    "languedoc": {
        "name": "Languedoc",
        # Aude, Hérault and Gard (plus Camargue sand wines), without Roussillon.
        "parcels": {"offices": {"Montpellier", "Narbonne"}, "departments": {"11", "13", "30", "34"}},
        "datatourisme": ["occ", "pac"],
    },
    "provence": {
        "name": "Provence",
        # INAO has no parcel map for Cassis or Bellet.
        "parcels": {"offices": {"La Valette du Var"}},
        "datatourisme": ["pac"],
    },
    "champagne": {
        "name": "Champagne",
        # INAO has no parcel map for Champagne, so we use OpenStreetMap vineyards
        # inside INAO's geographic area for the Champagne appellation.
        "inao_area_denomination": 55,
        "datatourisme": ["gde", "hdf", "idf"],
        # Houses are named "Champagne <producer>". The Aisne lists them as shops, not tastings.
        "datatourisme_shop_prefix": "champagne ",
    },
}
# Wineries count for a region within this distance of its outline, as in the database.
REGION_MARGIN_METRES = 2000


def download(url: str, name: str) -> pathlib.Path:
    """Download once into data/.cache, resuming and retrying on dropped connections."""
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / name
    if target.exists():
        return target
    partial = target.with_suffix(target.suffix + ".part")
    for attempt in range(12):
        try:
            done = partial.stat().st_size if partial.exists() else 0
            request = urllib.request.Request(url, headers={"Range": f"bytes={done}-"} if done else {})
            with urllib.request.urlopen(request, timeout=300) as response, open(partial, "ab" if done else "wb") as out:
                if done and response.status != 206:
                    out.truncate(0)
                while chunk := response.read(1 << 20):
                    out.write(chunk)
            partial.rename(target)
            return target
        except OSError as error:
            print(f"Download failed ({error}); retrying")
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Could not download {url}")

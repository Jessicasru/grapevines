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
}

# Beaujolais is its own region, so its appellations stay out of Bourgogne.
BEAUJOLAIS = {
    "Beaujolais", "Brouilly", "Chénas", "Chiroubles", "Côte de Brouilly", "Fleurie",
    "Juliénas", "Morgon", "Moulin-à-Vent", "Régnié", "Saint-Amour",
}

# Every visitor downloads all outlines, so each should stay near the size of the Alsace
# one (about 35,000 points). Alsace matches INAO simplified by 8 m with no gaps merged.
REGIONS = {
    "bourgogne": {
        "name": "Bourgogne",
        # Every AOC vineyard parcel in Côte-d'Or, Saône-et-Loire and Yonne, minus Beaujolais.
        "departments": {"21", "71", "89"},
        # Bourgogne has about 7,000 scattered parcels. Joining parcels split only by a
        # lane (gaps under 30 m) leaves about 700 areas and adds 3% to the area.
        "merge_gaps_metres": 15,
        "simplify_metres": 15,
        "datatourisme": ["bfc"],
    },
    "champagne": {
        "name": "Champagne",
        # INAO has no parcel map for Champagne, so we use OpenStreetMap vineyards
        # inside INAO's geographic area for the Champagne appellation.
        "inao_area_denomination": 55,
        "merge_gaps_metres": 0,
        "simplify_metres": 8,
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

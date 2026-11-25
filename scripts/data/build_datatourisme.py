"""Build the DATAtourisme winery files for the admin CSV import.

Writes data/datatourisme/<region>.csv to import, and <region>-left-out.csv with the
places the rule dropped, so a person can check them. Run build_boundaries.py first.

Which places count, within 2 km of the region outline:
1. Every "TastingProvider" except breweries, the rule behind the Alsace import.
2. In Champagne, also shops named "Champagne ...": the Aisne lists its houses as shops.
Then other local produce is left out, since tourism offices also list honey, cheese and
olive-oil farms as tastings. In order, the first signal decides:
- a clear wine word in the name (vin, vigneron, champagne): keep;
- another product in the name (Miellerie, Huilerie, Distillerie): leave out;
- a general word in the name (domaine, château, cave), or tagged as a cellar: keep;
- a wine word in the description: keep; another product there: leave out;
- no signal (often a family name with no description): keep, unless it is a
  local-products shop.
In Alsace this keeps 657 of the 661 imported places; the other 4 are distilleries.

Usage: python scripts/data/build_datatourisme.py [region ...]
"""

import collections
import csv
import html
import json
import re
import sys
import unicodedata

import numpy as np
import shapely
from pyproj import Transformer

from regions import DATA, DATATOURISME, DATATOURISME_FILES, REGION_MARGIN_METRES, REGIONS, download

COLUMNS = ["source_id", "name", "latitude", "longitude", "website", "address", "postcode", "locality",
           "description", "category", "data_creator", "source_updated", "possible_duplicate"]
SHOPS = {"Store", "CraftsmanShop", "LocalProductsShop"}
# Words in a name. Strong ones say wine; weak ones (domaine, château, clos, cave) also
# name honey or olive-oil farms, so another product in the name outranks them.
STRONG_WINE_IN_NAME = re.compile(
    r"champagne|\bvins?\b|vign|viti|caveau|cellier|cr[ée]mant|chablis|ratafia|cuv[ée]e|wine|"
    r"n[ée]goc|coteaux|riceys|\bcru\b", re.I)
WEAK_WINE_IN_NAME = re.compile(r"\bcaves?\b|domaine|ch[âa]teau|\bclos\b|bourgogne|r[ée]coltant", re.I)
# "vignoble" alone is left out of the description words: it often just says where a farm is.
WINE_IN_TEXT = re.compile(
    r"\bvins?\b|viticult|vigneron|caveau|cuv[ée]es?|\bchampagnes\b|maison de champagne|wine|"
    r"c[ée]pages?|millésim|nos vignes|notre vignoble|\bAOC\b", re.I)
# Word starts only: "Olivier" is a first name and Echevronne a wine village.
OTHER_PRODUCE = re.compile(
    r"\b(?:miel|miell|apicult|ruch|fromag|ch[èe]vr|brebis|escargot|cassis|moutard|chocolat|brasserie|"
    r"bi[èe]res?\b|distill|liqueur|spiritueux|whisky|gin\b|huile|ol[ée]icol|truff|confitur|ferme\b|"
    r"fermier|mara[îi]ch|l[ée]gumes|volaille|viande|cochon|porc\b|charcut|vinaigr|biscuit|p[âa]tisser|"
    r"boulang|cidr|jus de pomme|lavande|savon|nougat|calisson|glaces?\b|safran|caf[ée]\b|torréf|"
    r"p[âa]tes\b|farine|c[ée]r[ée]ales|amande|noix|noisette|plantes aromatiques|tisane|sorbet|poisson|"
    r"caviar|foie gras|herboris|pépini)", re.I)
TO_LAMBERT = Transformer.from_crs(4326, 2154, always_xy=True)
csv.field_size_limit(1 << 30)


def outline_area(key):
    """The region outline in metres, widened by the database's 2 km, less 20 m.

    PostGIS draws the 2 km a little differently, so a place right at the edge could be
    in the file but skipped on import."""
    feature = json.loads((DATA / "boundaries" / f"{key}.geojson").read_text())["features"][0]
    outline = shapely.geometry.shape(feature["geometry"])
    outline = shapely.transform(outline, lambda c: np.column_stack(TO_LAMBERT.transform(c[:, 0], c[:, 1])))
    area = outline.buffer(REGION_MARGIN_METRES - 20)
    shapely.prepare(area)
    return area


def categories(row):
    return {c.rsplit("#", 1)[-1] for c in row["Categories_de_POI"].split("|")}


def is_candidate(row, kinds, rule):
    if "TastingProvider" in kinds:
        return "Brewery" not in kinds
    prefix = rule.get("datatourisme_shop_prefix")
    return bool(prefix and kinds & SHOPS and row["Nom_du_POI"].lower().startswith(prefix))


def is_wine(row, kinds):
    name, text = row["Nom_du_POI"], row["Description"]
    for keep, pattern in [(True, STRONG_WINE_IN_NAME), (False, OTHER_PRODUCE), (True, WEAK_WINE_IN_NAME)]:
        if pattern.search(name):
            return keep
    if "Cellar" in kinds:
        return True
    for keep, pattern in [(True, WINE_IN_TEXT), (False, OTHER_PRODUCE)]:
        if pattern.search(text):
            return keep
    return "LocalProductsShop" not in kinds


def first_website(contacts):
    """Contacts look like "Name#http://site|Name#http://site"."""
    for contact in contacts.split("|"):
        for part in contact.split("#"):
            if part.startswith(("http://", "https://")):
                return part
    return ""


def simple(text):
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower().strip()


def to_row(row, kinds):
    postcode, _, locality = row["Code_postal_et_commune"].partition("#")
    clean = lambda text: html.unescape(text).strip()
    return {
        "source_id": row["URI_ID_du_POI"],
        "name": clean(row["Nom_du_POI"]),
        "latitude": row["Latitude"],
        "longitude": row["Longitude"],
        "website": first_website(row["Contacts_du_POI"]),
        "address": clean(row["Adresse_postale"]),
        "postcode": postcode.strip(),
        "locality": clean(locality),
        "description": clean(row["Description"]),
        "category": "Cellar" if "Cellar" in kinds else "TastingProvider" if "TastingProvider" in kinds else "Shop",
        "data_creator": row["Createur_de_la_donnee"],
        "source_updated": row["Date_de_mise_a_jour"],
    }


def write(path, rows):
    with open(path, "w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, COLUMNS)
        writer.writeheader()
        writer.writerows(sorted(rows, key=lambda r: r["source_id"]))


def build(key):
    rule = REGIONS[key]
    area = outline_area(key)
    kept, left_out = {}, {}
    for code in rule["datatourisme"]:
        path = download(DATATOURISME.format(DATATOURISME_FILES[code]), f"datatourisme-{code}.csv")
        with open(path, encoding="utf-8", newline="") as file:
            for row in csv.DictReader(file):
                kinds = categories(row)
                if not is_candidate(row, kinds, rule):
                    continue
                try:
                    lat, lng = float(row["Latitude"]), float(row["Longitude"])
                except ValueError:
                    continue
                if not area.contains(shapely.Point(*TO_LAMBERT.transform(lng, lat))):
                    continue
                (kept if is_wine(row, kinds) else left_out)[row["URI_ID_du_POI"]] = to_row(row, kinds)
    # A hint for the duplicate review: another row has the same name and website.
    same = collections.Counter((simple(r["name"]), simple(r["website"])) for r in kept.values())
    for r in [*kept.values(), *left_out.values()]:
        r["possible_duplicate"] = "yes" if same[(simple(r["name"]), simple(r["website"]))] > 1 else ""
    folder = DATA / "datatourisme"
    folder.mkdir(parents=True, exist_ok=True)
    write(folder / f"{key}.csv", kept.values())
    write(folder / f"{key}-left-out.csv", left_out.values())
    kinds = dict(collections.Counter(r["category"] for r in kept.values()))
    flagged = sum(1 for r in kept.values() if r["possible_duplicate"])
    print(f"{rule['name']}: {len(kept)} places {kinds}, {flagged} possible duplicates, {len(left_out)} left out")


if __name__ == "__main__":
    for region in sys.argv[1:] or list(REGIONS):
        build(region)

# Region data

Files to upload in /admin, and the scripts that build them. Nothing here is read by the
app; the database only changes when you upload a file.

## Files

| Region | Outline (`boundaries/`) | Places (`datatourisme/`) | Left out |
| --- | --- | --- | --- |
| Champagne | `champagne.geojson` | `champagne.csv`, 491 | 26 |
| Bourgogne | `bourgogne.geojson` | `bourgogne.csv`, 927 | 61 |
| Chablis | `chablis.geojson` | `chablis.csv`, 233 | 13 |
| Loire | `loire.geojson` | `loire.csv`, 599 | 79 |
| Bordeaux | `bordeaux.geojson` | `bordeaux.csv`, 494 | 20 |
| Rhône | `rhone.geojson` | `rhone.csv`, 923 | 231 |
| Languedoc | `languedoc.geojson` | `languedoc.csv`, 605 | 88 |
| Provence | `provence.geojson` | `provence.csv`, 595 | 199 |

Upload each outline at /admin/regions, then each CSV at /admin/import (source:
DATAtourisme), then run the OpenStreetMap import for each region. A winery belongs to the
nearest region outline within 2 km; anything farther away is skipped. The
`*-left-out.csv` files list places the rule dropped, to check by eye; they are not for
upload.

## What each region covers

- **Champagne:** the Champagne appellation area.
- **Bourgogne:** Côte-d'Or and Saône-et-Loire, without Beaujolais.
- **Chablis:** every vineyard in the Yonne: Chablis, the Auxerrois, Irancy, Saint-Bris, Vézelay.
- **Loire:** Muscadet to Sancerre, plus the upper Loire (Saint-Pourçain, Côte roannaise, Auvergne).
- **Bordeaux:** the Gironde. Bergerac, Duras and Buzet belong to the South-West.
- **Rhône:** north and south, with Costières de Nîmes, the Diois, Ventoux and Luberon.
- **Languedoc:** Aude, Hérault and Gard, without Roussillon.
- **Provence:** Côtes de Provence, Bandol, Aix, Varois, Les Baux, Palette. INAO has no
  parcel map for Cassis or Bellet.

## Sources

- **Outlines:** vineyards mapped in OpenStreetMap (from Overture Maps, ODbL), inside the
  land INAO assigns to the region's appellations (Licence Ouverte). INAO's parcel map
  alone shows land where vines may grow, up to five times the vines (Provence: 127,000
  ha against about 31,500 mapped). Champagne has no INAO parcel map, so it uses INAO's
  appellation area instead. The live Alsace outline is INAO's parcel map alone; it was
  made before this rule.
- **Size:** every visitor downloads every outline, so vineyards less than 200 m apart are
  joined, edges are simplified by 50 m, and areas under 1 ha are dropped. The outline is
  drawn strongly only when zoomed out. All eight together are 2.6 MB, about 0.6 MB as sent.
- **Places:** DATAtourisme regional files from data.gouv.fr (Licence Ouverte), published
  by ADN Tourisme. The rule behind the Alsace import: every "TastingProvider" except
  breweries; in Champagne also shops named "Champagne …", because the Aisne lists its
  houses as shops. Then other produce is left out (honey, cheese, olive oil, distilleries),
  using words in the name and description. `scripts/data/build_datatourisme.py` explains
  the order. In Alsace this keeps 657 of the 661 imported places; the other 4 are
  distilleries.

Source files are pinned in `scripts/data/regions.py`, so a rebuild gives the same result.

## Rebuild

```sh
python3 -m venv .venv && .venv/bin/pip install -r scripts/data/requirements.txt
.venv/bin/python scripts/data/build_boundaries.py     # about 8 minutes, 4 GB of memory
.venv/bin/python scripts/data/build_datatourisme.py
```

Both take region keys (`loire rhone`) to build only some. Downloads, about 700 MB, are
kept in `data/.cache/`, which git ignores.

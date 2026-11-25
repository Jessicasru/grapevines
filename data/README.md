# Region data

Files to upload in /admin, and the scripts that build them. Nothing here is read by the
app; the database only changes when you upload a file.

## Files

| File | Upload at | What it is |
| --- | --- | --- |
| `boundaries/champagne.geojson` | /admin/regions, Champagne | Champagne vineyards |
| `boundaries/bourgogne.geojson` | /admin/regions, Bourgogne | Bourgogne vineyards |
| `datatourisme/champagne.csv` | /admin/import, CSV, DATAtourisme | 492 places to visit |
| `datatourisme/bourgogne.csv` | /admin/import, CSV, DATAtourisme | 1,176 places to visit |
| `datatourisme/*-left-out.csv` | nowhere | Places the rule dropped, to check by eye |

Upload the outlines before the CSV files. A winery belongs to the nearest region outline
within 2 km; anything farther away is skipped.

## Sources

- **Bourgogne outline:** INAO, AOC vineyard parcels in Côte-d'Or, Saône-et-Loire and Yonne,
  without Beaujolais. The Alsace outline came from the same INAO file.
  Licence Ouverte.
- **Champagne outline:** INAO has no parcel map for Champagne. The outline is
  OpenStreetMap vineyards (from Overture Maps, ODbL) inside INAO's area for the Champagne
  appellation: 36,600 ha, against about 34,000 ha planted.
- **Places:** DATAtourisme regional files from data.gouv.fr (Licence Ouverte), published
  by ADN Tourisme. The rule is the one that gives exactly the Alsace import: every
  "TastingProvider" except breweries. In Champagne it also takes shops named
  "Champagne …", because the Aisne lists its houses as shops. Then it leaves out places
  that look like other local produce (honey, cheese, mustard): a place stays if it is a
  wine cellar, is not a local-products shop, or mentions wine.

Source files are pinned in `scripts/data/regions.py`, so a rebuild gives the same result.

## Rebuild

```sh
python3 -m venv .venv && .venv/bin/pip install -r scripts/data/requirements.txt
.venv/bin/python scripts/data/build_boundaries.py     # about 2 minutes, downloads 360 MB
.venv/bin/python scripts/data/build_datatourisme.py
```

Downloads are kept in `data/.cache/`, which git ignores.

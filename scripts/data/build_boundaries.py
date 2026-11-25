"""Build the wine-area outlines for the map: data/boundaries/<region>.geojson.

An outline is the vineyards mapped in OpenStreetMap (read from Overture's land-use files)
inside the region's appellations. INAO's AOC parcel map says which land belongs to which
appellation, but it shows land where vines may grow: in Provence 127,000 ha against about
27,000 ha of vines. Champagne has no INAO parcel map, so it uses INAO's geographic area.

Every visitor downloads every outline, so each is kept small with one rule: vineyards less
than 200 m apart are joined, edges are simplified by 50 m, and areas under 1 ha are
dropped. The outline is drawn strongly only when zoomed out, where a pixel spans 100 m or
more, and faintly after that.

Usage: python scripts/data/build_boundaries.py [region ...]
"""

import collections
import datetime
import json
import os
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor

import duckdb
import numpy as np
import shapefile
import shapely
from pyproj import Transformer

from regions import CACHE, DATA, INAO_AREAS, INAO_PARCELS, OVERTURE_RELEASE, REGIONS, download

JOIN_GAPS_METRES = 100  # buffer out and back in by this much: joins gaps under 200 m
SIMPLIFY_METRES = 50
MIN_AREA_M2 = 10_000
TO_WGS84 = Transformer.from_crs(2154, 4326, always_xy=True)
TO_LAMBERT = Transformer.from_crs(4326, 2154, always_xy=True)
OSM_SOURCE = f"OpenStreetMap contributors, vineyards via Overture Maps {OVERTURE_RELEASE} (ODbL)"


def reproject(geometry, transformer):
    return shapely.transform(geometry, lambda c: np.column_stack(transformer.transform(c[:, 0], c[:, 1])))


def to_geometry(record_shape):
    """Shapefile polygon -> shapely. Clockwise rings are areas, counter-clockwise rings are holes.

    Some INAO shapes hold empty or orphaned rings, which the shapefile library rejects."""
    bounds = list(record_shape.parts) + [len(record_shape.points)]
    areas, holes = [], []
    for start, end in zip(bounds, bounds[1:]):
        ring = record_shape.points[start:end]
        if len(ring) < 4:
            continue
        polygon = shapely.Polygon(ring)
        if polygon.area == 0:
            continue
        (holes if shapely.LinearRing(ring).is_ccw else areas).append(polygon.buffer(0))
    return shapely.union_all(areas).difference(shapely.union_all(holes))


def inao_shapefile(url: str, name: str) -> shapefile.Reader:
    archive = download(url, name + ".zip")
    folder = CACHE / name
    if not folder.exists():
        zipfile.ZipFile(archive).extractall(folder)
    return shapefile.Reader(str(next(folder.glob("*.shp")).with_suffix("")))


def matches(rule, record):
    return (record["type_prod"] == "Vins" and record["dt"] in rule["offices"]
            and ("departments" not in rule or record["insee"][:2] in rule["departments"])
            and record["app"] not in rule.get("exclude", ()))


def appellation_land(keys):
    """Each region's AOC land in Lambert-93 metres, from one pass over INAO's files."""
    land = {}
    parcel_rules = {k: REGIONS[k]["parcels"] for k in keys if "parcels" in REGIONS[k]}
    if parcel_rules:
        parts = collections.defaultdict(list)
        for item in inao_shapefile(INAO_PARCELS, "inao-parcels").iterShapeRecords(fields=["dt", "app", "insee", "type_prod"]):
            for key, rule in parcel_rules.items():
                if matches(rule, item.record):
                    parts[key].append(to_geometry(item.shape))
        land.update({key: shapely.union_all(parts[key]) for key in parcel_rules})
    area_rules = {k: REGIONS[k]["inao_area_denomination"] for k in keys if "inao_area_denomination" in REGIONS[k]}
    if area_rules:
        for item in inao_shapefile(INAO_AREAS, "inao-areas").iterShapeRecords(fields=["id_denom"]):
            for key, denomination in area_rules.items():
                if item.record["id_denom"] == denomination:
                    land[key] = to_geometry(item.shape)
    return land


def vineyards(con, land):
    west, south, east, north = reproject(shapely.box(*land.bounds), TO_WGS84).bounds
    rows = con.execute(f"""
        SELECT ST_AsWKB(geometry)
        FROM read_parquet('s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=base/type=land_use/*', hive_partitioning=1)
        WHERE class = 'vineyard'
          AND bbox.xmax >= {west} AND bbox.xmin <= {east} AND bbox.ymax >= {south} AND bbox.ymin <= {north}
    """).fetchall()
    return shapely.union_all([reproject(shapely.from_wkb(bytes(r[0])), TO_LAMBERT).buffer(0) for r in rows])


def polygons(geometry):
    out = []
    for part in shapely.get_parts(geometry):
        if part.geom_type == "Polygon":
            out.append(part)
        elif part.geom_type in ("MultiPolygon", "GeometryCollection"):
            out.extend(polygons(part))
    return out


def write_outline(key, vines_wkb, sources):
    vines = shapely.from_wkb(vines_wkb)
    joined = vines.buffer(JOIN_GAPS_METRES, quad_segs=2).buffer(-JOIN_GAPS_METRES, quad_segs=2)
    simple = shapely.simplify(joined, SIMPLIFY_METRES, preserve_topology=True)
    kept = [p for p in polygons(simple) if p.area >= MIN_AREA_M2]
    outline = shapely.make_valid(shapely.set_precision(reproject(shapely.MultiPolygon(kept), TO_WGS84), 1e-5))
    outline = shapely.MultiPolygon(polygons(outline))
    if not outline.is_valid:
        raise RuntimeError(f"{key} outline is not valid")
    name = REGIONS[key]["name"]
    feature = {
        "type": "Feature",
        "properties": {"region": name, "sources": sources, "built": datetime.date.today().isoformat()},
        "geometry": json.loads(shapely.to_geojson(outline)),
    }
    target = DATA / "boundaries" / f"{key}.geojson"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"type": "FeatureCollection", "features": [feature]}, ensure_ascii=False, separators=(",", ":")))
    return (f"{name}: {vines.area / 1e4:,.0f} ha of vines, {len(outline.geoms)} areas, "
            f"{shapely.get_num_coordinates(outline)} points, {target.stat().st_size / 1e6:.2f} MB")


def main(keys):
    land = appellation_land(keys)
    # Overture's bucket is public; drop any AWS keys in the environment so DuckDB reads anonymously.
    for variable in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        os.environ.pop(variable, None)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    # Two at a time: the large regions need a few gigabytes each.
    with ProcessPoolExecutor(max_workers=2) as pool:
        jobs = []
        for key in keys:
            area = land.pop(key)
            vines = vineyards(con, area).intersection(area)
            inao = "INAO, Délimitation des aires géographiques des SIQO" if "inao_area_denomination" in REGIONS[key] \
                else "INAO, Délimitation parcellaire des AOC viticoles"
            jobs.append(pool.submit(write_outline, key, shapely.to_wkb(vines), [OSM_SOURCE, inao + " (Licence Ouverte)"]))
            del area, vines
        for job in jobs:
            print(job.result())


if __name__ == "__main__":
    main(sys.argv[1:] or list(REGIONS))

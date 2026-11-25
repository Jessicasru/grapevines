"""Build the wine-area outlines for the map: data/boundaries/<region>.geojson.

Bourgogne comes from INAO's AOC vineyard parcel map, the same source as the Alsace
outline. INAO has no parcel map for Champagne, so Champagne uses OpenStreetMap
vineyards (read from Overture's land-use files) inside INAO's Champagne area.

Usage: python scripts/data/build_boundaries.py [bourgogne] [champagne]
"""

import datetime
import json
import os
import sys
import zipfile

import duckdb
import numpy as np
import shapefile
import shapely
from pyproj import Transformer

from regions import BEAUJOLAIS, CACHE, DATA, INAO_AREAS, INAO_PARCELS, OVERTURE_RELEASE, REGIONS, download

TO_WGS84 = Transformer.from_crs(2154, 4326, always_xy=True)
TO_LAMBERT = Transformer.from_crs(4326, 2154, always_xy=True)


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


def bourgogne(rule):
    reader = inao_shapefile(INAO_PARCELS, "inao-parcels")
    parts = [
        to_geometry(item.shape)
        for item in reader.iterShapeRecords(fields=["app", "insee"])
        if item.record["insee"][:2] in rule["departments"] and item.record["app"] not in BEAUJOLAIS
    ]
    return shapely.union_all(parts), ["INAO, Délimitation parcellaire des AOC viticoles (Licence Ouverte)"]


def champagne(rule):
    reader = inao_shapefile(INAO_AREAS, "inao-areas")
    area = next(to_geometry(item.shape) for item in reader.iterShapeRecords(fields=["id_denom"])
                if item.record["id_denom"] == rule["inao_area_denomination"])
    west, south, east, north = reproject(area, TO_WGS84).bounds
    # Overture's bucket is public; drop any AWS keys in the environment so DuckDB reads anonymously.
    for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        os.environ.pop(key, None)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    rows = con.execute(f"""
        SELECT ST_AsWKB(geometry)
        FROM read_parquet('s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=base/type=land_use/*', hive_partitioning=1)
        WHERE class = 'vineyard'
          AND bbox.xmax >= {west} AND bbox.xmin <= {east} AND bbox.ymax >= {south} AND bbox.ymin <= {north}
    """).fetchall()
    vineyards = shapely.union_all([reproject(shapely.from_wkb(bytes(r[0])), TO_LAMBERT).buffer(0) for r in rows])
    return vineyards.intersection(area), [
        "OpenStreetMap contributors, vineyards via Overture Maps " + OVERTURE_RELEASE + " (ODbL)",
        "INAO, Délimitation des aires géographiques des SIQO, Champagne (Licence Ouverte)",
    ]


def polygons(geometry):
    parts = shapely.get_parts(geometry)
    out = []
    for part in parts:
        if part.geom_type == "Polygon":
            out.append(part)
        elif part.geom_type in ("MultiPolygon", "GeometryCollection"):
            out.extend(polygons(part))
    return out


def build(key):
    rule = REGIONS[key]
    merged, sources = {"bourgogne": bourgogne, "champagne": champagne}[key](rule)
    gap = rule["merge_gaps_metres"]
    if gap:
        merged = merged.buffer(gap, quad_segs=2).buffer(-gap, quad_segs=2)
    simple = shapely.simplify(merged, rule["simplify_metres"], preserve_topology=True)
    outline = reproject(shapely.MultiPolygon([p for p in polygons(simple) if not p.is_empty]), TO_WGS84)
    outline = shapely.make_valid(shapely.set_precision(outline, 1e-6))
    if not outline.is_valid or outline.geom_type != "MultiPolygon":
        raise RuntimeError(f"{rule['name']} outline is not a valid MultiPolygon")
    feature = {
        "type": "Feature",
        "properties": {"region": rule["name"], "sources": sources, "built": datetime.date.today().isoformat()},
        "geometry": json.loads(shapely.to_geojson(outline)),
    }
    target = DATA / "boundaries" / f"{key}.geojson"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"type": "FeatureCollection", "features": [feature]}, ensure_ascii=False, separators=(",", ":")))
    hectares = merged.area / 10_000
    print(f"{rule['name']}: {len(outline.geoms)} areas, {shapely.get_num_coordinates(outline)} points, "
          f"{hectares:,.0f} ha, {target.stat().st_size / 1e6:.2f} MB -> {target.relative_to(DATA.parent)}")


if __name__ == "__main__":
    for region in sys.argv[1:] or list(REGIONS):
        build(region)

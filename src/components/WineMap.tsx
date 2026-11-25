import type { Geometry } from "geojson";
import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap, GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Region, Winery } from "@/lib/wine";
import { wineCountries, type MapLocation, type MapBounds } from "@/lib/wine-countries";
import { detailCamera } from "@/lib/detail-camera";

// Public (pk.) token — safe in the browser. VITE_MAPBOX_TOKEN overrides it.
const PUBLIC_TOKEN =
  "pk.eyJ1IjoicnVsYW5kanMiLCJhIjoiY212MWJqaXNrMDJjMzJ6cXhhOXYxZmc3dSJ9.TQSoAXLi8KWxJegOIJCvtQ";

/** Compact comparison map, isolated from the public map's camera and carousel. */
export function WineryPairMap({ wineries }: { wineries: [Winery, Winery] }) {
  const container = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { rootMargin: '200px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let map: MapboxMap | undefined;
    let observer: ResizeObserver | undefined;
    import("mapbox-gl").then(({ default: mb }) => {
      if (cancelled || !container.current) return;
      mb.accessToken = (import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined) ?? PUBLIC_TOKEN;
      map = new mb.Map({ container: container.current, style: "mapbox://styles/rulandjs/cmv1eyamu005x01sgb49hdpjg", attributionControl: false, center: [wineries[0].longitude, wineries[0].latitude], zoom: 16 });
      map.addControl(new mb.AttributionControl({ compact: true, customAttribution: "© OpenStreetMap contributors · Overture Maps Foundation · DATAtourisme · INAO" }));
      const fit = () => {
        if (!map) return;
        map.resize();
        map.fitBounds([[Math.min(...wineries.map((w) => w.longitude)), Math.min(...wineries.map((w) => w.latitude))], [Math.max(...wineries.map((w) => w.longitude)), Math.max(...wineries.map((w) => w.latitude))]], { padding: 55, maxZoom: 18, duration: 0 });
      };
      observer = new ResizeObserver(fit);
      observer.observe(container.current);
      map.on('load', () => {
        if (!map) return;
        const styles = getComputedStyle(document.documentElement);
        map.addSource('pair', { type: 'geojson', data: { type: 'FeatureCollection', features: wineries.map((w, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [w.longitude,w.latitude] }, properties: { n: String(i+1) } })) } });
        const coincident = wineries[0].latitude === wineries[1].latitude && wineries[0].longitude === wineries[1].longitude;
        for (const n of [1,2]) {
          const translate: [number,number] = coincident ? [n === 1 ? -16 : 16,0] : [0,0];
          const filter = ['==',['get','n'],String(n)] as const;
          map.addLayer({ id: `pair-pin-${n}`, type: 'circle', source: 'pair', filter: [...filter], paint: { 'circle-radius': 13, 'circle-color': styles.getPropertyValue('--map-pin').trim(), 'circle-stroke-width': 2, 'circle-stroke-color': styles.getPropertyValue('--map-pin-foreground').trim(), 'circle-translate': translate } });
          map.addLayer({ id: `pair-number-${n}`, type: 'symbol', source: 'pair', filter: [...filter], layout: { 'text-field': ['get','n'], 'text-font': ['Open Sans Bold','Arial Unicode MS Bold'], 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': styles.getPropertyValue('--map-pin-foreground').trim(), 'text-translate': translate } });
        }
        fit();
      });
    }).catch(() => setFailure(true));
    return () => { cancelled = true; observer?.disconnect(); map?.remove(); };
  }, [wineries, visible]);
  return <div className="relative h-56 overflow-hidden rounded-lg border border-border bg-muted"><div ref={container} className="h-full w-full" aria-label="Map showing winery 1 and winery 2" />{failure && <p role="alert" className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Map unavailable</p>}</div>;
}

/** The opening camera includes quiet dots as well as recommendations. */
export function regionOpeningCamera(region: Region, wineries: Pick<Winery, "region_id" | "longitude" | "latitude">[]) {
  const points = wineries.filter((w) => w.region_id === region.id && Number.isFinite(w.longitude) && Number.isFinite(w.latitude));
  const coordinates = points.length ? points.map((w) => [w.longitude, w.latitude]) : [[region.center_lng, region.center_lat]];
  const lngs = coordinates.map((p) => p[0] ?? region.center_lng);
  const lats = coordinates.map((p) => p[1] ?? region.center_lat);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
  return { bounds, maxZoom: 11 };
}

export function openingMapPadding(width: number, carouselHeight = 180) {
  const desktop = width >= 1024;
  return { top: desktop ? 96 : 80, bottom: Math.max(220, carouselHeight + 40), left: desktop ? 64 : 32, right: desktop ? 96 : 64 };
}

export const immersiveRegionSettings = { pitch: 50, exaggeration: 1.3 };
export const worldBounds: MapBounds = [[-180, -50], [180, 60]];
export function pitchAtZoom(zoom: number) { return Math.max(0, Math.min(50, (zoom - 8) * 50)); }
export function regionMarkerFeatures(regions: Region[] | null | undefined) {
  return (regions ?? []).map((r) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [r.center_lng, r.center_lat] }, properties: { id: r.id, name: r.name } }));
}
function geometryBounds(geometry: Geometry): MapBounds | null {
  const points: number[][] = [];
  const collect = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") points.push(value as number[]);
    else value.forEach(collect);
  };
  if (geometry.type === "GeometryCollection") return null;
  collect(geometry.coordinates);
  if (!points.length) return null;
  return [[Math.min(...points.map((p) => p[0] ?? 0)), Math.min(...points.map((p) => p[1] ?? 0))], [Math.max(...points.map((p) => p[0] ?? 0)), Math.max(...points.map((p) => p[1] ?? 0))]];
}
// Contain every wine country, rather than cropping continents on tall screens.
export function worldOpeningZoom(width: number, height: number) {
  const mercatorY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
  const span = mercatorY(-50) - mercatorY(60);
  return Math.log2(Math.min((width - 32) / 512, (height - 112) / (512 * span)));
}
function worldZoom(map: MapboxMap) {
  return worldOpeningZoom(map.getContainer().clientWidth, map.getContainer().clientHeight);
}
function fitWorld(map: MapboxMap, duration = 0) {
  map.setTerrain(null);
  map.setProjection("mercator");
  map.setMinZoom(worldZoom(map));
  map.flyTo({ center: [0, 8.7], zoom: map.getMinZoom(), pitch: 0, bearing: 0, padding: 0, duration });
}

type Props = {
  regions: Region[];
  location: MapLocation;
  onLocationSelect: (location: MapLocation) => void;
  onZoomChange: (zoom: number) => void;
  onRegionSelect: (id: string) => void;
  wineries: Winery[];
  /** Unrecommended wineries: hidden in the overview, fading in from zoom 10. */
  baseWineries: Winery[];
  /** Wine-area polygons lead in the overview and fade as the user zooms in. */
  boundaries?: { id: string; geojson: Geometry }[] | undefined;
  /** When true, a map tap picks a location instead of selecting. */
  picking?: boolean;
  picked?: [number, number] | null;
  onPick?: (coords: [number, number]) => void;
  region: Region | null;
  selectedId: string | null;
  detailId: string | null;
  onSelect: (id: string | null) => void;
  onLocate: (coords: [number, number]) => void;
};

/** All Mapbox logic stays here, loaded only after hydration. */
export function WineMap({ location, onLocationSelect, onZoomChange, regions = [], onRegionSelect, wineries = [], baseWineries = [], boundaries, picking = false, picked = null, onPick, region, selectedId, detailId, onSelect, onLocate }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [ready, setReady] = useState(false);
  const [cameraReady, setCameraReady] = useState<string | null>(null);
  const token = (import.meta.env["VITE_MAPBOX_TOKEN"] as string | undefined) ?? PUBLIC_TOKEN;
  const latest = useRef({ wineries, region, onSelect, onLocate, picking, onPick, onRegionSelect, onLocationSelect, onZoomChange, regions, location });
  latest.current = { wineries, region, onSelect, onLocate, picking, onPick, onRegionSelect, onLocationSelect, onZoomChange, regions, location };
  const fittedRegion = useRef<string | null>(null);
  const previousCamera = useRef<{ center: [number, number]; zoom: number; bearing: number; pitch: number; padding: ReturnType<MapboxMap["getPadding"]> } | null>(null);
  const activeDetail = useRef<string | null>(null);
  const restoring = useRef(false);
  const detailRef = useRef(detailId);
  detailRef.current = detailId;

  useEffect(() => {
    if (!token || !container.current) return;
    let cancelled = false;
    let map: MapboxMap | undefined;
    const resize = () => {
      if (!map) return;
      map.resize();
      const oldMin = map.getMinZoom();
      const atWorld = map.getZoom() <= oldMin + 0.05;
      map.setMinZoom(worldZoom(map));
      if (atWorld) { fitWorld(map); return; }
      if (detailRef.current || restoring.current) return;
      const carousel = document.querySelector(".map-carousel")?.getBoundingClientRect();
      map.setPadding(openingMapPadding(map.getContainer().clientWidth, carousel?.height));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    const directory = document.querySelector(".map-carousel");
    if (directory) observer.observe(directory);
    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !container.current) return;
      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({
        container: container.current,
        style: "mapbox://styles/rulandjs/cmv1eyamu005x01sgb49hdpjg",
        attributionControl: false,
        projection: "mercator",
        renderWorldCopies: false,
        minZoom: 0,

        center: [0, 0],
        zoom: 0,
      });
      map.addControl(
        new mapboxgl.AttributionControl({
          compact: true,
          customAttribution: "© OpenStreetMap contributors · Overture Maps Foundation · DATAtourisme · INAO",
        }),
        "bottom-right",
      );
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      const locate = new mapboxgl.GeolocateControl({ trackUserLocation: false, showUserLocation: true });
      locate.on("geolocate", (e) => latest.current.onLocate([e.coords.longitude, e.coords.latitude]));
      map.addControl(locate, "top-right");
      mapRef.current = map;
      // Mapbox otherwise raises Mercator zoom to fill a portrait canvas, cropping continents.
      // Keep our own minimum zoom and center constraints while allowing a contained world.
      map.transform._allowWorldUnderZoom = true;
      resize();
      map.touchZoomRotate.enableRotation();
      map.on("load", () => {
        const m = map;
        if (!m || cancelled) return;
        m.setTerrain(null);
        m.setFog(null);
        const styles = getComputedStyle(document.documentElement);
        const burgundy = styles.getPropertyValue("--map-pin").trim();
        const paper = styles.getPropertyValue("--map-pin-foreground").trim();
        m.addSource("wineries", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 60,
        });
        const white = styles.getPropertyValue("--map-cluster").trim() || "#ffffff";
        const font = ["Open Sans Bold", "Arial Unicode MS Bold"];
        const empty = { type: "FeatureCollection" as const, features: [] };
        m.addSource("mapbox-dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
        m.addSource("wine-regions", { type: "geojson", data: empty });
        m.addSource("boundaries", { type: "geojson", data: empty });
        m.addSource("wine-countries", { type: "vector", url: "mapbox://mapbox.country-boundaries-v1" });
        const countryFilter = ["all", ["in", ["get", "iso_3166_1"], ["literal", wineCountries(latest.current.regions).map((c) => c.iso)]], ["any", ["==", ["get", "worldview"], "all"], ["==", ["get", "worldview"], "US"]]];
        m.addLayer({ id: "country-fill", type: "fill", source: "wine-countries", "source-layer": "country_boundaries", filter: countryFilter as never, paint: { "fill-color": burgundy, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.3, 3, 0.3, 4, 0] } });
        m.addLayer({ id: "country-line", type: "line", source: "wine-countries", "source-layer": "country_boundaries", filter: countryFilter as never, paint: { "line-color": burgundy, "line-width": 0.75, "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.7, 3, 0.7, 4, 0.15] } });
        m.addSource("country-labels", { type: "geojson", data: empty });
        m.addLayer({ id: "boundary-fill", type: "fill", source: "boundaries", minzoom: 3,
          paint: { "fill-color": burgundy, "fill-antialias": false, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0, 4, 0.3, 8, 0.3, 9, 0.06] } });
        m.addLayer({ id: "boundary-line", type: "line", source: "boundaries", minzoom: 3,
          paint: { "line-color": burgundy, "line-width": 0.75, "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0, 4, 0.6, 8, 0.6, 9, 0.4] } });
        // Base layer first so every burgundy pin and cluster draws above it.
        m.addSource("base", { type: "geojson", data: empty });
        m.addLayer({
          id: "base-dot", type: "circle", source: "base", minzoom: 8,
          paint: {
            "circle-color": styles.getPropertyValue("--map-base-dot").trim(),
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 12, 4, 14, 7],
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 1],
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 0, 13, 1.5],
            "circle-stroke-color": white,
          },
        });
        m.addSource("picked", { type: "geojson", data: empty });
        // No slot: these layers draw above every basemap label.
        m.addLayer({
          id: "clusters", minzoom: 8, type: "circle", source: "wineries",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": white,
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 1],
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 1],
            "circle-radius": 14,
            "circle-stroke-width": 2,
            "circle-stroke-color": burgundy,
          },
        });
        m.addLayer({
          id: "cluster-count", minzoom: 8, type: "symbol", source: "wineries",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["to-string", ["get", "point_count"]],
            "text-font": font,
            "text-size": 13,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: { "text-color": burgundy, "text-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 1] },
        });
        m.addLayer({
          id: "winery-shadow", minzoom: 8, type: "circle", source: "wineries",
          filter: ["!", ["has", "point_count"]],
          paint: { "circle-color": "#000000", "circle-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 0.18], "circle-blur": 0.6, "circle-radius": 17, "circle-translate": [0, 2] },
        });
        m.addLayer({
          id: "winery", minzoom: 8, type: "circle", source: "wineries",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": burgundy,
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 1],
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 1],
            "circle-radius": 12,
            "circle-stroke-width": 2,
            "circle-stroke-color": white,
          },
        });
        m.addLayer({
          id: "winery-number", minzoom: 8, type: "symbol", source: "wineries",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "text-field": ["get", "n"],
            "text-font": font,
            "text-size": 12,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: { "text-color": white, "text-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 1] },
        });
        m.addLayer({
          id: "picked-pin", type: "circle", source: "picked",
          paint: { "circle-color": burgundy, "circle-radius": 9, "circle-stroke-width": 3, "circle-stroke-color": white },
        });
        m.addLayer({ id: "region-name", type: "symbol", source: "wine-regions", minzoom: 3, maxzoom: 9, layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 14, "text-allow-overlap": true }, paint: { "text-color": burgundy, "text-halo-color": white, "text-halo-width": 2, "text-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0, 4, 1, 8, 1, 9, 0] } });
        // Standard's place-label switch includes country names, not just towns.
        // Preserve native country labels in the world view; quiet places across
        // the entire country fit range (capped at 6), then restore local labels.
        let placeLabelsShown: boolean | null = null;
        const syncPlaceLabels = (zoom: number) => {
          const show = zoom < 3 || zoom >= 7;
          if (show === placeLabelsShown) return;
          placeLabelsShown = show;
          m.setConfigProperty("basemap", "showPlaceLabels", show);
        };
        m.on("zoom", () => syncPlaceLabels(m.getZoom()));
        syncPlaceLabels(m.getZoom());
        for (const layer of ["region-name", "boundary-fill"]) m.on("click", layer, (e) => {
          if (m.getZoom() >= 9) return;
          const id = e.features?.[0]?.properties?.["id"];
          if (typeof id === "string") latest.current.onLocationSelect({ kind: "region", id });
        });
        for (const layer of ["country-fill"]) m.on("click", layer, (e) => {
          if (m.getZoom() >= 4) return;
          const properties = e.features?.[0]?.properties;
          const country = wineCountries(latest.current.regions).find((c) => c.iso === properties?.["iso_3166_1"] || c.name === properties?.["name"]);
          if (country) latest.current.onLocationSelect({ kind: "country", name: country.name });
        });
        for (const layer of ["country-fill", "boundary-fill", "region-name"]) {
          m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
          m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
        }
        let pitchFrame = 0;
        let automaticPitch = false;
        m.on("zoom", () => {
          latest.current.onZoomChange(m.getZoom());
          if (automaticPitch || detailRef.current || restoring.current) return;
          cancelAnimationFrame(pitchFrame);
          pitchFrame = requestAnimationFrame(() => {
            if (cancelled || detailRef.current || restoring.current) return;
            const pitch = pitchAtZoom(m.getZoom());
            const terrain = m.getTerrain();
            // With terrain, zoom changes can alter altitude and emit zoom again.
            // Never chase those altitude adjustments with another pitch update.
            if (pitch > 0 && !terrain) m.setTerrain({ source: "mapbox-dem", exaggeration: 1.3 });
            if (pitch === 0 && terrain) m.setTerrain(null);
            if (!m.isMoving() && Math.abs(m.getPitch() - pitch) > 0.1) m.setPitch(pitch);
          });
        });
        m.on("zoomend", () => {
          if (automaticPitch || detailRef.current || restoring.current) return;
          const pitch = pitchAtZoom(m.getZoom());
          if (Math.abs(m.getPitch() - pitch) > 0.1) {
            automaticPitch = true;
            m.easeTo({ pitch, duration: 300 });
            window.setTimeout(() => { automaticPitch = false; }, 350);
          }
        });
        m.on("moveend", () => {
          const center = m.getCenter();
          const lat = Math.max(-50, Math.min(60, center.lat));
          const lng = Math.max(-180, Math.min(180, center.lng));
          if (lat !== center.lat || lng !== center.lng) m.jumpTo({ center: [lng, lat] });
        });
        latest.current.onZoomChange(m.getZoom());
        void paper;
        m.on("click", "clusters", (e) => {
          const feature = m.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0] as unknown as { geometry: { type: string; coordinates: [number, number] }; properties?: { cluster_id?: number } } | undefined;
          if (!feature || feature.geometry.type !== "Point") return;
          const coordinates = feature.geometry.coordinates as [number, number];
          const source = m.getSource("wineries") as GeoJSONSource;
          source.getClusterExpansionZoom(Number(feature.properties?.cluster_id), (err, zoom) => {
            if (!err && zoom != null) m.easeTo({ center: coordinates, zoom });
          });
        });
        m.on("click", "base-dot", (e) => {
          if (latest.current.picking) return;
          const hit = m.queryRenderedFeatures(e.point, { layers: ["winery", "clusters"] });
          if (hit.length) return;
          const id = (e.features?.[0] as unknown as { properties?: { id?: string } } | undefined)?.properties?.id;
          if (id) latest.current.onSelect(String(id));
        });
        m.on("click", "winery", (e) => {
          if (latest.current.picking) return;
          const feature = e.features?.[0] as unknown as { properties?: { id?: string } } | undefined;
          const id = feature?.properties?.id;
          if (id) latest.current.onSelect(String(id));
        });
        for (const layer of ["clusters", "winery", "base-dot"]) {
          m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
        }
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      map?.remove();
      mapRef.current = null;
      fittedRegion.current = null;

    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("wine-regions") as GeoJSONSource | undefined;
    if (!ready || !source) return;
    source.setData({ type: "FeatureCollection", features: regionMarkerFeatures(regions) });
    const countries = wineCountries(regions);
    const filter = ["all", ["in", ["get", "iso_3166_1"], ["literal", countries.map((c) => c.iso)]], ["any", ["==", ["get", "worldview"], "all"], ["==", ["get", "worldview"], "US"]]];
    for (const layer of ["country-fill", "country-line"]) map?.setFilter(layer, filter as never);
  }, [regions, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("wineries") as GeoJSONSource | undefined;
    if (!ready || !map || !source) return;
    source.setData({
      type: "FeatureCollection",
      features: wineries.map((w, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [w.longitude, w.latitude] },
        properties: { id: w.id, n: String(i + 1) },
      })),
    });
  }, [wineries, ready]);

  useEffect(() => {
    const source = mapRef.current?.getSource("boundaries") as GeoJSONSource | undefined;
    if (!ready || !source) return;
    source.setData({
      type: "FeatureCollection",
      features: (boundaries ?? []).map((b) => ({ type: "Feature", geometry: b.geojson, properties: { id: b.id } })),
    });
  }, [boundaries, ready]);

  useEffect(() => {
    const source = mapRef.current?.getSource("base") as GeoJSONSource | undefined;
    if (!ready || !source) return;
    source.setData({
      type: "FeatureCollection",
      features: baseWineries.map((w) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [w.longitude, w.latitude] },
        properties: { id: w.id },
      })),
    });
  }, [baseWineries, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("picked") as GeoJSONSource | undefined;
    if (!ready || !map || !source) return;
    source.setData({ type: "FeatureCollection", features: picked ? [{ type: "Feature", geometry: { type: "Point", coordinates: picked }, properties: {} }] : [] });
    map.getCanvas().style.cursor = picking ? "crosshair" : "";
  }, [picked, picking, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const key = JSON.stringify(location);
    if (fittedRegion.current === key) return;
    fittedRegion.current = key;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200;
    if (location.kind === "world") fitWorld(map, detailId ? duration : 0);
    else {
      const country = location.kind === "country" ? wineCountries(regions).find((c) => c.name === location.name) : null;
      const boundary = location.kind === "region" ? boundaries?.find((b) => b.id === location.id) : null;
      const bounds = country?.bounds ?? (boundary ? geometryBounds(boundary.geojson) : null) ?? (region ? regionOpeningCamera(region, [...wineries, ...baseWineries]).bounds : null);
      if (bounds) map.fitBounds(bounds, { padding: location.kind === "region" ? openingMapPadding(map.getContainer().clientWidth) : 80, maxZoom: location.kind === "region" ? 11 : 6, duration, bearing: 0, pitch: 0 });
    }
    setCameraReady(key);
  }, [location, region, regions, boundaries, wineries, baseWineries, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !cameraReady) return;
    const sel = selectedId ?? "";
    const isSel = ["==", ["get", "id"], sel];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const apply = (t: number) => {
      // Selected pins grow; every recommendation stays fully visible.
      map.setPaintProperty("winery", "circle-radius", ["case", isSel, 12 + 4 * t, 12] as never);
      map.setPaintProperty("winery-shadow", "circle-radius", ["case", isSel, 17 + 4 * t, 17] as never);
      for (const [layer, prop] of [["winery", "circle-opacity"], ["winery", "circle-stroke-opacity"], ["winery-number", "text-opacity"]] as const)
        map.setPaintProperty(layer, prop, ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 1]);
      map.setPaintProperty("winery-shadow", "circle-opacity", ["interpolate", ["linear"], ["zoom"], 8, 0, 9, 0.18]);
      map.setLayoutProperty("winery-number", "text-size", ["case", isSel, 12 + 2 * t, 12] as never);
    };
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = reduce ? 1 : Math.min(1, (now - start) / 220);
      apply(1 - Math.pow(1 - p, 3));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const winery = wineries.find((w) => w.id === selectedId);
     if (winery && !detailId && !previousCamera.current && !restoring.current) map.flyTo({
      center: [winery.longitude, winery.latitude],
      zoom: Math.max(map.getZoom(), 14),
      speed: 1.1,
      duration: reduce ? 0 : 1200,
    });
    return () => cancelAnimationFrame(frame);
   }, [selectedId, wineries, ready, region, cameraReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !cameraReady) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!detailId) {
      const camera = previousCamera.current;
      if (!camera) return;
      activeDetail.current = null;
      restoring.current = true;
      map.stop();
      map.flyTo({ ...camera, duration: reduced ? 0 : 350 });
      previousCamera.current = null;
      const finish = () => { restoring.current = false; };
      map.once("moveend", finish);
      const timeout = window.setTimeout(finish, 400);
      return () => { window.clearTimeout(timeout); map.off("moveend", finish); restoring.current = false; };
    }
    const winery = wineries.find((w) => w.id === detailId) ?? baseWineries.find((w) => w.id === detailId);
    if (!winery || activeDetail.current === detailId) return;
    map.stop();
    if (!previousCamera.current) {
      const center = map.getCenter();
      previousCamera.current = { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), padding: map.getPadding() };
    }
    activeDetail.current = detailId;
    const focus = () => {
      const container = map.getContainer();
      const camera = detailCamera(container.clientWidth, container.clientHeight, previousCamera.current?.zoom ?? map.getZoom());
      map.flyTo({ center: [winery.longitude, winery.latitude], ...camera, duration: reduced ? 0 : 350 });
    };
    focus();
    const observer = new ResizeObserver(focus);
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [detailId, wineries, baseWineries, ready, region, cameraReady]);

  return <div className="relative h-full w-full"><div ref={container} className="h-full w-full" onClick={(event) => {
    if (!(event.target instanceof HTMLCanvasElement)) return;
    const map = mapRef.current;
    const rect = container.current?.getBoundingClientRect();
    if (!map || !rect) return;
    if (latest.current.picking) {
      const p = map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
      latest.current.onPick?.([p.lng, p.lat]);
      return;
    }
    const layers = ["winery", "clusters", "base-dot"].filter((layer) => map.getLayer(layer));
    const hits = layers.length ? map.queryRenderedFeatures([event.clientX - rect.left, event.clientY - rect.top], { layers }) : [];
    if (!hits.length) latest.current.onSelect(null);
  }} /></div>;
}

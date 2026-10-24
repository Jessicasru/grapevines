import type { Geometry } from "geojson";
import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap, GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Region, Winery } from "@/lib/wine";
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
      map.addControl(new mb.AttributionControl({ compact: true, customAttribution: "© OpenStreetMap contributors · DATAtourisme" }));
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

export const immersiveRegionSettings = { pitch: 55, exaggeration: 1.3 };

/** Sample curved edges, not only corners, to fit the entire Natural Earth outline. */
export function worldPerimeter(): [number, number][] {
  const points: [number, number][] = [];
  for (let lat = -90; lat <= 90; lat += 10) points.push([-180, lat], [180, lat]);
  for (let lng = -180; lng <= 180; lng += 10) points.push([lng, -90], [lng, 90]);
  return points;
}

function fitWorld(map: MapboxMap) {
  const padding = { top: 88, bottom: 96, left: 24, right: 24 };
  map.fitBounds([[-180, -90], [180, 90]], { padding, duration: 0, bearing: 0, pitch: 0 });
  let low = -4, high = 3;
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  for (let i = 0; i < 18; i++) {
    const zoom = (low + high) / 2;
    map.jumpTo({ center: [0, 0], zoom, pitch: 0, bearing: 0, padding });
    const fits = worldPerimeter().every((p) => {
      const screen = map.project(p);
      return screen.x >= padding.left && screen.x <= width - padding.right && screen.y >= padding.top && screen.y <= height - padding.bottom;
    });
    if (fits) low = zoom; else high = zoom;
  }
  map.jumpTo({ center: [0, 0], zoom: low, pitch: 0, bearing: 0, padding });
}

type Props = {
  regions: Region[];
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
export function WineMap({ regions, onRegionSelect, wineries, baseWineries, boundaries, picking = false, picked = null, onPick, region, selectedId, detailId, onSelect, onLocate }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [ready, setReady] = useState(false);
  const [fading, setFading] = useState(false);
  const [cameraReady, setCameraReady] = useState<string | null>(null);
  const transitionId = useRef(0);
  const token = (import.meta.env["VITE_MAPBOX_TOKEN"] as string | undefined) ?? PUBLIC_TOKEN;
  const latest = useRef({ wineries, region, onSelect, onLocate, picking, onPick, onRegionSelect });
  latest.current = { wineries, region, onSelect, onLocate, picking, onPick, onRegionSelect };
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
      if (!latest.current.region) {
        if (map.getProjection().name === "naturalEarth") fitWorld(map);
        return;
      }
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
        projection: "naturalEarth",
        renderWorldCopies: false,
        minZoom: -4,
        center: [0, 0],
        zoom: 0,
      });
      map.addControl(
        new mapboxgl.AttributionControl({
          compact: true,
          customAttribution: "© OpenStreetMap contributors · DATAtourisme",
        }),
        "bottom-right",
      );
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      const locate = new mapboxgl.GeolocateControl({ trackUserLocation: false, showUserLocation: true });
      locate.on("geolocate", (e) => latest.current.onLocate([e.coords.longitude, e.coords.latitude]));
      map.addControl(locate, "top-right");
      mapRef.current = map;
      resize();
      map.on("load", () => {
        const m = map;
        if (!m || cancelled) return;
        m.setTerrain(null);
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
        m.addLayer({ id: "boundary-fill", type: "fill", source: "boundaries", maxzoom: 13.5,
          // Disable the fill's implicit outline too, avoiding dark parcel seams.
          paint: { "fill-color": burgundy, "fill-antialias": false, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.45, 10, 0.3, 12, 0.12, 13.5, 0] } });
        m.addLayer({ id: "boundary-line", type: "line", source: "boundaries", maxzoom: 13.5,
          paint: { "line-color": burgundy, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 11, 1, 13, 0.5], "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 11, 0.4, 13, 0] } });
        // Base layer first so every burgundy pin and cluster draws above it.
        m.addSource("base", { type: "geojson", data: empty });
        m.addLayer({
          id: "base-dot", type: "circle", source: "base", minzoom: 10,
          paint: {
            "circle-color": styles.getPropertyValue("--map-base-dot").trim(),
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 12, 4, 14, 7],
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 11, 0.6, 12, 1],
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 0, 13, 1.5],
            "circle-stroke-color": white,
          },
        });
        m.addSource("picked", { type: "geojson", data: empty });
        // No slot: these layers draw above every basemap label.
        m.addLayer({
          id: "clusters", type: "circle", source: "wineries",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": white,
            "circle-radius": 14,
            "circle-stroke-width": 2,
            "circle-stroke-color": burgundy,
          },
        });
        m.addLayer({
          id: "cluster-count", type: "symbol", source: "wineries",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["to-string", ["get", "point_count"]],
            "text-font": font,
            "text-size": 13,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: { "text-color": burgundy },
        });
        m.addLayer({
          id: "winery-shadow", type: "circle", source: "wineries",
          filter: ["!", ["has", "point_count"]],
          paint: { "circle-color": "#000000", "circle-opacity": 0.18, "circle-blur": 0.6, "circle-radius": 17, "circle-translate": [0, 2] },
        });
        m.addLayer({
          id: "winery", type: "circle", source: "wineries",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": burgundy,
            "circle-radius": 12,
            "circle-stroke-width": 2,
            "circle-stroke-color": white,
          },
        });
        m.addLayer({
          id: "winery-number", type: "symbol", source: "wineries",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "text-field": ["get", "n"],
            "text-font": font,
            "text-size": 12,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: { "text-color": white },
        });
        m.addLayer({
          id: "picked-pin", type: "circle", source: "picked",
          paint: { "circle-color": burgundy, "circle-radius": 9, "circle-stroke-width": 3, "circle-stroke-color": white },
        });
        m.addLayer({ id: "region-marker", type: "circle", source: "wine-regions", paint: { "circle-color": burgundy, "circle-radius": 9, "circle-stroke-width": 3, "circle-stroke-color": white } });
        m.addLayer({ id: "region-name", type: "symbol", source: "wine-regions", layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 14, "text-offset": [0, 1.5], "text-allow-overlap": true }, paint: { "text-color": burgundy, "text-halo-color": white, "text-halo-width": 2 } });
        for (const layer of ["region-marker", "region-name", "boundary-fill"]) {
          m.on("click", layer, (e) => {
            if (latest.current.region) return;
            const id = e.features?.[0]?.properties?.id;
            if (typeof id === "string") latest.current.onRegionSelect(id);
          });
        }
        for (const layer of ["region-marker", "region-name"]) {
          m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
          m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
        }
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
      transitionId.current++;
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("wine-regions") as GeoJSONSource | undefined;
    if (!ready || !source) return;
    source.setData({ type: "FeatureCollection", features: regions.map((r) => ({ type: "Feature", geometry: { type: "Point", coordinates: [r.center_lng, r.center_lat] }, properties: { id: r.id, name: r.name } })) });
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
    const key = region?.id ?? "world";
    if (!ready || !map || fittedRegion.current === key) return;
    const initial = fittedRegion.current === null;
    fittedRegion.current = key;
    const id = ++transitionId.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    const valid = () => transitionId.current === id && mapRef.current === map;
    const settle = () => new Promise<void>((resolve) => {
      const done = () => { window.clearTimeout(timeout); map.off("idle", done); resolve(); };
      const timeout = window.setTimeout(done, 1800);
      map.once("idle", done);
    });
    const controls = (enabled: boolean) => {
      for (const control of [map.dragPan, map.scrollZoom, map.doubleClickZoom, map.boxZoom, map.keyboard]) {
        if (enabled) control.enable(); else control.disable();
      }
      if (enabled) { map.dragRotate.enable(); map.touchZoomRotate.enable(); map.touchPitch.enable(); }
      else { map.dragRotate.disable(); map.touchZoomRotate.disable(); map.touchPitch.disable(); }
    };
    void (async () => {
      controls(false);
      map.stop();
      if (!region && !initial && !reduce) {
        map.flyTo({ center: [0, 0], zoom: 0, pitch: 0, bearing: 0, padding: 0, duration: 900 });
        await wait(900);
      }
      if (!valid()) return;
      if (!initial || region) { setFading(true); await wait(reduce ? 0 : 150); }
      if (!valid()) return;
      const world = !region;
      map.setTerrain(null);
      map.setProjection(world ? "naturalEarth" : "globe");
      const styles = getComputedStyle(document.documentElement);
      if (world) {
        map.setFog(null);
        fitWorld(map);
      } else {
        map.setTerrain({ source: "mapbox-dem", exaggeration: immersiveRegionSettings.exaggeration });
        map.setFog({ color: styles.getPropertyValue("--map-fog").trim(), "high-color": styles.getPropertyValue("--map-atmosphere").trim(), "space-color": styles.getPropertyValue("--map-space").trim(), "horizon-blend": 0.15, "star-intensity": 0.12 });
        map.jumpTo({ center: [region.center_lng, region.center_lat], zoom: 2, pitch: 0, bearing: 0 });
      }
      for (const layer of ["base-dot", "clusters", "cluster-count", "winery-shadow", "winery", "winery-number", "picked-pin"]) map.setLayoutProperty(layer, "visibility", world ? "none" : "visible");
      for (const layer of ["region-marker", "region-name"]) map.setLayoutProperty(layer, "visibility", world ? "visible" : "none");
      await settle();
      if (!valid()) return;
      setFading(false);
      if (region) {
        const { bounds, maxZoom } = regionOpeningCamera(region, [...wineries, ...baseWineries]);
        const padding = openingMapPadding(map.getContainer().clientWidth, document.querySelector(".map-carousel")?.getBoundingClientRect().height);
        const camera = map.cameraForBounds(bounds, { padding, maxZoom, pitch: immersiveRegionSettings.pitch, bearing: 0 });
        if (camera) map.flyTo({ ...camera, padding, pitch: immersiveRegionSettings.pitch, duration: reduce ? 0 : 1600 });
        await wait(reduce ? 0 : 1600);
      }
      if (!valid()) return;
      controls(!!region);
      setCameraReady(key);
    })();
  }, [region, wineries, baseWineries, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !region || cameraReady !== region.id) return;
    const sel = selectedId ?? "";
    const isSel = ["==", ["get", "id"], sel];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const apply = (t: number) => {
      // Selected pins grow; every recommendation stays fully visible.
      map.setPaintProperty("winery", "circle-radius", ["case", isSel, 12 + 4 * t, 12] as never);
      map.setPaintProperty("winery-shadow", "circle-radius", ["case", isSel, 17 + 4 * t, 17] as never);
      for (const [layer, prop] of [["winery", "circle-opacity"], ["winery", "circle-stroke-opacity"], ["winery-number", "text-opacity"]] as const)
        map.setPaintProperty(layer, prop, 1);
      map.setPaintProperty("winery-shadow", "circle-opacity", 0.18);
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
    if (!map || !ready || !region || cameraReady !== region.id) return;
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
    if (!latest.current.region) return;
    if (latest.current.picking) {
      const p = map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
      latest.current.onPick?.([p.lng, p.lat]);
      return;
    }
    const layers = ["winery", "clusters", "base-dot"].filter((layer) => map.getLayer(layer));
    const hits = layers.length ? map.queryRenderedFeatures([event.clientX - rect.left, event.clientY - rect.top], { layers }) : [];
    if (!hits.length) latest.current.onSelect(null);
  }} /><div aria-hidden="true" className={`map-projection-veil absolute inset-0 bg-background ${fading ? "map-projection-veil-visible" : ""}`} /></div>;
}

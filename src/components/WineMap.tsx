import type { Geometry } from "geojson";
import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap, GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Region, Winery } from "@/lib/wine";
import { detailCamera } from "@/lib/detail-camera";

// Public (pk.) token — safe in the browser. VITE_MAPBOX_TOKEN overrides it.
const PUBLIC_TOKEN =
  "pk.eyJ1IjoicnVsYW5kanMiLCJhIjoiY212MWJqaXNrMDJjMzJ6cXhhOXYxZmc3dSJ9.TQSoAXLi8KWxJegOIJCvtQ";

type Props = {
  wineries: Winery[];
  /** Unrecommended wineries: quiet grey dots from zoom 11, below the pins. */
  baseWineries: Winery[];
  /** Region outlines, drawn as a faint fill below zoom 12. */
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
export function WineMap({ wineries, baseWineries, boundaries, picking = false, picked = null, onPick, region, selectedId, detailId, onSelect, onLocate }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [ready, setReady] = useState(false);
  const token = (import.meta.env["VITE_MAPBOX_TOKEN"] as string | undefined) ?? PUBLIC_TOKEN;
  const latest = useRef({ wineries, region, onSelect, onLocate, picking, onPick });
  latest.current = { wineries, region, onSelect, onLocate, picking, onPick };
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
      if (detailRef.current || restoring.current) return;
      const desktop = map.getContainer().clientWidth >= 1024;
      const carousel = document.querySelector(".map-carousel")?.getBoundingClientRect();
      map.setPadding({
        top: 96,
        bottom: (carousel?.height ?? 220) + 40,
        left: desktop ? 64 : 32,
        right: desktop ? 96 : 64,
      });
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
        center: latest.current.region
          ? [latest.current.region.center_lng, latest.current.region.center_lat]
          : [7.35, 48.2],
        zoom: 8,
      });
      map.addControl(
        new mapboxgl.AttributionControl({
          compact: true,
          customAttribution: "© OpenStreetMap contributors",
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
        m.addSource("boundaries", { type: "geojson", data: empty });
        m.addLayer({ id: "boundary-fill", type: "fill", source: "boundaries", maxzoom: 12,
          paint: { "fill-color": burgundy, "fill-opacity": 0.05 } });
        m.addLayer({ id: "boundary-line", type: "line", source: "boundaries", maxzoom: 12,
          paint: { "line-color": burgundy, "line-width": 1, "line-opacity": 0.45 } });
        // Base layer first so every burgundy pin and cluster draws above it.
        m.addSource("base", { type: "geojson", data: empty });
        m.addLayer({
          id: "base-dot", type: "circle", source: "base", minzoom: 11,
          paint: { "circle-color": "#8f8a84", "circle-radius": 5, "circle-stroke-width": 1.5, "circle-stroke-color": white, "circle-opacity": 0.85 },
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
    if (!ready || !map || !region || fittedRegion.current === region.id) return;
    fittedRegion.current = region.id;
    const points = wineries.filter((w) => w.region_id === region.id);
    const coordinates: [number, number][] = points.length
      ? points.map((w) => [w.longitude, w.latitude])
      : [[region.center_lng, region.center_lat]];
    const lngs = coordinates.map((p) => p[0]);
    const lats = coordinates.map((p) => p[1]);
    map.fitBounds([
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ], { padding: map.getPadding(), maxZoom: 13, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 });
  }, [region, wineries, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const sel = selectedId ?? "";
    const isSel = ["==", ["get", "id"], sel];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const apply = (t: number) => {
      const any = sel ? t : 0;
      // 28px pin (r12 + 2px border) → 36px (r16 + 2px border) when selected; others fade to 60%.
      map.setPaintProperty("winery", "circle-radius", ["case", isSel, 12 + 4 * t, 12] as never);
      map.setPaintProperty("winery-shadow", "circle-radius", ["case", isSel, 17 + 4 * t, 17] as never);
      for (const [layer, prop] of [["winery", "circle-opacity"], ["winery", "circle-stroke-opacity"], ["winery-number", "text-opacity"]] as const)
        map.setPaintProperty(layer, prop, ["case", isSel, 1, 1 - 0.4 * any] as never);
      map.setPaintProperty("winery-shadow", "circle-opacity", ["case", isSel, 0.18, 0.18 * (1 - 0.4 * any)] as never);
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
   }, [selectedId, wineries, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
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
  }, [detailId, wineries, baseWineries, ready]);

  return <div ref={container} className="h-full w-full" onClick={(event) => {
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
  }} />;
}

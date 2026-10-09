import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap, GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Region, Winery } from "@/lib/wine";

// Public (pk.) token — safe in the browser. VITE_MAPBOX_TOKEN overrides it.
const PUBLIC_TOKEN =
  "pk.eyJ1IjoicnVsYW5kanMiLCJhIjoiY212MWJqaXNrMDJjMzJ6cXhhOXYxZmc3dSJ9.TQSoAXLi8KWxJegOIJCvtQ";

type Props = {
  wineries: Winery[];
  region: Region | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLocate: (coords: [number, number]) => void;
};

/** All Mapbox logic stays here, loaded only after hydration. */
export function WineMap({ wineries, region, selectedId, onSelect, onLocate }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [ready, setReady] = useState(false);
  const token = (import.meta.env["VITE_MAPBOX_TOKEN"] as string | undefined) ?? PUBLIC_TOKEN;
  const latest = useRef({ wineries, region, onSelect, onLocate });
  latest.current = { wineries, region, onSelect, onLocate };
  const fittedRegion = useRef<string | null>(null);

  useEffect(() => {
    if (!token || !container.current) return;
    let cancelled = false;
    let map: MapboxMap | undefined;
    const resize = () => {
      if (!map) return;
      map.resize();
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
        center: latest.current.region
          ? [latest.current.region.center_lng, latest.current.region.center_lat]
          : [7.35, 48.2],
        zoom: 8,
      });
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
        m.on("click", "winery", (e) => {
          const feature = e.features?.[0] as unknown as { properties?: { id?: string } } | undefined;
          const id = feature?.properties?.id;
          if (id) latest.current.onSelect(String(id));
        });
        m.on("click", (e) => {
          if (!m.queryRenderedFeatures(e.point, { layers: ["winery", "clusters"] }).length)
            latest.current.onSelect(null);
        });
        for (const layer of ["clusters", "winery"]) {
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
    if (winery) map.flyTo({
      center: [winery.longitude, winery.latitude],
      zoom: Math.max(map.getZoom(), 14),
      speed: 1.1,
      duration: reduce ? 0 : 1200,
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, wineries, ready]);

  return <div ref={container} className="h-full w-full" />;
}

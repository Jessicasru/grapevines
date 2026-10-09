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
      const header = document.querySelector(".map-header")?.getBoundingClientRect();
      const directory = document.querySelector(".map-directory")?.getBoundingClientRect();
      map.setPadding({
        top: desktop ? 48 : (header?.bottom ?? 210) + 20,
        bottom: desktop ? 48 : (directory?.height ?? 200) + 32,
        left: desktop ? 440 : 32,
        right: desktop ? 64 : 48,
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    const directory = document.querySelector(".map-directory");
    if (directory) observer.observe(directory);
    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !container.current) return;
      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({
        container: container.current,
        style: "mapbox://styles/mapbox/standard",
        config: { basemap: {
          theme: "faded",
          showRoadLabels: false,
          showTransitLabels: false,
          showPointOfInterestLabels: false,
          showPlaceLabels: true,
        } },
        center: latest.current.region
          ? [latest.current.region.center_lng, latest.current.region.center_lat]
          : [7.35, 48.2],
        zoom: 8,
      });
      mapRef.current = map;
      resize();
      const geo = new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showUserLocation: true,
      });
      map.addControl(geo, "top-right");
      geo.on("geolocate", (e: GeolocationPosition) =>
        latest.current.onLocate([e.coords.longitude, e.coords.latitude]),
      );
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        const m = map;
        if (!m || cancelled) return;
        const styles = getComputedStyle(document.documentElement);
        const burgundy = styles.getPropertyValue("--map-pin").trim();
        const paper = styles.getPropertyValue("--map-pin-foreground").trim();
        m.addSource("wineries", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 45,
        });
        m.addLayer({
          id: "clusters", type: "circle", source: "wineries", slot: "top",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": burgundy,
            "circle-radius": ["step", ["get", "point_count"], 20, 5, 25, 10, 30],
            "circle-stroke-width": 3,
            "circle-stroke-color": paper,
          },
        });
        m.addLayer({
          id: "cluster-count", type: "symbol", source: "wineries", slot: "top",
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 14 },
          paint: { "text-color": paper },
        });
        m.addLayer({
          id: "winery", type: "symbol", source: "wineries", slot: "top",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": ["get", "pin"],
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
          },
        });
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
    const styles = getComputedStyle(document.documentElement);
    const burgundy = styles.getPropertyValue("--map-pin").trim();
    const paper = styles.getPropertyValue("--map-pin-foreground").trim();
    // Raster pins keep the number legible, without external icon/font requests.
    for (let i = 0; i < wineries.length; i++) {
      for (const active of [false, true]) {
        const id = `pin-${i + 1}${active ? "-selected" : ""}`;
        if (map.hasImage(id)) continue;
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 120;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.scale(2, 2);
        ctx.beginPath();
        ctx.moveTo(24, 57);
        ctx.bezierCurveTo(19, 48, 4, 35, 4, 23);
        ctx.arc(24, 23, 20, Math.PI, 0);
        ctx.bezierCurveTo(44, 35, 29, 48, 24, 57);
        ctx.closePath();
        ctx.fillStyle = active ? paper : burgundy;
        ctx.fill();
        ctx.strokeStyle = active ? burgundy : paper;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = active ? burgundy : paper;
        ctx.font = `bold 16px ${styles.getPropertyValue("--font-sans").trim()}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), 24, 24);
        map.addImage(id, ctx.getImageData(0, 0, 96, 120), { pixelRatio: 2 });
      }
    }
    source.setData({
      type: "FeatureCollection",
      features: wineries.map((w, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [w.longitude, w.latitude] },
        properties: { id: w.id, pin: `pin-${i + 1}`, selectedPin: `pin-${i + 1}-selected` },
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
    map.setLayoutProperty("winery", "icon-image", [
      "case", ["==", ["get", "id"], selectedId ?? ""], ["get", "selectedPin"], ["get", "pin"],
    ]);
    map.setLayoutProperty("winery", "symbol-sort-key", ["case", ["==", ["get", "id"], selectedId ?? ""], 1, 0]);
    const winery = wineries.find((w) => w.id === selectedId);
    if (winery) map.flyTo({
      center: [winery.longitude, winery.latitude],
      zoom: Math.max(map.getZoom(), 14),
      speed: 1.1,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200,
    });
  }, [selectedId, wineries, ready]);

  return <div ref={container} className="h-full w-full" />;
}

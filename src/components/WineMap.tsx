import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap, GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Region, Winery } from "@/lib/wine";
import { Button } from "@/components/ui/button";

// Public (pk.) token — safe in the browser. VITE_MAPBOX_TOKEN overrides it.
const PUBLIC_TOKEN =
  "pk.eyJ1IjoicnVsYW5kanMiLCJhIjoiY212MWJqaXNrMDJjMzJ6cXhhOXYxZmc3dSJ9.TQSoAXLi8KWxJegOIJCvtQ";

type Props = {
  wineries: Winery[];
  region: Region | null;
  onSelect: (id: string | null) => void;
  onLocate: (coords: [number, number]) => void;
};

/** All Mapbox logic lives here. Mapbox GL is loaded only in the browser. */
export function WineMap({ wineries, region, onSelect, onLocate }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [ready, setReady] = useState(false);
  const token = (import.meta.env["VITE_MAPBOX_TOKEN"] as string | undefined) ?? PUBLIC_TOKEN;
  const cb = useRef({ onSelect, onLocate });
  cb.current = { onSelect, onLocate };

  useEffect(() => {
    if (!token || !container.current) return;
    let cancelled = false;
    let map: MapboxMap | undefined;
    const resizeObserver = new ResizeObserver(() => map?.resize());
    resizeObserver.observe(container.current);
    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !container.current) return;
      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({
        container: container.current,
        style: "mapbox://styles/mapbox/standard",
        center: region ? [region.center_lng, region.center_lat] : [7.35, 48.2],
        zoom: region?.default_zoom ?? 8.5,
      });
      mapRef.current = map;

      const geo = new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showUserLocation: true,
      });
      map.addControl(geo, "top-right");
      geo.on("geolocate", (e: GeolocationPosition) =>
        cb.current.onLocate([e.coords.longitude, e.coords.latitude]),
      );
      (map as MapboxMap & { _geo?: unknown })._geo = geo;
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        const m = map;
        if (!m) return;
        m.addSource("wineries", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 45,
        });
        m.addLayer({
          id: "clusters",
          type: "circle",
          source: "wineries",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#6e1f2a",
            "circle-radius": ["step", ["get", "point_count"], 18, 5, 24, 10, 30],
            "circle-stroke-width": 3,
            "circle-stroke-color": "#f7f1e6",
          },
        });
        m.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "wineries",
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 13 },
          paint: { "text-color": "#f7f1e6" },
        });
        m.addLayer({
          id: "winery",
          type: "circle",
          source: "wineries",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": "#6e1f2a",
            "circle-radius": 9,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#f7f1e6",
          },
        });

        m.on("click", "clusters", (e) => {
          const f = m.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0] as any;
          if (!f) return;
          const src = m.getSource("wineries") as GeoJSONSource;
          src.getClusterExpansionZoom(f.properties?.cluster_id, (err, zoom) => {
            if (err || zoom == null) return;
            m.easeTo({ center: f.geometry.coordinates as [number, number], zoom });
          });
        });
        m.on("click", "winery", (e) => {
          const f = e.features?.[0] as any;
          if (f?.properties?.id) cb.current.onSelect(String(f.properties.id));
        });
        m.on("click", (e) => {
          const hits = m.queryRenderedFeatures(e.point, { layers: ["winery", "clusters"] });
          if (!hits.length) cb.current.onSelect(null);
        });
        for (const l of ["clusters", "winery"]) {
          m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
        }
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Sync wineries into the clustered source.
  useEffect(() => {
    const src = mapRef.current?.getSource("wineries") as GeoJSONSource | undefined;
    if (!ready || !src) return;
    src.setData({
      type: "FeatureCollection",
      features: wineries.map((w) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [w.longitude, w.latitude] },
        properties: { id: w.id, name: w.name },
      })),
    });
  }, [wineries, ready]);

  // Fly to selected region.
  useEffect(() => {
    if (!ready || !region) return;
    mapRef.current?.flyTo({
      center: [region.center_lng, region.center_lat],
      zoom: region.default_zoom,
      speed: 0.9,
      essential: true,
    });
  }, [region, ready]);

  const locate = () => {
    const geo = (mapRef.current as (MapboxMap & { _geo?: { trigger: () => boolean } }) | null)?._geo;
    geo?.trigger();
  };

  if (!token) {
    return (
      <div className="flex h-full items-center justify-center bg-muted p-6 text-center">
        <p className="max-w-xs text-sm text-muted-foreground">
          The map needs a Mapbox access token to appear.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />
      <Button
        type="button"
        variant="secondary"
        onClick={locate}
        className="map-locate absolute right-3 z-10 h-11 bg-card px-4 text-sm font-semibold text-primary shadow-md sm:right-5"
      >
        ◎ Near me
      </Button>
    </div>
  );
}

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapHandle, MapProps } from "./mapTypes";
import type { Segment, Trail } from "../data/types";
import { lineStringsFromWKT } from "../lib/wkt";
import { colorFor } from "../lib/lang";
import { basemapSources, overlaySource } from "../lib/basemaps";

// Cesium stores a metres-above-ground "height" in the URL; MapLibre works in zoom
// levels. Convert both ways so a shared link roughly reproduces the view. MapLibre
// is tilt-capable, so heading/pitch round-trip too.
const zoomFromHeight = (h: number) => Math.max(1, Math.min(19, 26.6 - Math.log2(Math.max(1, h))));
const heightFromZoom = (z: number) => 2 ** (26.6 - z);

const LITHUANIA = new maplibregl.LngLatBounds([20.9, 53.9], [26.9, 56.5]);

const PIN_PATH = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 11 7 11s7-5.75 7-11c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";
function pinEl(fill: string) {
  const el = document.createElement("div");
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="30" height="30">`
    + `<path d="${PIN_PATH}" fill="${fill}" stroke="#fff" stroke-width="1.2"/></svg>`;
  return el;
}

type LineFeature = GeoJSON.Feature<GeoJSON.LineString, { slug: string; color: string }>;

const featureCollection = (features: LineFeature[]): GeoJSON.FeatureCollection<GeoJSON.LineString> =>
  ({ type: "FeatureCollection", features });

const lineCoords = (flat: number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let k = 0; k < flat.length; k += 2) out.push([flat[k], flat[k + 1]]);
  return out;
};

function boundsOf(lines: number[][]) {
  const b = new maplibregl.LngLatBounds();
  for (const flat of lines)
    for (let k = 0; k < flat.length; k += 2) b.extend([flat[k], flat[k + 1]]);
  return b;
}

const MapLibreMap = forwardRef<MapHandle, MapProps>(function MapLibreMap(props, ref) {
  const { trails, shownSlugs, basemap, overlays, initialCam, onPick, onActiveChange, onViewChange, onCameraChange } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  // numeric feature ids per slug (a MULTILINESTRING contributes several), so
  // feature-state highlight + the visibility filter can target a whole trail.
  const idsBySlug = useRef<Map<string, number[]>>(new Map());
  const boundsBySlug = useRef<Map<string, maplibregl.LngLatBounds>>(new Map());
  const markers = useRef<maplibregl.Marker[]>([]);
  const activeOverlays = useRef<Set<string>>(new Set());
  const activeSlug = useRef<string | null>(null);
  const hoverSlug = useRef<string | null>(null);

  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  const onViewChangeRef = useRef(onViewChange); onViewChangeRef.current = onViewChange;
  const onCameraChangeRef = useRef(onCameraChange); onCameraChangeRef.current = onCameraChange;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: { version: 8, sources: {}, layers: [] },
      center: initialCam ? [initialCam.lng, initialCam.lat] : [23.9, 55.2],
      zoom: initialCam ? zoomFromHeight(initialCam.height) : 6,
      bearing: initialCam?.heading ?? 0, pitch: initialCam?.pitch ?? 0,
    });
    mapRef.current = map;

    // build the trail line features once: each (multi)linestring piece is a feature
    const features: LineFeature[] = [];
    let id = 0;
    trails.forEach((t, i) => {
      const lines = t.wkt ? lineStringsFromWKT(t.wkt) : null;
      if (!lines) return;
      const color = colorFor(i);
      const ids: number[] = [];
      const b = new maplibregl.LngLatBounds();
      for (const flat of lines) {
        const coords = lineCoords(flat);
        coords.forEach((c) => b.extend(c));
        features.push({ type: "Feature", id, geometry: { type: "LineString", coordinates: coords }, properties: { slug: t.slug, color } });
        ids.push(id++);
      }
      idsBySlug.current.set(t.slug, ids);
      boundsBySlug.current.set(t.slug, b);
    });

    map.on("load", () => {
      loaded.current = true;
      applyBasemap(basemap);
      for (const key of overlays) applyOverlay(key);

      map.addSource("trails", { type: "geojson", data: featureCollection(features) });
      map.addLayer({
        id: "trails", type: "line", source: "trails",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["boolean", ["feature-state", "on"], false], 6, 2],
          "line-opacity": ["case", ["boolean", ["feature-state", "on"], false], 1, 0.35],
        },
      });
      map.addSource("seg", { type: "geojson", data: featureCollection([]) });
      map.addLayer({ id: "seg", type: "line", source: "seg",
        paint: { "line-color": "#ffe14d", "line-width": 7 } });

      map.on("click", "trails", (e) => {
        const slug = e.features?.[0]?.properties?.slug as string | undefined;
        if (slug) onPickRef.current(slug);
      });
      map.on("mouseenter", "trails", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "trails", () => { map.getCanvas().style.cursor = ""; });

      applyVisibility();
      applyHighlight();
    });

    const emitView = () => {
      const b = map.getBounds();
      onViewChangeRef.current({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() });
      const c = map.getCenter();
      onCameraChangeRef.current({ lng: c.lng, lat: c.lat, height: heightFromZoom(map.getZoom()), heading: map.getBearing(), pitch: map.getPitch() });
    };
    map.on("moveend", emitView);

    return () => { map.remove(); mapRef.current = null; loaded.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (loaded.current) applyBasemap(basemap); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [basemap]);
  useEffect(() => {
    if (!loaded.current) return;
    const map = mapRef.current!;
    // remove overlays no longer selected
    for (const key of [...activeOverlays.current]) {
      if (!overlays.has(key)) {
        if (map.getLayer("ov-" + key)) map.removeLayer("ov-" + key);
        if (map.getSource("ov-" + key)) map.removeSource("ov-" + key);
        activeOverlays.current.delete(key);
      }
    }
    for (const key of overlays) applyOverlay(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays]);
  useEffect(() => { if (loaded.current) applyVisibility(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shownSlugs]);

  // (re)build the basemap raster stack. Remove the old base-* layers/sources, then
  // add the new stack at the bottom (below trails/overlays via beforeId).
  function applyBasemap(key: string) {
    const map = mapRef.current!;
    map.getStyle().layers
      ?.filter((l) => l.id.startsWith("base-"))
      .forEach((l) => { map.removeLayer(l.id); if (map.getSource(l.id)) map.removeSource(l.id); });
    basemapSources(key).forEach((s, idx) => {
      const id = "base-" + idx;
      map.addSource(id, { type: "raster", tiles: [s.url], tileSize: 256, maxzoom: s.maxZoom, attribution: s.credit });
      // base layers go beneath everything: insert before the lowest non-base layer
      const beforeId = map.getStyle().layers?.find((l) => !l.id.startsWith("base-"))?.id;
      map.addLayer({ id, type: "raster", source: id }, beforeId);
    });
  }

  function applyOverlay(key: string) {
    const map = mapRef.current!;
    const id = "ov-" + key;
    if (map.getLayer(id)) return;
    const s = overlaySource(key);
    if (!s) return;
    map.addSource(id, { type: "raster", tiles: [s.url], tileSize: 256, maxzoom: s.maxZoom });
    // overlays sit above the basemap but below the trail lines
    map.addLayer({ id, type: "raster", source: id }, map.getLayer("trails") ? "trails" : undefined);
    activeOverlays.current.add(key);
  }

  function applyVisibility() {
    const map = mapRef.current!;
    if (!map.getLayer("trails")) return;
    const shown = [...shownSlugs];
    map.setFilter("trails", ["in", ["get", "slug"], ["literal", shown]]);
  }

  function setState(slug: string | null, on: boolean) {
    if (!slug) return;
    const map = mapRef.current!;
    for (const id of idsBySlug.current.get(slug) ?? [])
      map.setFeatureState({ source: "trails", id }, { on });
  }

  function applyHighlight() {
    const map = mapRef.current;
    if (!map || !map.getLayer("trails")) return;
    // clear all, then set the active/hover trails on
    for (const ids of idsBySlug.current.values())
      for (const id of ids) map.setFeatureState({ source: "trails", id }, { on: false });
    setState(activeSlug.current, true);
    setState(hoverSlug.current, true);
  }

  function clearMarkers() { markers.current.forEach((m) => m.remove()); markers.current = []; }

  function showEndpoints(t: Trail) {
    clearMarkers();
    const map = mapRef.current!;
    const add = (p: { lng: number; lat: number }, css: string) => {
      const m = new maplibregl.Marker({ element: pinEl(css), anchor: "bottom" }).setLngLat([p.lng, p.lat]).addTo(map);
      m.getElement().addEventListener("click", () => onPickRef.current(t.slug));
      markers.current.push(m);
    };
    if (t.start) add(t.start, "#2ecc71");
    if (t.finish) add(t.finish, "#e74c3c");
  }

  function clearSegHighlight() {
    const map = mapRef.current;
    const src = map?.getSource("seg") as maplibregl.GeoJSONSource | undefined;
    src?.setData(featureCollection([]));
  }

  useImperativeHandle(ref, (): MapHandle => ({
    showTrack(i, fly) {
      const map = mapRef.current!;
      const t = trails[i];
      activeSlug.current = t.slug;
      onActiveChange(t.slug);
      applyHighlight();
      showEndpoints(t);
      if (fly) {
        const b = boundsBySlug.current.get(t.slug);
        if (b && !b.isEmpty()) map.fitBounds(b, { padding: 40, duration: 1000 });
      }
    },
    setHover(i) {
      const next = i == null ? null : trails[i].slug;
      if (next === hoverSlug.current) return;
      hoverSlug.current = next;
      applyHighlight();
    },
    resetView() {
      applyHighlight();
      clearMarkers();
      mapRef.current!.fitBounds(LITHUANIA, { duration: 1000 });
    },
    highlightSegment(seg: Segment) {
      const lines = seg.wkt ? lineStringsFromWKT(seg.wkt) : null;
      if (!lines) return;
      const map = mapRef.current!;
      const feats: LineFeature[] = lines.map((flat) => ({
        type: "Feature", geometry: { type: "LineString", coordinates: lineCoords(flat) },
        properties: { slug: "", color: "#ffe14d" },
      }));
      (map.getSource("seg") as maplibregl.GeoJSONSource).setData(featureCollection(feats));
      map.fitBounds(boundsOf(lines), { padding: 40, duration: 1000 });
    },
    clearSegHighlight,
  }), [trails, onActiveChange]);

  return <div ref={containerRef} className="map2d" />;
});

export default MapLibreMap;

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapHandle, MapProps } from "./mapTypes";
import type { Segment, Trail } from "../data/types";
import { lineStringsFromWKT } from "../lib/wkt";
import { colorFor } from "../lib/lang";
import { basemapSources, overlaySource } from "../lib/basemaps";

// 2D engines work in zoom levels, not camera height. Cesium's URL "height" is a
// metres-above-ground distance; this pair converts between the two so a link's
// camera roughly reproduces across engines (heading/pitch are ignored — Leaflet
// is top-down only).
const zoomFromHeight = (h: number) => Math.max(1, Math.min(19, 26.6 - Math.log2(Math.max(1, h))));
const heightFromZoom = (z: number) => 2 ** (26.6 - z);

const LITHUANIA: L.LatLngBoundsExpression = [[53.9, 20.9], [56.5, 26.9]];

// same location_on pin the detail panel/Cesium use, as an HTML divIcon so Leaflet
// can place it; bottom-centre anchored, tinted per endpoint.
const PIN_PATH = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 11 7 11s7-5.75 7-11c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";
const pinIcon = (fill: string) =>
  L.divIcon({
    className: "lpin",
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="30" height="30">`
      + `<path d="${PIN_PATH}" fill="${fill}" stroke="#fff" stroke-width="1.2"/></svg>`,
    iconSize: [30, 30], iconAnchor: [15, 30],
  });

function boundsOfLines(lines: number[][]): L.LatLngBoundsExpression {
  const pts: [number, number][] = [];
  for (const flat of lines)
    for (let k = 0; k < flat.length; k += 2) pts.push([flat[k + 1], flat[k]]);
  return L.latLngBounds(pts);
}

const toLatLngs = (flat: number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let k = 0; k < flat.length; k += 2) out.push([flat[k + 1], flat[k]]);
  return out;
};

const LeafletMap = forwardRef<MapHandle, MapProps>(function LeafletMap(props, ref) {
  const { trails, shownSlugs, basemap, overlays, initialCam, onPick, onActiveChange, onViewChange, onCameraChange } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayers = useRef<L.TileLayer[]>([]);
  const overlayLayers = useRef<Map<string, L.TileLayer>>(new Map());
  // per trail: the polylines (a MULTILINESTRING has several) and base colour
  const polys = useRef<Record<string, { layers: L.Polyline[]; color: string }>>({});
  const markers = useRef<L.Marker[]>([]);
  const segLayers = useRef<L.Polyline[]>([]);
  const activeSlug = useRef<string | null>(null);
  const hoverSlug = useRef<string | null>(null);

  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  const onViewChangeRef = useRef(onViewChange); onViewChangeRef.current = onViewChange;
  const onCameraChangeRef = useRef(onCameraChange); onCameraChangeRef.current = onCameraChange;

  useEffect(() => {
    const map = L.map(containerRef.current!, { zoomControl: false, attributionControl: true });
    mapRef.current = map;
    if (initialCam) map.setView([initialCam.lat, initialCam.lng], zoomFromHeight(initialCam.height));
    else map.fitBounds(LITHUANIA);

    addBasemap(basemap);
    for (const key of overlays) addOverlay(key);

    trails.forEach((_, i) => ensureTrail(i));
    applyVisibility();
    applyHighlight();

    const emitView = () => {
      const b = map.getBounds();
      onViewChangeRef.current({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() });
      const c = map.getCenter();
      onCameraChangeRef.current({ lng: c.lng, lat: c.lat, height: heightFromZoom(map.getZoom()), heading: 0, pitch: 0 });
    };
    map.on("moveend", emitView);
    emitView();

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { addBasemap(basemap); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [basemap]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [key, layer] of overlayLayers.current)
      if (!overlays.has(key)) { map.removeLayer(layer); overlayLayers.current.delete(key); }
    for (const key of overlays) addOverlay(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays]);
  useEffect(() => { applyVisibility(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shownSlugs]);

  // Leaflet substitutes {x}=col {y}=row {z}=zoom, which already matches the Esri
  // /tile/{z}/{y}/{x} path order — so every source's template is used verbatim.
  function addBasemap(key: string) {
    const map = mapRef.current;
    if (!map) return;
    baseLayers.current.forEach((l) => map.removeLayer(l));
    baseLayers.current = basemapSources(key).map((s) => {
      const l = L.tileLayer(s.url, { maxZoom: s.maxZoom, maxNativeZoom: s.maxZoom, attribution: s.credit });
      l.addTo(map); l.setZIndex(1); return l;
    });
  }

  function addOverlay(key: string) {
    const map = mapRef.current;
    if (!map || overlayLayers.current.has(key)) return;
    const s = overlaySource(key);
    if (!s) return;
    const l = L.tileLayer(s.url, { maxZoom: s.maxZoom, maxNativeZoom: s.maxZoom });
    l.addTo(map); l.setZIndex(5);
    overlayLayers.current.set(key, l);
  }

  function ensureTrail(i: number) {
    const map = mapRef.current!;
    const t = trails[i];
    if (polys.current[t.slug]) return;
    const color = colorFor(i);
    const lines = t.wkt ? lineStringsFromWKT(t.wkt) : null;
    if (!lines) return;
    const layers = lines.map((flat) => {
      const pl = L.polyline(toLatLngs(flat), { color, weight: 2, opacity: 0.35 });
      pl.on("click", () => onPickRef.current(t.slug));
      pl.addTo(map);
      return pl;
    });
    polys.current[t.slug] = { layers, color };
  }

  function applyVisibility() {
    const map = mapRef.current;
    if (!map) return;
    for (const slug in polys.current) {
      const show = shownSlugs.has(slug);
      for (const pl of polys.current[slug].layers) {
        if (show && !map.hasLayer(pl)) pl.addTo(map);
        else if (!show && map.hasLayer(pl)) map.removeLayer(pl);
      }
    }
  }

  function applyHighlight() {
    for (const slug in polys.current) {
      const on = slug === activeSlug.current || slug === hoverSlug.current;
      for (const pl of polys.current[slug].layers)
        pl.setStyle({ weight: on ? 6 : 2, opacity: on ? 1 : 0.35 });
    }
  }

  function clearMarkers() {
    const map = mapRef.current;
    markers.current.forEach((m) => map?.removeLayer(m));
    markers.current = [];
  }

  function showEndpoints(t: Trail) {
    clearMarkers();
    const map = mapRef.current;
    if (!map) return;
    const add = (p: { lng: number; lat: number }, css: string) => {
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(css) });
      m.on("click", () => onPickRef.current(t.slug));
      m.addTo(map);
      markers.current.push(m);
    };
    if (t.start) add(t.start, "#2ecc71");
    if (t.finish) add(t.finish, "#e74c3c");
  }

  function clearSegHighlight() {
    const map = mapRef.current;
    segLayers.current.forEach((l) => map?.removeLayer(l));
    segLayers.current = [];
  }

  useImperativeHandle(ref, (): MapHandle => ({
    showTrack(i, fly) {
      const map = mapRef.current!;
      const t = trails[i];
      ensureTrail(i);
      activeSlug.current = t.slug;
      onActiveChange(t.slug);
      applyHighlight();
      showEndpoints(t);
      if (fly) {
        const p = polys.current[t.slug];
        if (p) {
          const b = L.latLngBounds([]);
          p.layers.forEach((pl) => b.extend(pl.getBounds()));
          if (b.isValid()) map.fitBounds(b, { padding: [40, 40] });
        }
      }
    },
    setHover(i) {
      const next = i == null ? null : trails[i].slug;
      if (next === hoverSlug.current) return;
      hoverSlug.current = next;
      applyHighlight();
    },
    resetView() {
      trails.forEach((_, i) => ensureTrail(i));
      applyHighlight();
      clearMarkers();
      mapRef.current!.fitBounds(LITHUANIA);
    },
    highlightSegment(seg: Segment) {
      clearSegHighlight();
      const lines = seg.wkt ? lineStringsFromWKT(seg.wkt) : null;
      if (!lines) return;
      const map = mapRef.current!;
      for (const flat of lines) {
        const pl = L.polyline(toLatLngs(flat), { color: "#ffe14d", weight: 7 });
        pl.addTo(map); segLayers.current.push(pl);
      }
      map.fitBounds(boundsOfLines(lines), { padding: [40, 40] });
    },
    clearSegHighlight,
  }), [trails, onActiveChange]);

  return <div ref={containerRef} className="map2d" />;
});

export default LeafletMap;

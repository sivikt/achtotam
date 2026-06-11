import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang, Segment, Trail } from "./data/types";
import { trails as allTrails } from "./generated/trails";
import { I18N } from "./data/i18n";
import MapView, { type CameraState, type MapHandle } from "./components/MapView";
import Sidebar, { type SortMode } from "./components/Sidebar";
import Gallery, { type GalleryItem } from "./components/Gallery";
import { nameOf, pick, qtyNum } from "./lib/lang";
import { lineStringsFromWKT } from "./lib/wkt";

// stable colour/index order, fixed once (matches generated order)
const indexBySlug = new Map(allTrails.map((t, i) => [t.slug, i] as const));

export interface ViewRect { w: number; s: number; e: number; n: number }

// one representative [lng,lat] per trail, precomputed for fast in-view testing
function repPoint(t: Trail): [number, number] | null {
  if (isFinite(t.lat) && isFinite(t.lng)) return [t.lng, t.lat];
  const lines = t.wkt ? lineStringsFromWKT(t.wkt) : null;
  if (lines) {
    let sx = 0, sy = 0, n = 0;
    for (const f of lines) for (let k = 0; k < f.length; k += 2) { sx += f[k]; sy += f[k + 1]; n++; }
    if (n) return [sx / n, sy / n];
  }
  return null;
}
const trailPoints = new Map(allTrails.map((t) => [t.slug, repPoint(t)] as const));

const LayersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 22 8.5 12 15 2 8.5 12 2" />
    <polyline points="2 15.5 12 22 22 15.5" />
  </svg>
);

// Google Maps / Material Design glyphs: framed satellite image, and folded map
const SatIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 4.99h3C8 6.65 6.66 8 5 8V4.99zM5 12v-2c2.76 0 5-2.25 5-5.01h2C12 8.86 8.87 12 5 12zm0 6 3.5-4.5 2.5 3.01L14.5 12l4.5 6H5z" />
  </svg>
);
const RefsIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z" />
  </svg>
);
// terrain / contour lines glyph for the topographic layer
const TopoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 20l4-7 3 4 3-6 4 9" />
    <path d="M8 8l2.5-4L14 9" />
  </svg>
);

// ontology namespace — themeFilter holds a full category URI; we store only the
// short suffix in the URL (e.g. "cat-epam-hiking-club") and re-expand on read.
const NS = "https://nesedeknamuose.lt/ontology/cognitive-trails#";
const PARAMS = new URLSearchParams(window.location.search);

const initialCam: CameraState | null = (() => {
  const c = PARAMS.get("cam");
  if (!c) return null;
  const [lng, lat, height, heading, pitch] = c.split(",").map(Number);
  if (![lng, lat, height].every(Number.isFinite)) return null;
  return { lng, lat, height, heading: heading || 0, pitch: pitch || 0 };
})();

// write a fresh query string without reloading; drop the "?" when empty
function pushUrl(p: URLSearchParams) {
  const qs = p.toString();
  window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
}

export default function App() {
  const langParam = PARAMS.get("lang");
  const sortParam = PARAMS.get("sort");
  const routeParam = PARAMS.get("route");
  const [lang, setLang] = useState<Lang>(langParam === "lt" || langParam === "ru" ? langParam : "en");
  const [search, setSearch] = useState(PARAMS.get("q") || "");
  const [sortMode, setSortMode] = useState<SortMode>(
    sortParam === "dist" || sortParam === "dur" ? sortParam : "name");
  const [themeFilter, setThemeFilter] = useState(PARAMS.get("theme") ? NS + PARAMS.get("theme") : "");
  const [catFilter, setCatFilter] = useState(PARAMS.get("type") || "");
  const [attrFilter, setAttrFilter] = useState<Set<string>>(
    new Set((PARAMS.get("attrs") || "").split(",").filter(Boolean)));
  const [activeSlug, setActiveSlug] = useState<string | null>(routeParam || null);
  const [detail, setDetail] = useState<Trail | null>(
    () => (routeParam ? allTrails.find((t) => t.slug === routeParam) || null : null));
  const [showRefs, setShowRefs] = useState(PARAMS.get("refs") === "1");
  const [showSat, setShowSat] = useState(PARAMS.get("sat") === "1");
  const [showTopo, setShowTopo] = useState(PARAMS.get("topo") === "1");
  const [layersOpen, setLayersOpen] = useState(false);
  const [gallery, setGallery] = useState<{ items: GalleryItem[]; index: number } | null>(null);
  const [viewRect, setViewRect] = useState<ViewRect | null>(null);

  const map = useRef<MapHandle>(null);
  // latest camera pose as a "cam" query value, kept out of React state so panning
  // the map doesn't re-render the whole app
  const camRef = useRef<string | null>(PARAMS.get("cam"));

  const routeTypes = useMemo(() =>
    [...new Set(allTrails.map((t) => pick(t.routeType, lang)).filter(Boolean))]
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), lang)), [lang]);

  const visible = useMemo(() => {
    const f = search.trim().toLowerCase();
    const out = allTrails.filter((t) => {
      if (f && !Object.values(t.name).join(" ").toLowerCase().includes(f)) return false;
      if (themeFilter && !t.categories.includes(themeFilter)) return false;
      if (catFilter && pick(t.routeType, lang) !== catFilter) return false;
      if (attrFilter.size && ![...attrFilter].every((a) => t.props.includes(a))) return false;
      if (viewRect) {
        const p = trailPoints.get(t.slug);
        if (!p) return false;
        const [lng, lat] = p;
        if (lng < viewRect.w || lng > viewRect.e || lat < viewRect.s || lat > viewRect.n) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      if (sortMode === "dist") return qtyNum(a.distance) - qtyNum(b.distance);
      if (sortMode === "dur") return qtyNum(a.duration) - qtyNum(b.duration);
      return nameOf(a, lang).toLowerCase().localeCompare(nameOf(b, lang).toLowerCase(), lang);
    });
    return out;
  }, [search, themeFilter, catFilter, attrFilter, sortMode, lang, viewRect]);

  const selectTrail = (t: Trail, fly: boolean) => {
    const i = indexBySlug.get(t.slug)!;
    map.current?.showTrack(i, fly);
    setActiveSlug(t.slug);
    setDetail(t);
    setGallery(null); // close any gallery left open from the previous route
  };

  const toggleAttr = (key: string) => setAttrFilter((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const onOpenSegment = (seg: Segment | null) => {
    if (seg) map.current?.highlightSegment(seg);
    else map.current?.clearSegHighlight();
  };

  // mirror UI state into the query string (defaults are omitted to keep it short);
  // the cam param is owned by onCameraChange and carried over from camRef here.
  useEffect(() => {
    const p = new URLSearchParams();
    if (lang !== "en") p.set("lang", lang);
    if (search) p.set("q", search);
    if (sortMode !== "name") p.set("sort", sortMode);
    if (themeFilter) p.set("theme", themeFilter.startsWith(NS) ? themeFilter.slice(NS.length) : themeFilter);
    if (catFilter) p.set("type", catFilter);
    if (attrFilter.size) p.set("attrs", [...attrFilter].join(","));
    if (activeSlug) p.set("route", activeSlug);
    if (showSat) p.set("sat", "1");
    if (showTopo) p.set("topo", "1");
    if (showRefs) p.set("refs", "1");
    if (camRef.current) p.set("cam", camRef.current);
    pushUrl(p);
  }, [lang, search, sortMode, themeFilter, catFilter, attrFilter, activeSlug, showSat, showTopo, showRefs]);

  const onCameraChange = (cam: CameraState) => {
    camRef.current = `${cam.lng.toFixed(5)},${cam.lat.toFixed(5)},${Math.round(cam.height)},`
      + `${cam.heading.toFixed(1)},${cam.pitch.toFixed(1)}`;
    const p = new URLSearchParams(window.location.search);
    p.set("cam", camRef.current);
    pushUrl(p);
  };

  // a route from the URL: open its detail + highlight on the map. If the URL also
  // carried a camera pose, don't fly (the saved view wins); otherwise frame it.
  useEffect(() => {
    if (!detail) return;
    const i = indexBySlug.get(detail.slug);
    if (i != null) map.current?.showTrack(i, !initialCam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const d = I18N[lang];

  return (
    <div id="app">
      <Sidebar
        lang={lang} total={allTrails.length} trails={allTrails} visible={visible}
        indexOf={(t) => indexBySlug.get(t.slug)!} activeSlug={activeSlug}
        search={search} sortMode={sortMode} themeFilter={themeFilter} catFilter={catFilter}
        attrFilter={attrFilter} routeTypes={routeTypes} detail={detail}
        onSearch={setSearch} onSort={setSortMode} onTheme={setThemeFilter} onCat={setCatFilter}
        onToggleAttr={toggleAttr} onLang={setLang}
        onResetView={() => map.current?.resetView()}
        onSelect={(t) => selectTrail(t, false)}
        onFly={(t) => selectTrail(t, true)}
        onCloseDetail={() => setDetail(null)}
        onNavigate={(t) => selectTrail(t, true)}
        onOpenSegment={onOpenSegment}
        onOpenGallery={(items, index) => setGallery({ items, index })}
      />
      <div id="cesiumWrap">
        <MapView ref={map} trails={allTrails} showRefs={showRefs} showSat={showSat} showTopo={showTopo}
          initialCam={initialCam} onCameraChange={onCameraChange}
          onPick={(slug) => { const t = allTrails.find((x) => x.slug === slug); if (t) selectTrail(t, false); }}
          onActiveChange={setActiveSlug} onViewChange={setViewRect} />
        <div id="layersCtl">
          <button className={"layers-btn" + (layersOpen ? " on" : "")} title={d.layersTitle}
            aria-label={d.layersTitle} aria-pressed={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
            <LayersIcon />
          </button>
          {layersOpen && (
            <div id="layers">
              <button className={"layers-btn" + (showSat ? " on" : "")} title={d.satellite}
                aria-label={d.satellite} aria-pressed={showSat} onClick={() => setShowSat((s) => !s)}>
                <SatIcon />
              </button>
              <button className={"layers-btn" + (showTopo ? " on" : "")} title={d.topo}
                aria-label={d.topo} aria-pressed={showTopo} onClick={() => setShowTopo((s) => !s)}>
                <TopoIcon />
              </button>
              <button className={"layers-btn" + (showRefs ? " on" : "")} title={d.labels}
                aria-label={d.labels} aria-pressed={showRefs} onClick={() => setShowRefs((s) => !s)}>
                <RefsIcon />
              </button>
            </div>
          )}
        </div>
        {gallery && (
          <Gallery items={gallery.items} index={gallery.index}
            onIndex={(i) => setGallery((g) => (g ? { ...g, index: i } : g))}
            onClose={() => setGallery(null)} />
        )}
      </div>
    </div>
  );
}

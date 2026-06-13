import { type CSSProperties, type PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Lang, Segment, Trail } from "./data/types";
import { trails as allTrails, routeTypeLabels } from "./generated/trails";
import { I18N } from "./data/i18n";
import MapView, { type CameraState, type MapHandle } from "./components/MapView";
import Sidebar, { type SortMode } from "./components/Sidebar";
import Gallery, { type GalleryItem } from "./components/Gallery";
import { nameOf, pick, qtyNum, slugify } from "./lib/lang";
import { lineStringsFromWKT } from "./lib/wkt";
import { BASEMAPS, DEFAULT_BASEMAP, OVERLAYS, basemapKeys, overlayKeys } from "./lib/basemaps";

// stable colour/index order, fixed once (matches generated order)
const indexBySlug = new Map(allTrails.map((t, i) => [t.slug, i] as const));
const trailBySlug = new Map(allTrails.map((t) => [t.slug, t] as const));

// resolve a "route" URL value to a trail's stable slug. The URL carries the
// trail name slugified in whatever locale was active when shared; we index every
// locale (plus the stable slug, for old links) so any of them resolves.
const routeIndex = (() => {
  const m = new Map<string, string>();
  for (const t of allTrails) {
    m.set(t.slug, t.slug);
    for (const lng of ["lt", "en", "ru"] as Lang[]) {
      const s = slugify(pick(t.name, lng));
      if (s && !m.has(s)) m.set(s, t.slug);
    }
  }
  return m;
})();
const resolveRoute = (r: string | null) => (r ? routeIndex.get(r) ?? null : null);
// the route value to put in the URL: trail name slugified in the active locale
const routeSlug = (slug: string, lang: Lang) => {
  const t = trailBySlug.get(slug);
  return t ? slugify(nameOf(t, lang)) || slug : slug;
};

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

// framed-image glyph (Material "image"): the basemap picker — a single picture
// standing in for the swappable map background
const BasemapIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
  </svg>
);
// Material Symbols "language" — globe with meridians, the standard locale glyph
const LanguageIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z" />
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
  const [sortDir, setSortDir] = useState<"asc" | "desc">(PARAMS.get("dir") === "desc" ? "desc" : "asc");
  const [themeFilter, setThemeFilter] = useState<Set<string>>(
    new Set((PARAMS.get("theme") || "").split(",").filter(Boolean).map((s) => NS + s)));
  const [catFilter, setCatFilter] = useState<Set<string>>(
    new Set((PARAMS.get("type") || "").split(",").filter(Boolean).map((s) => NS + s)));
  const [attrFilter, setAttrFilter] = useState<Set<string>>(
    new Set((PARAMS.get("attrs") || "").split(",").filter(Boolean)));
  const routeResolved = resolveRoute(routeParam);
  const [activeSlug, setActiveSlug] = useState<string | null>(routeResolved);
  const [detail, setDetail] = useState<Trail | null>(
    () => (routeResolved ? trailBySlug.get(routeResolved) || null : null));
  // single-select basemap + a toggle set of reference overlays. Back-compat: old
  // links used sat=1/topo=1 (exclusive bases) and refs=1 (places & streets).
  const [basemap, setBasemap] = useState<string>(() => {
    const b = PARAMS.get("base");
    if (b && basemapKeys.has(b)) return b;
    if (PARAMS.get("sat") === "1") return "imagery";
    if (PARAMS.get("topo") === "1") return "topographic";
    return DEFAULT_BASEMAP;
  });
  const [overlays, setOverlays] = useState<Set<string>>(() => {
    const csv = PARAMS.get("layers");
    if (csv) return new Set(csv.split(",").filter((k) => overlayKeys.has(k)));
    if (PARAMS.get("refs") === "1") return new Set(["places", "transport"]);
    return new Set();
  });
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(340);
  // mobile bottom-sheet level: 0 collapsed, 1 half, 2 full. dir ping-pongs through
  // half so the toggle cycles half→full→half→collapsed→half→…
  const [sheet, setSheet] = useState<{ level: number; dir: number }>({ level: 1, dir: 1 });
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  const [gallery, setGallery] = useState<{ items: GalleryItem[]; index: number } | null>(null);
  const [viewRect, setViewRect] = useState<ViewRect | null>(null);

  const map = useRef<MapHandle>(null);
  // latest camera pose as a "cam" query value, kept out of React state so panning
  // the map doesn't re-render the whole app
  const camRef = useRef<string | null>(PARAMS.get("cam"));

  // geometry/route-type options, keyed by the ct:RouteType node URI (a universal
  // identifier loaded from the ontology) with a localized label. Keying on the
  // node — not the label — keeps an active filter valid across language switches.
  const routeTypes = useMemo(() =>
    Object.keys(routeTypeLabels)
      .map((uri) => ({ value: uri, label: pick(routeTypeLabels[uri], lang) }))
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase(), lang)), [lang]);

  // trails matching the content filters (search/theme/type/attributes) — but NOT
  // the map's view rectangle. This drives what's drawn on the map; the list adds
  // the in-view narrowing on top.
  const shownSlugs = useMemo(() => {
    const f = search.trim().toLowerCase();
    return new Set(allTrails.filter((t) => {
      if (f && !Object.values(t.name).join(" ").toLowerCase().includes(f)) return false;
      if (themeFilter.size && !t.categories.some((c) => themeFilter.has(c))) return false;
      if (catFilter.size && !catFilter.has(t.routeType)) return false;
      if (attrFilter.size && ![...attrFilter].every((a) => t.props.includes(a))) return false;
      return true;
    }).map((t) => t.slug));
  }, [search, themeFilter, catFilter, attrFilter, lang]);

  const visible = useMemo(() => {
    const out = allTrails.filter((t) => {
      if (!shownSlugs.has(t.slug)) return false;
      if (viewRect) {
        const p = trailPoints.get(t.slug);
        if (!p) return false;
        const [lng, lat] = p;
        if (lng < viewRect.w || lng > viewRect.e || lat < viewRect.s || lat > viewRect.n) return false;
      }
      return true;
    });
    const dir = sortDir === "desc" ? -1 : 1;
    out.sort((a, b) => {
      let r: number;
      if (sortMode === "dist") r = qtyNum(a.distance) - qtyNum(b.distance);
      else if (sortMode === "dur") r = qtyNum(a.duration) - qtyNum(b.duration);
      else r = nameOf(a, lang).toLowerCase().localeCompare(nameOf(b, lang).toLowerCase(), lang);
      return r * dir;
    });
    return out;
  }, [shownSlugs, sortMode, sortDir, lang, viewRect]);

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

  const toggleTheme = (key: string) => setThemeFilter((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const toggleCat = (key: string) => setCatFilter((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const toggleOverlay = (key: string) => setOverlays((prev) => {
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
    if (sortDir !== "asc") p.set("dir", sortDir);
    if (themeFilter.size) p.set("theme", [...themeFilter].map((u) => u.startsWith(NS) ? u.slice(NS.length) : u).join(","));
    if (catFilter.size) p.set("type", [...catFilter].map((u) => u.startsWith(NS) ? u.slice(NS.length) : u).join(","));
    if (attrFilter.size) p.set("attrs", [...attrFilter].join(","));
    if (activeSlug) p.set("route", routeSlug(activeSlug, lang));
    if (basemap !== DEFAULT_BASEMAP) p.set("base", basemap);
    if (overlays.size) p.set("layers", [...overlays].join(","));
    if (camRef.current) p.set("cam", camRef.current);
    pushUrl(p);
  }, [lang, search, sortMode, sortDir, themeFilter, catFilter, attrFilter, activeSlug, basemap, overlays]);

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

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // desktop: drag the sidebar/map seam to resize the panel (clamped 240–640px).
  // clientX is measured from the viewport's left edge, where the sidebar starts.
  const startResize = (e: RPointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setSidebarWidth(Math.min(640, Math.max(240, ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.userSelect = "none";
  };

  // mobile: step the sheet one level, reversing direction at each end so it always
  // passes back through "half" before flipping (half→full→half→collapsed→half…)
  const cycleSheet = () => setSheet(({ level, dir }) => {
    let next = level + dir, d2 = dir;
    if (next > 2) { next = 1; d2 = -1; }
    else if (next < 0) { next = 1; d2 = 1; }
    return { level: next, dir: d2 };
  });

  const appCls = isMobile
    ? (sheet.level === 0 ? "sheet-collapsed" : sheet.level === 2 ? "sheet-full" : "")
    : (sidebarOpen ? "" : "sidebar-collapsed");

  const d = I18N[lang];

  return (
    <div id="app" className={appCls} style={{ "--sidebar-w": `${sidebarWidth}px` } as CSSProperties}>
      <Sidebar
        lang={lang} total={allTrails.length} trails={allTrails} visible={visible}
        indexOf={(t) => indexBySlug.get(t.slug)!} activeSlug={activeSlug}
        search={search} sortMode={sortMode} sortDir={sortDir} themeFilter={themeFilter} catFilter={catFilter}
        attrFilter={attrFilter} routeTypes={routeTypes} detail={detail}
        onSearch={setSearch} onSort={setSortMode} onToggleDir={() => setSortDir((v) => (v === "asc" ? "desc" : "asc"))}
        onToggleTheme={toggleTheme} onToggleCat={toggleCat}
        onToggleAttr={toggleAttr}
        onClearFilters={() => { setThemeFilter(new Set()); setCatFilter(new Set()); setAttrFilter(new Set()); }}
        onResetView={() => map.current?.resetView()}
        onSelect={(t) => selectTrail(t, false)}
        onFly={(t) => selectTrail(t, true)}
        onHover={(t) => map.current?.setHover(t ? indexBySlug.get(t.slug)! : null)}
        onCloseDetail={() => setDetail(null)}
        onNavigate={(t) => selectTrail(t, true)}
        onOpenSegment={onOpenSegment}
        onOpenGallery={(items, index) => setGallery({ items, index })}
      />
      <button className="sidebar-toggle" title={d.collapse} aria-label={d.collapse}
        aria-pressed={isMobile ? sheet.level === 0 : !sidebarOpen}
        onClick={() => (isMobile ? cycleSheet() : setSidebarOpen((o) => !o))}>
        <span className={"chev" + (isMobile && sheet.dir === -1 ? " down" : "")}>
          {isMobile ? "‹" : sidebarOpen ? "‹" : "›"}</span>
      </button>
      {!isMobile && <div className="sidebar-resizer" onPointerDown={startResize} />}
      <div id="cesiumWrap">
        <MapView ref={map} trails={allTrails} shownSlugs={shownSlugs} basemap={basemap} overlays={overlays}
          initialCam={initialCam} onCameraChange={onCameraChange}
          onPick={(slug) => { const t = allTrails.find((x) => x.slug === slug); if (t) selectTrail(t, false); }}
          onActiveChange={setActiveSlug} onViewChange={setViewRect} />
        <div id="layersCtl">
          <button className={"layers-btn" + (basemapOpen ? " on" : "")} title={d.basemapTitle}
            aria-label={d.basemapTitle} aria-pressed={basemapOpen}
            onClick={() => { setBasemapOpen((o) => !o); setLayersOpen(false); }}>
            <BasemapIcon />
          </button>
          <button className={"layers-btn" + (layersOpen ? " on" : "")} title={d.layersTitle}
            aria-label={d.layersTitle} aria-pressed={layersOpen}
            onClick={() => { setLayersOpen((o) => !o); setBasemapOpen(false); }}>
            <LayersIcon />
          </button>
          {basemapOpen && (
            <div className="basemap-gallery">
              {BASEMAPS.map((b) => (
                <button key={b.key} className={"bm-item" + (b.key === basemap ? " on" : "")}
                  title={pick(b.label, lang)} aria-pressed={b.key === basemap}
                  onClick={() => { setBasemap(b.key); setBasemapOpen(false); }}>
                  <img src={b.thumb} alt="" loading="lazy" />
                  <span>{pick(b.label, lang)}</span>
                </button>
              ))}
            </div>
          )}
          {layersOpen && (
            <div className="layers-list">
              {OVERLAYS.map((o) => (
                <button key={o.key} className={overlays.has(o.key) ? "on" : ""}
                  aria-pressed={overlays.has(o.key)} onClick={() => toggleOverlay(o.key)}>
                  {pick(o.label, lang)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div id="langCtl">
          <button className={"layers-btn" + (langOpen ? " on" : "")} title={d.language}
            aria-label={d.language} aria-pressed={langOpen} onClick={() => setLangOpen((o) => !o)}>
            <LanguageIcon />
          </button>
          {langOpen && (
            <div className="langmenu">
              {([["lt", "Lietuvių"], ["en", "English"], ["ru", "Русский"]] as [Lang, string][]).map(([code, name]) => (
                <button key={code} className={code === lang ? "on" : ""}
                  onClick={() => { setLang(code); setLangOpen(false); }}>{name}</button>
              ))}
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

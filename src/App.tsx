import { useMemo, useRef, useState } from "react";
import type { Lang, Segment, Trail } from "./data/types";
import { trails as allTrails } from "./generated/trails";
import { I18N } from "./data/i18n";
import MapView, { type MapHandle } from "./components/MapView";
import Sidebar, { type SortMode } from "./components/Sidebar";
import DetailPanel from "./components/DetailPanel";
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

export default function App() {
  const [lang, setLang] = useState<Lang>("en");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [themeFilter, setThemeFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [attrFilter, setAttrFilter] = useState<Set<string>>(new Set());
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<Trail | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showRoads, setShowRoads] = useState(true);
  const [gallery, setGallery] = useState<{ items: GalleryItem[]; index: number } | null>(null);
  const [viewRect, setViewRect] = useState<ViewRect | null>(null);

  const map = useRef<MapHandle>(null);

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

  const d = I18N[lang];

  return (
    <div id="app">
      <Sidebar
        lang={lang} total={allTrails.length} trails={allTrails} visible={visible}
        indexOf={(t) => indexBySlug.get(t.slug)!} activeSlug={activeSlug}
        search={search} sortMode={sortMode} themeFilter={themeFilter} catFilter={catFilter}
        attrFilter={attrFilter} routeTypes={routeTypes}
        onSearch={setSearch} onSort={setSortMode} onTheme={setThemeFilter} onCat={setCatFilter}
        onToggleAttr={toggleAttr} onLang={setLang}
        onResetView={() => map.current?.resetView()}
        onSelect={(t) => selectTrail(t, false)}
        onFly={(t) => selectTrail(t, true)}
      />
      <div id="cesiumWrap">
        <MapView ref={map} trails={allTrails} showLabels={showLabels} showRoads={showRoads}
          onPick={(slug) => { const t = allTrails.find((x) => x.slug === slug); if (t) selectTrail(t, false); }}
          onActiveChange={setActiveSlug} onViewChange={setViewRect} />
        <div id="layers">
          <label><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> {d.labels}</label>
          <label><input type="checkbox" checked={showRoads} onChange={(e) => setShowRoads(e.target.checked)} /> {d.roads}</label>
        </div>
        <DetailPanel trail={detail} lang={lang} onClose={() => setDetail(null)}
          onOpenSegment={onOpenSegment}
          onOpenGallery={(items, index) => setGallery({ items, index })} />
        {gallery && (
          <Gallery items={gallery.items} index={gallery.index}
            onIndex={(i) => setGallery((g) => (g ? { ...g, index: i } : g))}
            onClose={() => setGallery(null)} />
        )}
      </div>
    </div>
  );
}

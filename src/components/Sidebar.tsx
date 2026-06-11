import { useState } from "react";
import type { Lang, Segment, Trail } from "../data/types";
import { I18N } from "../data/i18n";
import { catLabels, propLabels } from "../generated/trails";
import { colorFor, fmtQty, nameOf, pick } from "../lib/lang";
import DetailPanel from "./DetailPanel";
import MultiSelect from "./MultiSelect";
import type { GalleryItem } from "./Gallery";

export type SortMode = "name" | "dist" | "dur";

interface Props {
  lang: Lang;
  total: number;
  trails: Trail[];           // full list (for stable colour index)
  visible: Trail[];          // filtered + sorted list to render
  indexOf: (t: Trail) => number;
  activeSlug: string | null;
  search: string;
  sortMode: SortMode;
  themeFilter: Set<string>;
  catFilter: string;
  attrFilter: Set<string>;
  routeTypes: string[];
  detail: Trail | null;
  onSearch: (v: string) => void;
  onSort: (v: SortMode) => void;
  onToggleTheme: (key: string) => void;
  onCat: (v: string) => void;
  onToggleAttr: (key: string) => void;
  onLang: (l: Lang) => void;
  onResetView: () => void;
  onSelect: (t: Trail) => void;
  onFly: (t: Trail) => void;
  onCloseDetail: () => void;
  onNavigate: (t: Trail) => void;
  onOpenSegment: (seg: Segment | null) => void;
  onOpenGallery: (items: GalleryItem[], index: number) => void;
}

// Material Symbols "my_location" (filled) — Google Maps' show-on-map glyph
const Reticle = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
  </svg>
);

const Funnel = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 4 21 4 14 12.5 14 20 10 22 10 12.5 3 4" />
  </svg>
);

// ascending/descending bars — the sort affordance on the list header
const SortIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="13" y2="6" /><line x1="4" y1="12" x2="11" y2="12" /><line x1="4" y1="18" x2="9" y2="18" />
    <polyline points="17 7 17 18 20 15" /><line x1="17" y1="18" x2="14" y2="15" />
  </svg>
);

export default function Sidebar(p: Props) {
  const d = I18N[p.lang];
  const [filtersOpen, setFiltersOpen] = useState(false);
  const themeUris = Object.keys(catLabels).sort((a, b) =>
    pick(catLabels[a], p.lang).toLowerCase().localeCompare(pick(catLabels[b], p.lang).toLowerCase(), p.lang));
  const attrKeys = Object.keys(propLabels).sort((a, b) =>
    pick(propLabels[a], p.lang).toLowerCase().localeCompare(pick(propLabels[b], p.lang).toLowerCase(), p.lang));

  const cls = [filtersOpen ? "filters-open" : "", p.detail ? "detail-open" : ""].filter(Boolean).join(" ");

  return (
    <div id="sidebar" className={cls}>
      <div id="controls">
        <input id="search" type="search" autoComplete="off" placeholder={d.search}
          value={p.search} onChange={(e) => p.onSearch(e.target.value)} />
        <button className={"funnel" + (filtersOpen ? " on" : "")} aria-label={d.attrLbl}
          aria-pressed={filtersOpen} title={d.attrLbl} onClick={() => setFiltersOpen((o) => !o)}>
          <Funnel />
          {p.attrFilter.size > 0 && <span className="fbadge">{p.attrFilter.size}</span>}
        </button>
        <button className="act" onClick={p.onResetView}>{d.loadAll}</button>
        <div id="filters">
          <div className="fld"><span>{d.catLbl}</span>
            <MultiSelect placeholder={d.allCats} selected={p.themeFilter} onToggle={p.onToggleTheme}
              options={themeUris.map((u) => ({ value: u, label: pick(catLabels[u], p.lang) }))} />
          </div>
          <label className="fld"><span>{d.typeLbl}</span>
            <select value={p.catFilter} onChange={(e) => p.onCat(e.target.value)}>
              <option value="">{d.allTypes}</option>
              {p.routeTypes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="fld"><span>{d.attrLbl}</span>
            <MultiSelect placeholder={d.allAttrs} selected={p.attrFilter} onToggle={p.onToggleAttr}
              options={attrKeys.map((k) => ({ value: k, label: pick(propLabels[k], p.lang) }))} />
          </div>
        </div>
      </div>

      <div id="count">
        <span className="cnum"><span>{p.visible.length}</span> / {p.total} {d.shown}</span>
        <label className="sortctl" title={d.sortLbl}>
          <SortIcon />
          <select value={p.sortMode} onChange={(e) => p.onSort(e.target.value as SortMode)} aria-label={d.sortLbl}>
            <option value="name">{d.sortName}</option>
            <option value="dist">{d.sortDist}</option>
            <option value="dur">{d.sortDur}</option>
          </select>
        </label>
      </div>

      <div id="list">
        {p.visible.map((t) => {
          const i = p.indexOf(t);
          const meta = [fmtQty(t.distance, p.lang), fmtQty(t.duration, p.lang), pick(t.routeType, p.lang)].filter(Boolean).join(" · ");
          return (
            <div key={t.slug} className={"item" + (t.slug === p.activeSlug ? " active" : "")}>
              <div className="body" onClick={() => p.onSelect(t)}>
                <div className="nm"><span className="dot" style={{ background: colorFor(i) }} />{nameOf(t, p.lang)}</div>
                {meta && <div className="meta">{meta}</div>}
              </div>
              <button className="fly" title={d.flyTo} aria-label={d.flyTo}
                onClick={(e) => { e.stopPropagation(); p.onFly(t); }}><Reticle /></button>
            </div>
          );
        })}
      </div>

      {p.detail && (
        <DetailPanel trail={p.detail} lang={p.lang} onClose={p.onCloseDetail}
          onNavigate={p.onNavigate} onOpenSegment={p.onOpenSegment} onOpenGallery={p.onOpenGallery} />
      )}

      <div id="langs">
        {(["lt", "en", "ru"] as Lang[]).map((l) => (
          <button key={l} className={l === p.lang ? "on" : ""} onClick={() => p.onLang(l)}>{l.toUpperCase()}</button>
        ))}
      </div>
    </div>
  );
}

import type { Lang, Trail } from "../data/types";
import { I18N } from "../data/i18n";
import { catLabels, propLabels } from "../generated/trails";
import { colorFor, fmtQty, nameOf, pick } from "../lib/lang";

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
  themeFilter: string;
  catFilter: string;
  attrFilter: Set<string>;
  routeTypes: string[];
  onSearch: (v: string) => void;
  onSort: (v: SortMode) => void;
  onTheme: (v: string) => void;
  onCat: (v: string) => void;
  onToggleAttr: (key: string) => void;
  onLang: (l: Lang) => void;
  onResetView: () => void;
  onSelect: (t: Trail) => void;
  onFly: (t: Trail) => void;
}

const Reticle = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx="12" cy="12" r="6" />
    <line x1="12" y1="1" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="23" />
    <line x1="1" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="23" y2="12" />
  </svg>
);

export default function Sidebar(p: Props) {
  const d = I18N[p.lang];
  const themeUris = Object.keys(catLabels).sort((a, b) =>
    pick(catLabels[a], p.lang).toLowerCase().localeCompare(pick(catLabels[b], p.lang).toLowerCase(), p.lang));
  const attrKeys = Object.keys(propLabels).sort((a, b) =>
    pick(propLabels[a], p.lang).toLowerCase().localeCompare(pick(propLabels[b], p.lang).toLowerCase(), p.lang));

  return (
    <div id="sidebar">
      <header>
        <div>
          <h1>{d.title}</h1>
          <p><span>{p.total}</span> {d.subtitle}</p>
        </div>
        <div id="langs">
          {(["lt", "en", "ru"] as Lang[]).map((l) => (
            <button key={l} className={l === p.lang ? "on" : ""} onClick={() => p.onLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </header>

      <div id="controls">
        <input id="search" type="search" autoComplete="off" placeholder={d.search}
          value={p.search} onChange={(e) => p.onSearch(e.target.value)} />
        <button className="act" onClick={p.onResetView}>{d.loadAll}</button>
        <div id="filters">
          <label className="fld"><span>{d.sortLbl}</span>
            <select value={p.sortMode} onChange={(e) => p.onSort(e.target.value as SortMode)}>
              <option value="name">{d.sortName}</option>
              <option value="dist">{d.sortDist}</option>
              <option value="dur">{d.sortDur}</option>
            </select>
          </label>
          <label className="fld"><span>{d.catLbl}</span>
            <select value={p.themeFilter} onChange={(e) => p.onTheme(e.target.value)}>
              <option value="">{d.allCats}</option>
              {themeUris.map((u) => <option key={u} value={u}>{pick(catLabels[u], p.lang)}</option>)}
            </select>
          </label>
          <label className="fld"><span>{d.typeLbl}</span>
            <select value={p.catFilter} onChange={(e) => p.onCat(e.target.value)}>
              <option value="">{d.allTypes}</option>
              {p.routeTypes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <details id="attrBox">
            <summary>{d.attrLbl} <span id="attrCount">{p.attrFilter.size ? `(${p.attrFilter.size})` : ""}</span></summary>
            <div id="attrList">
              {attrKeys.map((k) => (
                <label key={k}>
                  <input type="checkbox" checked={p.attrFilter.has(k)} onChange={() => p.onToggleAttr(k)} />
                  {pick(propLabels[k], p.lang)}
                </label>
              ))}
            </div>
          </details>
        </div>
      </div>

      <div id="count">{p.visible.length} {d.shown}</div>

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
    </div>
  );
}

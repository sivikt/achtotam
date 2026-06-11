import { useEffect, useState } from "react";
import type { Lang, RoutePoint, Segment, Trail } from "../data/types";
import type { GalleryItem } from "./Gallery";
import { I18N } from "../data/i18n";
import { catLabels, propLabels } from "../generated/trails";
import { fmtQty, nameOf, pick } from "../lib/lang";

interface Props {
  trail: Trail | null;
  lang: Lang;
  onClose: () => void;
  onNavigate: (t: Trail) => void;
  onOpenSegment: (seg: Segment | null) => void;
  onOpenGallery: (items: GalleryItem[], index: number) => void;
}

// same reticle icon as the per-track "fly to" button in the list:
// Material Symbols "my_location" (filled)
const NavIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function Thumbs({ imgs, size, onOpen }: {
  imgs: string[]; size: "lg" | "sm"; onOpen: (items: GalleryItem[], index: number) => void;
}) {
  if (!imgs.length) return null;
  const shown = imgs.slice(0, 6);
  // both the thumbnail and the full-size gallery image use the same (remote) URL
  const items: GalleryItem[] = shown.map((src) => ({ full: src, thumb: src }));
  return (
    <div className={size === "lg" ? "thumbs" : "pthumbs"}>
      {shown.map((src, n) => (
        <img key={n} loading="lazy" src={encodeURI(src)} alt="" onClick={() => onOpen(items, n)} />
      ))}
    </div>
  );
}

export default function DetailPanel({ trail, lang, onClose, onNavigate, onOpenSegment, onOpenGallery }: Props) {
  const [openSeg, setOpenSeg] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const d = I18N[lang];

  // reset transient state whenever the shown trail changes
  useEffect(() => { setOpenSeg(null); onOpenSegment(null); }, [trail?.slug]);

  const copyCoord = (key: string, p: RoutePoint) => {
    navigator.clipboard?.writeText(p.address || `${p.lat}, ${p.lng}`);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
  };

  const endpointRow = (key: "start" | "finish", label: string, p: RoutePoint) => (
    <div className={"ept " + key}>
      <span className="pin" />
      <span className="elbl">{label}</span>
      <span className="ecoord">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</span>
      <button className={"ecopy" + (copied === key ? " ok" : "")} title={d.copy} aria-label={d.copy}
        onClick={() => copyCoord(key, p)}>
        {copied === key ? <CheckIcon /> : <CopyIcon />}
      </button>
      {p.address && <span className="eaddr">· {p.address}</span>}
    </div>
  );

  if (!trail) return null;
  const t = trail;
  const imgs = t.images.length ? t.images : t.localImages;
  const meta = [fmtQty(t.distance, lang), fmtQty(t.duration, lang), pick(t.routeType, lang)].filter(Boolean).join(" · ");

  const toggleSeg = (k: number, seg: Segment) => {
    if (openSeg === k) { setOpenSeg(null); onOpenSegment(null); }
    else { setOpenSeg(k); onOpenSegment(seg.wkt ? seg : null); }
  };

  return (
    <div id="detail" className="open">
      <div className="dhead">
        <button className="dback" title={d.loadAll} aria-label={d.loadAll} onClick={onClose}>‹</button>
        <div><h2>{nameOf(t, lang)}</h2><div className="dmeta">{meta}</div></div>
        <button className="dnav" title={d.flyTo} aria-label={d.flyTo} onClick={() => onNavigate(t)}><NavIcon /></button>
      </div>
      <div className="dbody">
        <Thumbs imgs={imgs} size="lg" onOpen={onOpenGallery} />
        <div className="badges">
          {t.categories.length > 0 && (
            <div className="bgroup">
              <span className="bglbl">{d.grpSubjective}</span>
              {t.categories.map((u) => <span key={u} className="badge cat">{pick(catLabels[u] || {}, lang)}</span>)}
            </div>
          )}
          {t.props.length > 0 && (
            <div className="bgroup">
              <span className="bglbl">{d.grpFacts}</span>
              {t.props.map((pr) => <span key={pr} className="badge">{pick(propLabels[pr] || {}, lang)}</span>)}
            </div>
          )}
        </div>
        {(t.start || t.finish) && (
          <div className="endpoints">
            {t.start && endpointRow("start", d.start, t.start)}
            {t.finish && endpointRow("finish", d.finish, t.finish)}
          </div>
        )}
        <div className="ddesc">{pick(t.desc, lang)}</div>
        {t.segments.length > 0 && (
          <div id="dParts">
            <div className="ptitle">{d.parts} ({t.segments.length})</div>
            {t.segments.map((seg, k) => {
              const simgs = seg.images.length ? seg.images : seg.localImages;
              const dsc = pick(seg.desc, lang);
              return (
                <div key={k} className={"part" + (openSeg === k ? " open" : "")}>
                  <div className="phead" onClick={() => toggleSeg(k, seg)}>
                    <span className="pnum">{seg.num || k + 1}</span>
                    <span className="pname">{pick(seg.name, lang)}</span>
                    <span className="pcaret">&#8250;</span>
                  </div>
                  <div className="pbody">
                    <Thumbs imgs={simgs} size="sm" onOpen={onOpenGallery} />
                    {dsc && <div className="pdesc">{dsc}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {t.map && <a className="dlink" href={t.map} target="_blank" rel="noopener noreferrer">{d.openMap}</a>}
        {t.link && <a className="dlink" href={t.link} target="_blank" rel="noopener noreferrer">{d.openSite}</a>}
      </div>
    </div>
  );
}

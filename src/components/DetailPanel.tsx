import { useEffect, useState } from "react";
import type { Lang, Segment, Trail } from "../data/types";
import type { GalleryItem } from "./Gallery";
import { I18N } from "../data/i18n";
import { catLabels, propLabels } from "../generated/trails";
import { fmtQty, nameOf, pick } from "../lib/lang";

interface Props {
  trail: Trail | null;
  lang: Lang;
  onClose: () => void;
  onOpenSegment: (seg: Segment | null) => void;
  onOpenGallery: (items: GalleryItem[], index: number) => void;
}

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

export default function DetailPanel({ trail, lang, onClose, onOpenSegment, onOpenGallery }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [openSeg, setOpenSeg] = useState<number | null>(null);
  const d = I18N[lang];

  // reset transient state whenever the shown trail changes
  useEffect(() => { setCollapsed(false); setOpenSeg(null); onOpenSegment(null); }, [trail?.slug]);

  if (!trail) return null;
  const t = trail;
  const imgs = t.images.length ? t.images : t.localImages;
  const meta = [fmtQty(t.distance, lang), fmtQty(t.duration, lang), pick(t.routeType, lang), t.address].filter(Boolean).join(" · ");

  const toggleSeg = (k: number, seg: Segment) => {
    if (openSeg === k) { setOpenSeg(null); onOpenSegment(null); }
    else { setOpenSeg(k); onOpenSegment(seg.wkt ? seg : null); }
  };

  return (
    <div id="detail" className={"open" + (collapsed ? " collapsed" : "")}>
      <div className="dhead">
        <div><h2>{nameOf(t, lang)}</h2><div className="dmeta">{meta}</div></div>
        <div className="dhead-btns">
          <button className="dclose" id="dCollapse" title={d.collapse} onClick={() => setCollapsed((c) => !c)}>▾</button>
          <button className="dclose" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="dbody">
        <Thumbs imgs={imgs} size="lg" onOpen={onOpenGallery} />
        <div className="badges">
          {t.categories.map((u) => <span key={u} className="badge cat">{pick(catLabels[u] || {}, lang)}</span>)}
          {t.props.map((pr) => (
            <span key={pr} className={pr === "suitableForCycling" ? "badge infer" : "badge"}>{pick(propLabels[pr] || {}, lang)}</span>
          ))}
        </div>
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

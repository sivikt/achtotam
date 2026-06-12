import { useEffect, useState } from "react";
import type { Lang, RoutePoint, Segment, Trail } from "../data/types";
import type { GalleryItem } from "./Gallery";
import { I18N } from "../data/i18n";
import { catLabels, propLabels, routeTypeLabels, authors } from "../generated/trails";
import { fmtQty, nameOf, pick, slugify } from "../lib/lang";

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
// Material Symbols "location_on" (filled) — map-pin marking start/finish
const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 11 7 11s7-5.75 7-11c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
  </svg>
);
// Material Symbols "more_vert" — the standard overflow / context-menu glyph
const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
  </svg>
);
const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M21.94 4.06c.26-1.1-.5-1.6-1.27-1.32L2.9 9.6c-1.06.42-1.05 1.02-.18 1.28l4.5 1.4 1.74 5.5c.22.6.4.83.82.83.42 0 .6-.19.83-.42l2.24-2.17 4.66 3.44c.86.47 1.47.23 1.68-.8z" />
  </svg>
);
const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);
const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
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
  const [menuOpen, setMenuOpen] = useState(false);
  const d = I18N[lang];

  // reset transient state whenever the shown trail changes
  useEffect(() => { setOpenSeg(null); setMenuOpen(false); onOpenSegment(null); }, [trail?.slug]);

  const copyCoord = (key: string, p: RoutePoint) => {
    navigator.clipboard?.writeText(`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
  };

  const endpointRow = (key: "start" | "finish", label: string, p: RoutePoint) => (
    <div className={"ept " + key}>
      <span className="epin" title={label} aria-label={label}><PinIcon /></span>
      <span className="eaddr">{p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}</span>
    </div>
  );

  if (!trail) return null;
  const t = trail;
  const imgs = t.images.length ? t.images : t.localImages;
  const author = t.author ? authors[t.author] : null;
  const meta = [fmtQty(t.distance, lang), fmtQty(t.duration, lang),
    t.routeType ? pick(routeTypeLabels[t.routeType], lang) : ""].filter(Boolean).join(" · ");

  const toggleSeg = (k: number, seg: Segment) => {
    if (openSeg === k) { setOpenSeg(null); onOpenSegment(null); }
    else { setOpenSeg(k); onOpenSegment(seg.wkt ? seg : null); }
  };

  // share the current page URL with this route pinned; App already mirrors the
  // selected route (and camera/filters) into the query string.
  const shareUrl = () => {
    const u = new URL(window.location.href);
    u.searchParams.set("route", slugify(nameOf(t, lang)) || t.slug);
    return u.toString();
  };
  // run the full link through TinyURL (CORS-enabled, returns a clean short URL
  // with no commas so Telegram links it correctly); fall back on any failure.
  const shorten = async (url: string) => {
    try {
      const r = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
      if (r.ok) { const s = (await r.text()).trim(); if (s.startsWith("http")) return s; }
    } catch { /* offline or blocked */ }
    return url;
  };
  const shareTelegram = async () => {
    // open the tab synchronously (preserves the click gesture so it isn't blocked),
    // then point it at the share URL once the short link resolves.
    const win = window.open("about:blank", "_blank");
    const short = await shorten(shareUrl());
    const tg = `https://t.me/share/url?url=${encodeURIComponent(short)}&text=${encodeURIComponent(nameOf(t, lang))}`;
    if (win) win.location.href = tg; else window.open(tg, "_blank", "noopener,noreferrer");
    setMenuOpen(false);
  };
  // Instagram has no web share-link; use the native share sheet when available
  // (lets the user pick Instagram), otherwise copy the link to paste manually.
  const shareInstagram = async () => {
    const short = await shorten(shareUrl());
    if (navigator.share) {
      try { await navigator.share({ title: nameOf(t, lang), url: short }); setMenuOpen(false); return; }
      catch { /* dismissed or lost activation — fall through to copy */ }
    }
    navigator.clipboard?.writeText(short);
    setCopied("share");
    setTimeout(() => setCopied((c) => (c === "share" ? null : c)), 1500);
  };

  return (
    <div id="detail" className="open">
      <div className="dhead">
        <button className="dback" title={d.loadAll} aria-label={d.loadAll} onClick={onClose}>‹</button>
        <div><h2>{nameOf(t, lang)}</h2><div className="dmeta">{meta}</div></div>
        <div className="dactions">
          <button className="dnav sm" title={d.flyTo} aria-label={d.flyTo} onClick={() => onNavigate(t)}><NavIcon /></button>
          <div className="dshare">
            <button className="dnav sm" title={d.menu} aria-label={d.menu} aria-pressed={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}><MenuIcon /></button>
            {menuOpen && (
              <div className="sharemenu">
                <button onClick={shareTelegram}><TelegramIcon /> Telegram</button>
                <button onClick={shareInstagram}><InstagramIcon /> Instagram</button>
                {t.start && <button onClick={() => { copyCoord("start", t.start!); setMenuOpen(false); }}><CopyIcon /> {d.copyStart}</button>}
                {t.finish && <button onClick={() => { copyCoord("finish", t.finish!); setMenuOpen(false); }}><CopyIcon /> {d.copyFinish}</button>}
                {copied === "share" && <span className="sharenote"><CheckIcon /> {d.linkCopied}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="dbody">
        {t.start && (
          <div className="endpoints">
            {endpointRow("start", d.start, t.start)}
          </div>
        )}
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
        <div className="ddesc-sec">
          <span className="bglbl">{d.grpDesc}</span>
          <Thumbs imgs={imgs} size="lg" onOpen={onOpenGallery} />
          <div className="ddesc">{pick(t.desc, lang)}</div>
        </div>
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
        {author && (
          <div className="dauthor">
            <span className="bglbl">{d.author}</span>
            <div className="arow">
              <span className="aname">{author.name}</span>
              {author.facebook && (
                <a className="asocial" href={author.facebook} target="_blank" rel="noopener noreferrer"
                  title="Facebook" aria-label="Facebook"><FacebookIcon /></a>
              )}
              {author.instagram && (
                <a className="asocial" href={author.instagram} target="_blank" rel="noopener noreferrer"
                  title="Instagram" aria-label="Instagram"><InstagramIcon /></a>
              )}
            </div>
          </div>
        )}
        {t.map && <a className="dlink" href={t.map} target="_blank" rel="noopener noreferrer">{d.openMap}</a>}
        {t.link && <a className="dlink" href={t.link} target="_blank" rel="noopener noreferrer">{d.openSite}</a>}
      </div>
    </div>
  );
}

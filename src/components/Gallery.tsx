import { useEffect, useRef } from "react";

export interface GalleryItem { full: string; thumb: string }

interface Props {
  items: GalleryItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

export default function Gallery({ items, index, onIndex, onClose }: Props) {
  const step = (d: number) => onIndex((index + d + items.length) % items.length);

  // horizontal swipe (touch) navigates between images; a short flick past the
  // threshold steps one image — left → next, right → previous
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null || items.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length]);

  // keep the active thumbnail in view as the selection moves (swipe/keys/click)
  const activeThumb = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    activeThumb.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  if (!items.length) return null;
  const cur = items[index];

  return (
    <div className="gallery" onClick={onClose}>
      <button className="gclose" onClick={onClose} aria-label="Close">×</button>
      <div className="gstage" onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <img className="gbig" src={encodeURI(cur.full)} alt="" />
      </div>
      {items.length > 1 && (
        <div className="gstrip" onClick={(e) => e.stopPropagation()}>
          {items.map((it, i) => (
            <img key={i} ref={i === index ? activeThumb : null}
              className={"gthumb" + (i === index ? " on" : "")}
              src={encodeURI(it.thumb)} alt="" onClick={() => onIndex(i)} />
          ))}
        </div>
      )}
    </div>
  );
}

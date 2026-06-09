import { useEffect } from "react";

export interface GalleryItem { full: string; thumb: string }

interface Props {
  items: GalleryItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

export default function Gallery({ items, index, onIndex, onClose }: Props) {
  const step = (d: number) => onIndex((index + d + items.length) % items.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length]);

  if (!items.length) return null;
  const cur = items[index];

  return (
    <div className="gallery" onClick={onClose}>
      <button className="gclose" onClick={onClose} aria-label="Close">×</button>
      <div className="gstage" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 && <button className="gnav gprev" onClick={() => step(-1)} aria-label="Previous">‹</button>}
        <img className="gbig" src={encodeURI(cur.full)} alt="" />
        {items.length > 1 && <button className="gnav gnext" onClick={() => step(1)} aria-label="Next">›</button>}
      </div>
      {items.length > 1 && (
        <div className="gstrip" onClick={(e) => e.stopPropagation()}>
          {items.map((it, i) => (
            <img key={i} className={"gthumb" + (i === index ? " on" : "")}
              src={encodeURI(it.thumb)} alt="" onClick={() => onIndex(i)} />
          ))}
        </div>
      )}
    </div>
  );
}

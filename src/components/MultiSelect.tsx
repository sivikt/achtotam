import { useEffect, useRef, useState } from "react";

export interface Opt { value: string; label: string }

interface Props {
  options: Opt[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  placeholder: string; // shown when nothing is selected
}

const Caret = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export default function MultiSelect({ options, selected, onToggle, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // close on outside click / Escape so the dropdown behaves like a native one
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const sel = options.filter((o) => selected.has(o.value));
  const empty = sel.length === 0;

  return (
    <div className="msel" ref={ref}>
      <button type="button" className="msel-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={"msel-sum" + (empty ? " ph" : "")}>{empty ? placeholder : sel.map((o) => o.label).join(", ")}</span>
        {!empty && <span className="msel-badge">{sel.length}</span>}
        <span className="msel-caret"><Caret /></span>
      </button>
      {open && (
        <div className="msel-pop">
          {options.map((o) => (
            <label key={o.value}>
              <input type="checkbox" checked={selected.has(o.value)} onChange={() => onToggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

import type { Lang, LangMap, Quantity, Trail } from "../data/types";

export function pick(m: LangMap, lang: Lang): string {
  return m[lang] || m.en || m.lt || Object.values(m)[0] || "";
}
export function fmtQty(q: Quantity | null, lang: Lang): string {
  return q ? (q.value + " " + pick(q.unit, lang)).trim() : "";
}
export function qtyNum(q: Quantity | null): number {
  const n = q ? parseFloat(q.value) : NaN;
  return isFinite(n) ? n : Infinity; // missing sorts last
}
export function nameOf(t: Trail, lang: Lang): string {
  return pick(t.name, lang);
}

export const palette = ["#ff4d4d", "#ffb000", "#33cc66", "#3399ff", "#cc66ff", "#ff6699", "#00cccc", "#ff8800"];
export const colorFor = (i: number) => palette[i % palette.length];

// WKT → flat [lon,lat,...] arrays. A MULTILINESTRING yields several disconnected
// pieces drawn separately; a LINESTRING yields one.
function pairsToFlat(s: string): number[] | null {
  const flat: number[] = [];
  for (const pair of s.split(",")) {
    const [lon, lat] = pair.trim().split(/\s+/).map(Number);
    if (isFinite(lon) && isFinite(lat)) flat.push(lon, lat);
  }
  return flat.length >= 4 ? flat : null;
}

export function lineStringsFromWKT(wkt: string): number[][] | null {
  const out: number[][] = [];
  const mm = /MULTILINESTRING\s*\((.*)\)\s*$/i.exec(wkt);
  if (mm) {
    let m: RegExpExecArray | null;
    const re = /\(([^()]*)\)/g;
    while ((m = re.exec(mm[1]))) { const f = pairsToFlat(m[1]); if (f) out.push(f); }
    return out.length ? out : null;
  }
  const ls = /LINESTRING\s*\((.*)\)\s*$/i.exec(wkt);
  if (ls) { const f = pairsToFlat(ls[1]); if (f) out.push(f); }
  return out.length ? out : null;
}

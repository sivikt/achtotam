import { useEffect, useState } from "react";
import { select, type Row } from "./store";

export interface SparqlState {
  rows: Row[];
  loading: boolean;
  error: Error | null;
}

// Run a SELECT and expose its rows to a view. Re-runs whenever `query` (or any
// extra `deps`) change; a stale result from a superseded query is discarded.
// Pass `null` to skip (e.g. no trail selected yet).
export function useSparql(query: string | null, deps: unknown[] = []): SparqlState {
  const [state, setState] = useState<SparqlState>({ rows: [], loading: query != null, error: null });
  useEffect(() => {
    if (query == null) { setState({ rows: [], loading: false, error: null }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    select(query).then(
      (rows) => { if (alive) setState({ rows, loading: false, error: null }); },
      (error) => { if (alive) setState({ rows: [], loading: false, error }); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ...deps]);
  return state;
}

// Group rows carrying a lang-tagged literal (value + `${col}_lang`) into a
// { lt, en, ru } map keyed by another column — the SPARQL equivalent of the old
// byLang() helper in compile_ttl.mjs.
export function byLang(rows: Row[], keyCol: string, valCol: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    const key = r[keyCol];
    const val = r[valCol];
    if (key == null || val == null) continue;
    (out[key] ??= {})[r[`${valCol}_lang`] || "lt"] = val;
  }
  return out;
}

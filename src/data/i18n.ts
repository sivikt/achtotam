import { useTrailData } from "../rdf/RdfProvider";
import { pick, type Lang, type LangMap } from "../lib/lang";

// UI strings now live in the graph (source_data/ui.ttl, built by
// scripts/3_build_ui_labels.py) as ct:UILabel individuals. This module resolves
// them into the flat { key: string } shape the components already consume, so
// call sites stay `const d = useStrings(lang); … d.search` — only the source of
// truth moved from a static table to the ontology.
export interface Strings {
  title: string; subtitle: string; search: string; loadAll: string; clear: string;
  osm: string; labels: string; satellite: string; topo: string; layersTitle: string; basemapTitle: string; engineTitle: string; fullscreen: string; language: string; parts: string; shown: string; flyTo: string;
  start: string; finish: string; copy: string; copyStart: string; copyFinish: string; menu: string;
  grpSubjective: string; grpFacts: string; grpDesc: string;
  share: string; shareTelegram: string; shareInstagram: string; linkCopied: string; author: string;
  collapse: string; openSite: string; openMap: string; loading: string;
  sortLbl: string; catLbl: string; typeLbl: string; attrLbl: string; filters: string;
  allCats: string; allAttrs: string; allTypes: string; sortName: string; sortDist: string; sortDur: string; sortDir: string;
}

// Resolve the graph's UI label maps for one locale into a Strings object. A
// missing key degrades to "" (pick handles the empty map) rather than throwing,
// so a not-yet-translated label never crashes the UI.
export function stringsFor(ui: Record<string, LangMap>, lang: Lang): Strings {
  return new Proxy({} as Strings, {
    get: (_t, key: string) => pick(ui[key] || {}, lang),
  });
}

// Hook form for components: reads the UI labels from the ready RdfProvider.
export function useStrings(lang: Lang): Strings {
  const { ui } = useTrailData();
  return stringsFor(ui, lang);
}

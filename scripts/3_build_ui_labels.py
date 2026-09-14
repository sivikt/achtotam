"""Step 3 — build UI-label individuals into source_data/ui.ttl.

UI strings are localized content, so they live in the graph like every other
label (ct:Category / ct:RouteType / ct:Unit). Translation is a knowledge-prep
step, not a runtime concern: the app only ever reads the lang-tagged labels.

Each string is authored in Lithuanian (the source language) with optional
curated en/ru overrides. Any language left blank is machine-translated via the
shared translate() from 2_build_ontology.py (Google endpoint + fallbacks,
cached in translations_cache.json) — the same incremental fill the trail
pipeline uses. Curated text is always kept; MT only fills the gaps.

Emits ct:UILabel individuals keyed ct:ui-<key>, e.g.
    ct:ui-search a ct:UILabel ; rdfs:label "Search…"@en , "Ieškoti…"@lt , "Поиск…"@ru .

Run:  python scripts/3_build_ui_labels.py
"""
import os
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source_data")
OUT = os.path.join(SRC, "ui.ttl")
NS = "https://nesedeknamuose.lt/ontology/cognitive-trails#"

# reuse the pipeline's translation engine + cache + turtle helpers without
# triggering its main() (guarded by __name__), so we share translations_cache.json
_spec = importlib.util.spec_from_file_location(
    "build_ontology", os.path.join(os.path.dirname(__file__), "2_build_ontology.py"))
_bo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bo)
translate, lit_langs, esc1, save_cache = _bo.translate, _bo.lit_langs, _bo.esc1, _bo._save_cache

# UI strings: key -> {lt, en?, ru?}. lt is the authored source; en/ru are curated
# overrides (kept verbatim). Leave a language out and it is machine-translated.
# Seeded from the previously hand-maintained src/data/i18n.ts, so nothing is
# downgraded to MT on first run.
UI = {
    "title": {"lt": "Pažintiniai takai", "en": "Cognitive trails", "ru": "Познавательные тропы"},
    "subtitle": {"lt": "trasų · spustelėkite, kad parodytumėte žemėlapyje",
                 "en": "trails · click to show on the map",
                 "ru": "троп · нажмите, чтобы показать на карте"},
    "search": {"lt": "Ieškoti…", "en": "Search…", "ru": "Поиск…"},
    "loadAll": {"lt": "Rodyti visus", "en": "Show all", "ru": "Показать все"},
    "clear": {"lt": "Išvalyti", "en": "Clear", "ru": "Очистить"},
    "osm": {"lt": "Žemėlapis (OSM)", "en": "Map (OSM)", "ru": "Карта (OSM)"},
    "labels": {"lt": "Vietovės ir keliai", "en": "Places & streets", "ru": "Места и улицы"},
    "satellite": {"lt": "Palydovinis vaizdas", "en": "Satellite imagery", "ru": "Спутниковый снимок"},
    "topo": {"lt": "Topografinis žemėlapis", "en": "Topographic map", "ru": "Топографическая карта"},
    "layersTitle": {"lt": "Sluoksniai", "en": "Layers", "ru": "Слои"},
    "basemapTitle": {"lt": "Pagrindas", "en": "Basemap", "ru": "Базовая карта"},
    "engineTitle": {"lt": "Žemėlapio variklis", "en": "Map engine", "ru": "Движок карты"},
    "fullscreen": {"lt": "Visas ekranas", "en": "Fullscreen", "ru": "Полный экран"},
    "language": {"lt": "Kalba", "en": "Language", "ru": "Язык"},
    "parts": {"lt": "Atkarpos", "en": "Sections", "ru": "Участки"},
    "shown": {"lt": "rodoma", "en": "shown", "ru": "показано"},
    "flyTo": {"lt": "Rodyti žemėlapyje", "en": "Show on map", "ru": "Показать на карте"},
    "collapse": {"lt": "Suskleisti / išskleisti", "en": "Collapse / expand", "ru": "Свернуть / развернуть"},
    "openSite": {"lt": "Atidaryti", "en": "Open on", "ru": "Открыть на"},
    "openMap": {"lt": "„Google“", "en": "in Google", "ru": "В Google"},
    "loading": {"lt": "Įkeliama ontologija…", "en": "Loading ontology…", "ru": "Загрузка онтологии…"},
    "sortLbl": {"lt": "Rūšiuoti", "en": "Sort", "ru": "Сортировка"},
    "catLbl": {"lt": "Subjektyvios savybės", "en": "Subjective characteristics", "ru": "Субъективные характеристики"},
    "typeLbl": {"lt": "Geometrija", "en": "Geometry", "ru": "Геометрия"},
    "attrLbl": {"lt": "Savybės", "en": "Attributes", "ru": "Свойства"},
    "filters": {"lt": "Filtrai", "en": "Filters", "ru": "Фильтры"},
    "allCats": {"lt": "Visos charakteristikos", "en": "All characteristics", "ru": "Все характеристики"},
    "allAttrs": {"lt": "Visos savybės", "en": "All attributes", "ru": "Все свойства"},
    "allTypes": {"lt": "Bet kokia geometrija", "en": "Any geometry", "ru": "Любая геометрия"},
    "sortName": {"lt": "Pavadinimas", "en": "Name", "ru": "Название"},
    "sortDist": {"lt": "Pagal atstumą", "en": "Distance", "ru": "По расстоянию"},
    "sortDur": {"lt": "Pagal trukmę", "en": "Duration", "ru": "По длительности"},
    "sortDir": {"lt": "Didėjimo / mažėjimo tvarka", "en": "Ascending / descending", "ru": "По возрастанию / убыванию"},
    "start": {"lt": "Pradžia", "en": "Start", "ru": "Начало"},
    "finish": {"lt": "Pabaiga", "en": "Finish", "ru": "Финиш"},
    "copy": {"lt": "Kopijuoti koordinates", "en": "Copy coordinates", "ru": "Копировать координаты"},
    "copyStart": {"lt": "pradžios koordinatės", "en": "start coordinates", "ru": "координаты начала"},
    "copyFinish": {"lt": "pabaigos koordinatės", "en": "finish coordinates", "ru": "координаты финиша"},
    "menu": {"lt": "Meniu", "en": "Menu", "ru": "Меню"},
    "grpSubjective": {"lt": "Subjektyvus vertinimas", "en": "Subjective attitude", "ru": "Субъективная оценка"},
    "grpFacts": {"lt": "Faktai", "en": "Facts", "ru": "Факты"},
    "grpDesc": {"lt": "Aprašymas", "en": "Description", "ru": "Описание"},
    "share": {"lt": "Dalintis", "en": "Share", "ru": "Поделиться"},
    "shareTelegram": {"lt": "Į Telegram", "en": "to Telegram", "ru": "В Telegram"},
    "shareInstagram": {"lt": "Į Instagram", "en": "to Instagram", "ru": "В Instagram"},
    "linkCopied": {"lt": "Nuoroda nukopijuota", "en": "Link copied", "ru": "Ссылка скопирована"},
    "author": {"lt": "Autorius", "en": "Author", "ru": "Автор"},
}

LANGS = ["lt", "en", "ru"]


def fill(values):
    """Return {lt,en,ru}: curated values kept, blanks machine-translated from lt."""
    lt = values.get("lt", "").strip()
    out = {"lt": lt}
    for lang in ("en", "ru"):
        cur = (values.get(lang) or "").strip()
        out[lang] = cur if cur else (translate(lt, lang) if lt else "")
    return out


def main():
    header = f"""@prefix ct:   <{NS}> .
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .

# UI labels — localized application strings, modeled as individuals so the app
# reads them from the graph like any other label. AUTO-GENERATED by
# scripts/3_build_ui_labels.py; edit the UI table there and re-run.
ct:UILabel a owl:Class ;
    rdfs:label "UI label"@en , "Sąsajos etiketė"@lt , "Метка интерфейса"@ru ;
    rdfs:comment "A localized user-interface string."@en .
"""
    blocks = [header]
    filled = 0
    for key, values in UI.items():
        labels = fill(values)
        missing = [l for l in LANGS if not labels.get(l)]
        if missing:
            print(f"  ! {key}: still missing {missing}")
        filled += sum(1 for l in ("en", "ru") if not (values.get(l) or "").strip() and labels.get(l))
        # ordered lt, en, ru for stable output
        ordered = {l: labels[l] for l in LANGS if labels.get(l)}
        blocks.append(f"ct:ui-{key} a ct:UILabel ;\n    rdfs:label {lit_langs(ordered)} .\n")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(blocks))
    save_cache()
    print(f"wrote source_data/ui.ttl ({len(UI)} labels, {filled} machine-translated this run)")


if __name__ == "__main__":
    main()

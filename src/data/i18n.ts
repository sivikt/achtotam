import type { Lang } from "./types";

export interface Strings {
  title: string; subtitle: string; search: string; loadAll: string; clear: string;
  labels: string; satellite: string; topo: string; layersTitle: string; parts: string; shown: string; flyTo: string;
  start: string; finish: string; copy: string;
  grpSubjective: string; grpFacts: string;
  collapse: string; openSite: string; openMap: string; loading: string;
  sortLbl: string; catLbl: string; typeLbl: string; attrLbl: string;
  allCats: string; allTypes: string; sortName: string; sortDist: string; sortDur: string;
}

export const I18N: Record<Lang, Strings> = {
  lt: {
    title: "Pažintiniai takai", subtitle: "trasų · spustelėkite, kad parodytumėte žemėlapyje",
    search: "Ieškoti…", loadAll: "Rodyti visus", clear: "Išvalyti",
    labels: "Pavadinimai, keliai ir transportas",
    satellite: "Palydovinis vaizdas", topo: "Topografinis žemėlapis", layersTitle: "Sluoksniai", parts: "Atkarpos",
    shown: "rodoma", flyTo: "Rodyti žemėlapyje", collapse: "Suskleisti / išskleisti",
    openSite: "Atidaryti nesedeknamuose.lt →", openMap: "Rodyti maršrutą „Google Maps“ →",
    loading: "Įkeliama ontologija…", sortLbl: "Rūšiuoti", catLbl: "Subjektyvios savybės", typeLbl: "Geometrija",
    attrLbl: "Savybės", allCats: "Visos savybės", allTypes: "Bet kokia geometrija",
    sortName: "Pagal pavadinimą (A–Z)", sortDist: "Pagal atstumą", sortDur: "Pagal trukmę",
    start: "Pradžia", finish: "Pabaiga", copy: "Kopijuoti koordinates",
    grpSubjective: "Subjektyvus vertinimas", grpFacts: "Faktai",
  },
  en: {
    title: "Cognitive trails", subtitle: "trails · click to show on the map",
    search: "Search…", loadAll: "Show all", clear: "Clear",
    labels: "Labels, roads & transport",
    satellite: "Satellite imagery", topo: "Topographic map", layersTitle: "Layers", parts: "Sections",
    shown: "shown", flyTo: "Show on map", collapse: "Collapse / expand",
    openSite: "Open on nesedeknamuose.lt →", openMap: "View route on Google Maps →",
    loading: "Loading ontology…", sortLbl: "Sort", catLbl: "Subjective characteristics", typeLbl: "Geometry",
    attrLbl: "Attributes", allCats: "All characteristics", allTypes: "Any geometry",
    sortName: "Name (A–Z)", sortDist: "Distance", sortDur: "Duration",
    start: "Start", finish: "Finish", copy: "Copy coordinates",
    grpSubjective: "Subjective attitude", grpFacts: "Facts",
  },
  ru: {
    title: "Познавательные тропы", subtitle: "троп · нажмите, чтобы показать на карте",
    search: "Поиск…", loadAll: "Показать все", clear: "Очистить",
    labels: "Названия, дороги и транспорт",
    satellite: "Спутниковый снимок", topo: "Топографическая карта", layersTitle: "Слои", parts: "Участки",
    shown: "показано", flyTo: "Показать на карте", collapse: "Свернуть / развернуть",
    openSite: "Открыть на nesedeknamuose.lt →", openMap: "Показать маршрут на Google Maps →",
    loading: "Загрузка онтологии…", sortLbl: "Сортировка", catLbl: "Субъективные характеристики", typeLbl: "Геометрия",
    attrLbl: "Свойства", allCats: "Все характеристики", allTypes: "Любая геометрия",
    sortName: "По названию (А–Я)", sortDist: "По расстоянию", sortDur: "По длительности",
    start: "Начало", finish: "Финиш", copy: "Копировать координаты",
    grpSubjective: "Субъективная оценка", grpFacts: "Факты",
  },
};

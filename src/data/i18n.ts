import type { Lang } from "./types";

export interface Strings {
  title: string; subtitle: string; search: string; loadAll: string; clear: string;
  labels: string; satellite: string; topo: string; layersTitle: string; parts: string; shown: string; flyTo: string;
  start: string; finish: string; copy: string; copyStart: string; copyFinish: string; menu: string;
  grpSubjective: string; grpFacts: string; grpDesc: string;
  share: string; linkCopied: string; author: string;
  collapse: string; openSite: string; openMap: string; loading: string;
  sortLbl: string; catLbl: string; typeLbl: string; attrLbl: string; filters: string;
  allCats: string; allAttrs: string; allTypes: string; sortName: string; sortDist: string; sortDur: string; sortDir: string;
}

export const I18N: Record<Lang, Strings> = {
  lt: {
    title: "Pažintiniai takai", subtitle: "trasų · spustelėkite, kad parodytumėte žemėlapyje",
    search: "Ieškoti…", loadAll: "Rodyti visus", clear: "Išvalyti",
    labels: "Pavadinimai, keliai ir transportas",
    satellite: "Palydovinis vaizdas", topo: "Topografinis žemėlapis", layersTitle: "Sluoksniai", parts: "Atkarpos",
    shown: "rodoma", flyTo: "Rodyti žemėlapyje", collapse: "Suskleisti / išskleisti",
    openSite: "Atidaryti nesedeknamuose.lt →", openMap: "Rodyti maršrutą „Google Maps“ →",
    loading: "Įkeliama ontologija…", sortLbl: "Rūšiuoti", catLbl: "Subjektyvios savybės", typeLbl: "Geometrija", filters: "Filtrai",
    attrLbl: "Savybės", allCats: "Visos charakteristikos", allAttrs: "Visos savybės", allTypes: "Bet kokia geometrija",
    sortName: "Pavadinimas", sortDist: "Pagal atstumą", sortDur: "Pagal trukmę", sortDir: "Didėjimo / mažėjimo tvarka",
    start: "Pradžia", finish: "Pabaiga", copy: "Kopijuoti koordinates",
    copyStart: "Pradžios koordinatės", copyFinish: "Pabaigos koordinatės", menu: "Meniu",
    grpSubjective: "Subjektyvus vertinimas", grpFacts: "Faktai", grpDesc: "Aprašymas",
    share: "Dalintis", linkCopied: "Nuoroda nukopijuota", author: "Autorius",
  },
  en: {
    title: "Cognitive trails", subtitle: "trails · click to show on the map",
    search: "Search…", loadAll: "Show all", clear: "Clear",
    labels: "Labels, roads & transport",
    satellite: "Satellite imagery", topo: "Topographic map", layersTitle: "Layers", parts: "Sections",
    shown: "shown", flyTo: "Show on map", collapse: "Collapse / expand",
    openSite: "Open on nesedeknamuose.lt →", openMap: "View route on Google Maps →",
    loading: "Loading ontology…", sortLbl: "Sort", catLbl: "Subjective characteristics", typeLbl: "Geometry", filters: "Filters",
    attrLbl: "Attributes", allCats: "All characteristics", allAttrs: "All attributes", allTypes: "Any geometry",
    sortName: "Name", sortDist: "Distance", sortDur: "Duration", sortDir: "Ascending / descending",
    start: "Start", finish: "Finish", copy: "Copy coordinates",
    copyStart: "Start coordinates", copyFinish: "Finish coordinates", menu: "Menu",
    grpSubjective: "Subjective attitude", grpFacts: "Facts", grpDesc: "Description",
    share: "Share", linkCopied: "Link copied", author: "Author",
  },
  ru: {
    title: "Познавательные тропы", subtitle: "троп · нажмите, чтобы показать на карте",
    search: "Поиск…", loadAll: "Показать все", clear: "Очистить",
    labels: "Названия, дороги и транспорт",
    satellite: "Спутниковый снимок", topo: "Топографическая карта", layersTitle: "Слои", parts: "Участки",
    shown: "показано", flyTo: "Показать на карте", collapse: "Свернуть / развернуть",
    openSite: "Открыть на nesedeknamuose.lt →", openMap: "Показать маршрут на Google Maps →",
    loading: "Загрузка онтологии…", sortLbl: "Сортировка", catLbl: "Субъективные характеристики", typeLbl: "Геометрия", filters: "Фильтры",
    attrLbl: "Свойства", allCats: "Все характеристики", allAttrs: "Все свойства", allTypes: "Любая геометрия",
    sortName: "Название", sortDist: "По расстоянию", sortDur: "По длительности", sortDir: "По возрастанию / убыванию",
    start: "Начало", finish: "Финиш", copy: "Копировать координаты",
    copyStart: "Координаты начала", copyFinish: "Координаты финиша", menu: "Меню",
    grpSubjective: "Субъективная оценка", grpFacts: "Факты", grpDesc: "Описание",
    share: "Поделиться", linkCopied: "Ссылка скопирована", author: "Автор",
  },
};

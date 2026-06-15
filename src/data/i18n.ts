import type { Lang } from "./types";

export interface Strings {
  title: string; subtitle: string; search: string; loadAll: string; clear: string;
  osm: string; labels: string; satellite: string; topo: string; layersTitle: string; basemapTitle: string; engineTitle: string; language: string; parts: string; shown: string; flyTo: string;
  start: string; finish: string; copy: string; copyStart: string; copyFinish: string; menu: string;
  grpSubjective: string; grpFacts: string; grpDesc: string;
  share: string; shareTelegram: string; shareInstagram: string; linkCopied: string; author: string;
  collapse: string; openSite: string; openMap: string; loading: string;
  sortLbl: string; catLbl: string; typeLbl: string; attrLbl: string; filters: string;
  allCats: string; allAttrs: string; allTypes: string; sortName: string; sortDist: string; sortDur: string; sortDir: string;
}

export const I18N: Record<Lang, Strings> = {
  lt: {
    title: "Pažintiniai takai", subtitle: "trasų · spustelėkite, kad parodytumėte žemėlapyje",
    search: "Ieškoti…", loadAll: "Rodyti visus", clear: "Išvalyti",
    osm: "Žemėlapis (OSM)", labels: "Vietovės ir keliai",
    satellite: "Palydovinis vaizdas", topo: "Topografinis žemėlapis", layersTitle: "Sluoksniai", basemapTitle: "Pagrindas", engineTitle: "Žemėlapio variklis", language: "Kalba", parts: "Atkarpos",
    shown: "rodoma", flyTo: "Rodyti žemėlapyje", collapse: "Suskleisti / išskleisti",
    openSite: "Atidaryti nesedeknamuose.lt →", openMap: "„Google“",
    loading: "Įkeliama ontologija…", sortLbl: "Rūšiuoti", catLbl: "Subjektyvios savybės", typeLbl: "Geometrija", filters: "Filtrai",
    attrLbl: "Savybės", allCats: "Visos charakteristikos", allAttrs: "Visos savybės", allTypes: "Bet kokia geometrija",
    sortName: "Pavadinimas", sortDist: "Pagal atstumą", sortDur: "Pagal trukmę", sortDir: "Didėjimo / mažėjimo tvarka",
    start: "Pradžia", finish: "Pabaiga", copy: "Kopijuoti koordinates",
    copyStart: "pradžios koordinatės", copyFinish: "pabaigos koordinatės", menu: "Meniu",
    grpSubjective: "Subjektyvus vertinimas", grpFacts: "Faktai", grpDesc: "Aprašymas",
    share: "Dalintis", shareTelegram: "Į Telegram", shareInstagram: "Į Instagram", linkCopied: "Nuoroda nukopijuota", author: "Autorius",
  },
  en: {
    title: "Cognitive trails", subtitle: "trails · click to show on the map",
    search: "Search…", loadAll: "Show all", clear: "Clear",
    osm: "Map (OSM)", labels: "Places & streets",
    satellite: "Satellite imagery", topo: "Topographic map", layersTitle: "Layers", basemapTitle: "Basemap", engineTitle: "Map engine", language: "Language", parts: "Sections",
    shown: "shown", flyTo: "Show on map", collapse: "Collapse / expand",
    openSite: "Open on nesedeknamuose.lt →", openMap: "in Google",
    loading: "Loading ontology…", sortLbl: "Sort", catLbl: "Subjective characteristics", typeLbl: "Geometry", filters: "Filters",
    attrLbl: "Attributes", allCats: "All characteristics", allAttrs: "All attributes", allTypes: "Any geometry",
    sortName: "Name", sortDist: "Distance", sortDur: "Duration", sortDir: "Ascending / descending",
    start: "Start", finish: "Finish", copy: "Copy coordinates",
    copyStart: "start coordinates", copyFinish: "finish coordinates", menu: "Menu",
    grpSubjective: "Subjective attitude", grpFacts: "Facts", grpDesc: "Description",
    share: "Share", shareTelegram: "to Telegram", shareInstagram: "to Instagram", linkCopied: "Link copied", author: "Author",
  },
  ru: {
    title: "Познавательные тропы", subtitle: "троп · нажмите, чтобы показать на карте",
    search: "Поиск…", loadAll: "Показать все", clear: "Очистить",
    osm: "Карта (OSM)", labels: "Места и улицы",
    satellite: "Спутниковый снимок", topo: "Топографическая карта", layersTitle: "Слои", basemapTitle: "Базовая карта", engineTitle: "Движок карты", language: "Язык", parts: "Участки",
    shown: "показано", flyTo: "Показать на карте", collapse: "Свернуть / развернуть",
    openSite: "Открыть на nesedeknamuose.lt →", openMap: "В Google",
    loading: "Загрузка онтологии…", sortLbl: "Сортировка", catLbl: "Субъективные характеристики", typeLbl: "Геометрия", filters: "Фильтры",
    attrLbl: "Свойства", allCats: "Все характеристики", allAttrs: "Все свойства", allTypes: "Любая геометрия",
    sortName: "Название", sortDist: "По расстоянию", sortDur: "По длительности", sortDir: "По возрастанию / убыванию",
    start: "Начало", finish: "Финиш", copy: "Копировать координаты",
    copyStart: "координаты начала", copyFinish: "координаты финиша", menu: "Меню",
    grpSubjective: "Субъективная оценка", grpFacts: "Факты", grpDesc: "Описание",
    share: "Поделиться", shareTelegram: "В Telegram", shareInstagram: "В Instagram", linkCopied: "Ссылка скопирована", author: "Автор",
  },
};

import type { Lang } from "./types";

export interface Strings {
  title: string; subtitle: string; search: string; loadAll: string; clear: string;
  labels: string; roads: string; parts: string; shown: string; flyTo: string;
  collapse: string; openSite: string; openMap: string; loading: string;
  sortLbl: string; catLbl: string; typeLbl: string; attrLbl: string;
  allCats: string; allTypes: string; sortName: string; sortDist: string; sortDur: string;
}

export const I18N: Record<Lang, Strings> = {
  lt: {
    title: "Pažintiniai takai", subtitle: "trasų · spustelėkite, kad parodytumėte žemėlapyje",
    search: "Ieškoti…", loadAll: "Rodyti visus", clear: "Išvalyti",
    labels: "Šalių ir vietovių pavadinimai", roads: "Keliai ir transportas", parts: "Atkarpos",
    shown: "rodoma", flyTo: "Rodyti žemėlapyje", collapse: "Suskleisti / išskleisti",
    openSite: "Atidaryti nesedeknamuose.lt →", openMap: "Rodyti maršrutą „Google Maps“ →",
    loading: "Įkeliama ontologija…", sortLbl: "Rūšiuoti", catLbl: "Kategorija", typeLbl: "Tipas",
    attrLbl: "Savybės", allCats: "Visos kategorijos", allTypes: "Visi tipai",
    sortName: "Pagal pavadinimą (A–Z)", sortDist: "Pagal atstumą", sortDur: "Pagal trukmę",
  },
  en: {
    title: "Cognitive trails", subtitle: "trails · click to show on the map",
    search: "Search…", loadAll: "Show all", clear: "Clear",
    labels: "Country & place labels", roads: "Roads & transport", parts: "Sections",
    shown: "shown", flyTo: "Show on map", collapse: "Collapse / expand",
    openSite: "Open on nesedeknamuose.lt →", openMap: "View route on Google Maps →",
    loading: "Loading ontology…", sortLbl: "Sort", catLbl: "Category", typeLbl: "Type",
    attrLbl: "Attributes", allCats: "All categories", allTypes: "All types",
    sortName: "Name (A–Z)", sortDist: "Distance", sortDur: "Duration",
  },
  ru: {
    title: "Познавательные тропы", subtitle: "троп · нажмите, чтобы показать на карте",
    search: "Поиск…", loadAll: "Показать все", clear: "Очистить",
    labels: "Названия стран и мест", roads: "Дороги и транспорт", parts: "Участки",
    shown: "показано", flyTo: "Показать на карте", collapse: "Свернуть / развернуть",
    openSite: "Открыть на nesedeknamuose.lt →", openMap: "Показать маршрут на Google Maps →",
    loading: "Загрузка онтологии…", sortLbl: "Сортировка", catLbl: "Категория", typeLbl: "Тип",
    attrLbl: "Свойства", allCats: "Все категории", allTypes: "Все типы",
    sortName: "По названию (А–Я)", sortDist: "По расстоянию", sortDur: "По длительности",
  },
};

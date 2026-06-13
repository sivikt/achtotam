// Keyless basemap + overlay registry, shared by App (gallery thumbnails/labels)
// and MapView (Cesium layer construction). The project has no ArcGIS API key, so
// only no-key sources are listed: Esri public raster MapServers, OSM, OpenTopoMap.

export const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/";

type Loc = Record<"lt" | "en" | "ru", string>;

export interface Basemap {
  key: string;
  label: Loc;
  thumb: string;
  kind: "esri" | "tile";
  service?: string;   // esri: "<path>/MapServer"
  url?: string;       // tile: {z}/{x}/{y} template
  credit?: string;
  maxLevel?: number;
  // an Esri world MapServer drawn *beneath* this basemap, so a regional source
  // (e.g. the Lithuania-only ortho) still shows global imagery everywhere else.
  under?: string;
}

export interface Overlay {
  key: string;
  label: Loc;
  service: string;    // transparent Esri reference MapServer
}

// One representative tile over Lithuania (z5, x18, y10) makes each preview.
// Esri tile order is /tile/{z}/{y}/{x} → 5/10/18; XYZ order is /{z}/{x}/{y} → 5/18/10.
const esriThumb = (service: string) => `${ESRI}${service}/MapServer/tile/5/10/18`;

const esri = (key: string, service: string, label: Loc): Basemap =>
  ({ key, label, kind: "esri", service, thumb: esriThumb(service) });

export const BASEMAPS: Basemap[] = [
  { key: "osm", kind: "tile", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap contributors", maxLevel: 19,
    thumb: "https://tile.openstreetmap.org/5/18/10.png",
    label: { lt: "OpenStreetMap", en: "OpenStreetMap", ru: "OpenStreetMap" } },
  esri("imagery", "World_Imagery",
    { lt: "Palydovinis", en: "Imagery", ru: "Спутник" }),
  // Lithuanian national orthophoto (ORT10LT) — a cached ArcGIS MapServer in Web
  // Mercator, so it serves as a plain {z}/{y}/{x} tile source. It covers only
  // Lithuania, so Esri World Imagery is drawn underneath to fill the rest of the world.
  { key: "ortoLt", kind: "tile", under: "World_Imagery",
    url: "https://beta.maps.lt/arcgis-maps/rest/services/Basemaps/maps_ortofoto_wmerc/MapServer/tile/{z}/{y}/{x}",
    credit: "ORT10LT © Nacionalinė žemės tarnyba; © HNIT-BALTIC", maxLevel: 21,
    thumb: "https://beta.maps.lt/arcgis-maps/rest/services/Basemaps/maps_ortofoto_wmerc/MapServer/tile/8/81/145",
    label: { lt: "Ortofoto (maps.lt)", en: "Orthophoto (maps.lt)", ru: "Ортофото (maps.lt)" } },
  esri("streets", "World_Street_Map",
    { lt: "Gatvės", en: "Streets", ru: "Улицы" }),
  esri("topographic", "World_Topo_Map",
    { lt: "Topografinis", en: "Topographic", ru: "Топографическая" }),
  esri("lightGray", "Canvas/World_Light_Gray_Base",
    { lt: "Šviesi pilka", en: "Light Gray", ru: "Светло-серая" }),
  esri("darkGray", "Canvas/World_Dark_Gray_Base",
    { lt: "Tamsi pilka", en: "Dark Gray", ru: "Тёмно-серая" }),
  esri("natgeo", "NatGeo_World_Map",
    { lt: "National Geographic", en: "National Geographic", ru: "National Geographic" }),
  esri("oceans", "Ocean/World_Ocean_Base",
    { lt: "Vandenynai", en: "Oceans", ru: "Океаны" }),
  esri("terrain", "World_Terrain_Base",
    { lt: "Reljefas", en: "Terrain", ru: "Рельеф" }),
  esri("physical", "World_Physical_Map",
    { lt: "Fizinis", en: "Physical", ru: "Физическая" }),
  esri("shadedRelief", "World_Shaded_Relief",
    { lt: "Šešėliuotas reljefas", en: "Shaded Relief", ru: "Отмывка рельефа" }),
  { key: "openTopo", kind: "tile", url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    credit: "© OpenTopoMap (CC-BY-SA)", maxLevel: 17,
    thumb: "https://tile.opentopomap.org/5/18/10.png",
    label: { lt: "OpenTopoMap", en: "OpenTopoMap", ru: "OpenTopoMap" } },
];

export const OVERLAYS: Overlay[] = [
  { key: "places", service: "Reference/World_Boundaries_and_Places",
    label: { lt: "Vietovės ir ribos", en: "Places & boundaries", ru: "Места и границы" } },
  { key: "transport", service: "Reference/World_Transportation",
    label: { lt: "Keliai ir transportas", en: "Roads & transport", ru: "Дороги и транспорт" } },
];

export const DEFAULT_BASEMAP = "osm";
export const basemapKeys = new Set(BASEMAPS.map((b) => b.key));
export const overlayKeys = new Set(OVERLAYS.map((o) => o.key));

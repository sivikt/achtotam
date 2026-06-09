export type Lang = "lt" | "en" | "ru";
export type LangMap = Partial<Record<string, string>>;

export interface Quantity {
  value: string;
  unit: LangMap;
}

export interface Segment {
  num: number;
  name: LangMap;
  desc: LangMap;
  images: string[];
  localImages: string[];
  wkt?: string;
}

export interface Trail {
  uri: string;
  slug: string;
  name: LangMap;
  desc: LangMap;
  routeType: LangMap;
  distance: Quantity | null;
  duration: Quantity | null;
  lat: number;
  lng: number;
  link: string;
  map: string;
  address: string;
  images: string[];
  localImages: string[];
  props: string[];
  categories: string[];
  segments: Segment[];
  wkt?: string;
}

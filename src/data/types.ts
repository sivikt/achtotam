export type Lang = "lt" | "en" | "ru";
export type LangMap = Partial<Record<string, string>>;

export interface Quantity {
  value: string;
  unit: LangMap;
}

export interface Author {
  name: string;
  facebook?: string;
  instagram?: string;
}

export interface Segment {
  num: number;
  name: LangMap;
  desc: LangMap;
  images: string[];
  localImages: string[];
  wkt?: string;
}

// a route's start / finish marker: coordinates plus an optional address
export interface RoutePoint {
  lng: number;
  lat: number;
  address?: string;
}

export interface Trail {
  uri: string;
  slug: string;
  name: LangMap;
  desc: LangMap;
  routeType: string; // ct:RouteType node URI ("" if unset); label via routeTypeLabels
  author: string;    // foaf:Person node URI ("" if unset); details via authors
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
  start?: RoutePoint;
  finish?: RoutePoint;
  wkt?: string;
}

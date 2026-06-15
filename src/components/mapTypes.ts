import type { Segment, Trail } from "../data/types";

// the shared contract every map engine (Cesium / Leaflet / MapLibre) implements,
// so App can swap them behind one ref. Lives in its own module rather than any
// one engine's file to keep the three components symmetric.
export interface MapHandle {
  showTrack: (i: number, fly: boolean) => void;
  setHover: (i: number | null) => void;
  resetView: () => void;
  highlightSegment: (seg: Segment) => void;
  clearSegHighlight: () => void;
}

export interface CameraState { lng: number; lat: number; height: number; heading: number; pitch: number }

export interface MapProps {
  trails: Trail[];
  shownSlugs: Set<string>;
  basemap: string;
  overlays: Set<string>;
  initialCam: CameraState | null;
  onPick: (slug: string) => void;
  onActiveChange: (slug: string | null) => void;
  onViewChange: (rect: { w: number; s: number; e: number; n: number } | null) => void;
  onCameraChange: (cam: CameraState) => void;
}

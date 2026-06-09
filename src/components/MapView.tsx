import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as Cesium from "cesium";
import type { Segment, Trail } from "../data/types";
import { lineStringsFromWKT } from "../lib/wkt";
import { colorFor } from "../lib/lang";

export interface MapHandle {
  showTrack: (i: number, fly: boolean) => void;
  resetView: () => void;
  highlightSegment: (seg: Segment) => void;
  clearSegHighlight: () => void;
}

interface Props {
  trails: Trail[];
  showLabels: boolean;
  showRoads: boolean;
  onPick: (slug: string) => void;
  onActiveChange: (slug: string | null) => void;
  onViewChange: (rect: { w: number; s: number; e: number; n: number } | null) => void;
}

const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/";
const LITHUANIA = () => Cesium.Rectangle.fromDegrees(20.9, 53.9, 26.9, 56.5);

type Ent = Cesium.Entity & { trailSlug?: string; _baseColor?: Cesium.Color };

function boundsOfLines(lines: number[][]) {
  const lons: number[] = [], lats: number[] = [];
  for (const flat of lines)
    for (let k = 0; k < flat.length; k += 2) { lons.push(flat[k]); lats.push(flat[k + 1]); }
  return Cesium.Rectangle.fromDegrees(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats));
}

const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const { trails, showLabels, showRoads, onPick, onActiveChange, onViewChange } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const labelsRef = useRef<Cesium.ImageryLayer | null>(null);
  const roadsRef = useRef<Cesium.ImageryLayer | null>(null);
  const entities = useRef<Record<string, Ent | Ent[]>>({});
  const segEntities = useRef<Ent[]>([]);
  const activeSlug = useRef<string | null>(null);

  // keep callbacks fresh for the picker/camera closures
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  useEffect(() => {
    Cesium.Ion.defaultAccessToken = undefined as unknown as string;
    const viewer = new Cesium.Viewer(containerRef.current!, {
      baseLayer: Cesium.ImageryLayer.fromProviderAsync(
        Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI + "World_Imagery/MapServer"), {}),
      baseLayerPicker: false, geocoder: false, homeButton: true, sceneModePicker: true,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: true,
      selectionIndicator: false, infoBox: false,
    });
    viewer.scene.globe.enableLighting = false;
    viewerRef.current = viewer;

    const roads = Cesium.ImageryLayer.fromProviderAsync(
      Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI + "Reference/World_Transportation/MapServer"), {});
    const labels = Cesium.ImageryLayer.fromProviderAsync(
      Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI + "Reference/World_Boundaries_and_Places/MapServer"), {});
    viewer.imageryLayers.add(roads);
    viewer.imageryLayers.add(labels);
    roadsRef.current = roads;
    labelsRef.current = labels;

    const picker = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const slugFromPick = (pos: Cesium.Cartesian2) => {
      const picked = viewer.scene.pick(pos);
      return Cesium.defined(picked) && picked.id ? (picked.id as Ent).trailSlug ?? null : null;
    };
    picker.setInputAction((e: { position: Cesium.Cartesian2 }) => {
      const slug = slugFromPick(e.position);
      if (slug) onPickRef.current(slug);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    picker.setInputAction((e: { endPosition: Cesium.Cartesian2 }) => {
      viewer.scene.canvas.style.cursor = slugFromPick(e.endPosition) ? "pointer" : "";
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // report the visible globe rectangle so the list can show only in-view trails.
    // undefined => the horizon is in frame (no finite view rect): clear the filter.
    const emitView = () => {
      const r = viewer.camera.computeViewRectangle();
      if (!r || r.east <= r.west) { onViewChangeRef.current(null); return; }
      const D = Cesium.Math.toDegrees;
      onViewChangeRef.current({ w: D(r.west), s: D(r.south), e: D(r.east), n: D(r.north) });
    };
    viewer.camera.moveEnd.addEventListener(emitView);
    const onceView = () => { viewer.scene.postRender.removeEventListener(onceView); emitView(); };
    viewer.scene.postRender.addEventListener(onceView);

    // always show every trail in the area; refs reset so a StrictMode remount
    // rebuilds entities against the fresh viewer instead of skipping stale ones.
    entities.current = {};
    segEntities.current = [];
    trails.forEach((_, i) => ensureEntity(i));
    applyHighlight();
    viewer.camera.flyTo({ destination: LITHUANIA(), duration: 0 });

    return () => { viewer.camera.moveEnd.removeEventListener(emitView); picker.destroy(); viewer.destroy(); };
  }, []);

  useEffect(() => { if (labelsRef.current) labelsRef.current.show = showLabels; }, [showLabels]);
  useEffect(() => { if (roadsRef.current) roadsRef.current.show = showRoads; }, [showRoads]);

  function applyHighlight() {
    for (const slug in entities.current) {
      const on = slug === activeSlug.current;
      const arr = Array.isArray(entities.current[slug]) ? (entities.current[slug] as Ent[]) : [entities.current[slug] as Ent];
      for (const e of arr) {
        const base = e._baseColor || Cesium.Color.WHITE;
        if (e.polyline) {
          e.polyline.width = new Cesium.ConstantProperty(on ? 6 : 2);
          e.polyline.material = new Cesium.ColorMaterialProperty(on ? base : base.withAlpha(0.35));
        } else if (e.point) {
          e.point.pixelSize = new Cesium.ConstantProperty(on ? 16 : 10);
          e.point.color = new Cesium.ConstantProperty(on ? base : base.withAlpha(0.55));
          e.point.outlineWidth = new Cesium.ConstantProperty(on ? 3 : 0);
        }
      }
    }
  }

  function ensureEntity(i: number) {
    const viewer = viewerRef.current!;
    const t = trails[i];
    if (entities.current[t.slug]) return;
    const c = Cesium.Color.fromCssColorString(colorFor(i));
    const lines = t.wkt ? lineStringsFromWKT(t.wkt) : null;
    if (lines) {
      const es = lines.map((flat) => viewer.entities.add({
        polyline: { positions: Cesium.Cartesian3.fromDegreesArray(flat), width: 2, material: c, clampToGround: true },
      }) as Ent);
      es.forEach((e) => { e.trailSlug = t.slug; e._baseColor = c; });
      entities.current[t.slug] = es.length === 1 ? es[0] : es;
    } else if (isFinite(t.lat) && isFinite(t.lng)) {
      const e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(t.lng, t.lat),
        point: { pixelSize: 10, color: c, outlineColor: Cesium.Color.WHITE, outlineWidth: 0 },
      }) as Ent;
      e.trailSlug = t.slug; e._baseColor = c;
      entities.current[t.slug] = e;
    }
  }

  function clearSegHighlight() {
    const viewer = viewerRef.current;
    if (viewer) segEntities.current.forEach((e) => viewer.entities.remove(e));
    segEntities.current = [];
  }

  useImperativeHandle(ref, (): MapHandle => ({
    showTrack(i, fly) {
      const viewer = viewerRef.current!;
      const t = trails[i];
      ensureEntity(i);
      activeSlug.current = t.slug;
      onActiveChange(t.slug);
      applyHighlight();
      const e = entities.current[t.slug];
      if (fly && e) viewer.flyTo(e as Ent | Ent[], { duration: 1.2 });
    },
    resetView() {
      trails.forEach((_, i) => ensureEntity(i));
      applyHighlight();
      viewerRef.current!.camera.flyTo({ destination: LITHUANIA() });
    },
    highlightSegment(seg) {
      clearSegHighlight();
      const lines = seg.wkt ? lineStringsFromWKT(seg.wkt) : null;
      if (!lines) return;
      const viewer = viewerRef.current!;
      const hi = Cesium.Color.fromCssColorString("#ffe14d");
      for (const flat of lines) {
        segEntities.current.push(viewer.entities.add({
          polyline: { positions: Cesium.Cartesian3.fromDegreesArray(flat), width: 7, material: hi, clampToGround: true, zIndex: 10 },
        }) as Ent);
      }
      viewer.camera.flyTo({ duration: 1.0, destination: boundsOfLines(lines) });
    },
    clearSegHighlight,
  }), [trails, onActiveChange]);

  return <div ref={containerRef} id="cesiumContainer" />;
});

export default MapView;

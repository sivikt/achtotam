import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as Cesium from "cesium";
import type { Segment, Trail } from "../data/types";
import { lineStringsFromWKT } from "../lib/wkt";
import { colorFor } from "../lib/lang";
import { BASEMAPS, ESRI, OVERLAYS } from "../lib/basemaps";

export interface MapHandle {
  showTrack: (i: number, fly: boolean) => void;
  setHover: (i: number | null) => void;
  resetView: () => void;
  highlightSegment: (seg: Segment) => void;
  clearSegHighlight: () => void;
}

export interface CameraState { lng: number; lat: number; height: number; heading: number; pitch: number }

interface Props {
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

const LITHUANIA = () => Cesium.Rectangle.fromDegrees(20.9, 53.9, 26.9, 56.5);

const BASEMAP_BY_KEY = new Map(BASEMAPS.map((b) => [b.key, b] as const));
const OVERLAY_BY_KEY = new Map(OVERLAYS.map((o) => [o.key, o] as const));

// Material Symbols "location_on" pin — same sign the detail panel uses for the
// start/finish addresses. Rendered to an SVG data URI so Cesium can show it as a
// billboard, tinted per endpoint (green start, red finish) with a white outline.
const PIN_PATH = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 11 7 11s7-5.75 7-11c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";
const pinImage = (fill: string) =>
  "data:image/svg+xml;base64," + btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">`
    + `<path d="${PIN_PATH}" fill="${fill}" stroke="#ffffff" stroke-width="1.2"/></svg>`);

type Ent = Cesium.Entity & { trailSlug?: string; _baseColor?: Cesium.Color };

function boundsOfLines(lines: number[][]) {
  const lons: number[] = [], lats: number[] = [];
  for (const flat of lines)
    for (let k = 0; k < flat.length; k += 2) { lons.push(flat[k]); lats.push(flat[k + 1]); }
  return Cesium.Rectangle.fromDegrees(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats));
}

const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const { trails, shownSlugs, basemap, overlays, initialCam, onPick, onActiveChange, onViewChange, onCameraChange } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  // created Cesium layers, cached by registry key so re-selecting doesn't rebuild.
  // a basemap can be a stack (bottom→top), e.g. world imagery under a regional ortho
  const basemapLayers = useRef<Map<string, Cesium.ImageryLayer[]>>(new Map());
  const overlayLayers = useRef<Map<string, Cesium.ImageryLayer>>(new Map());
  const basemapKey = useRef<string>(basemap);
  const entities = useRef<Record<string, Ent | Ent[]>>({});
  const segEntities = useRef<Ent[]>([]);
  const endpointEntities = useRef<Ent[]>([]);
  const activeSlug = useRef<string | null>(null);
  const hoverSlug = useRef<string | null>(null);

  // keep callbacks fresh for the picker/camera closures
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;

  useEffect(() => {
    Cesium.Ion.defaultAccessToken = undefined as unknown as string;
    const viewer = new Cesium.Viewer(containerRef.current!, {
      // basemaps are added explicitly below from the registry (single-select)
      baseLayer: false,
      sceneMode: Cesium.SceneMode.SCENE3D,
      baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: true,
      selectionIndicator: false, infoBox: false,
      // render only when the scene actually changes (camera move, entity edit) instead
      // of a constant 60fps loop — the biggest battery/CPU win on phones. Nothing here
      // animates over time, so elapsed time alone should never force a redraw.
      requestRenderMode: true, maximumRenderTimeChange: Infinity,
    });
    viewer.scene.globe.enableLighting = false;
    // raster tiles and labels look blurry on retina/mobile because Cesium renders at
    // CSS resolution by default; render at the device pixel ratio so they stay crisp.
    viewer.useBrowserRecommendedResolution = false;
    // imagery sharpness is set by the globe's screen-space error: it decides which
    // tile LOD gets draped, so a lower value pulls in higher-resolution tiles and
    // kills the blur when zoomed in (matching ArcGIS-grade crispness off the same
    // Esri imagery). Phones keep the looser default to protect the perf budget.
    viewer.scene.globe.maximumScreenSpaceError =
      window.matchMedia("(max-width: 768px)").matches ? 2 : 1;
    // a flat OSM map needs none of the 3D-globe atmosphere/sky/lighting effects —
    // turning them off cuts per-frame GPU work on low-end devices.
    viewer.scene.fog.enabled = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    if (viewer.scene.sun) viewer.scene.sun.show = false;
    if (viewer.scene.moon) viewer.scene.moon.show = false;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#aab8c2");
    viewerRef.current = viewer;

    // the chosen basemap sits at the bottom; reference overlays stack above it
    // (trail entities are not imagery layers and always draw on top of everything)
    getBasemapLayers(basemap).forEach((l) => viewer.imageryLayers.add(l));
    basemapKey.current = basemap;
    for (const key of overlays) {
      const ov = getOverlayLayer(key);
      if (ov) viewer.imageryLayers.add(ov);
    }

    const picker = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const slugAt = (pos: Cesium.Cartesian2) => {
      // ring samples can land outside the canvas; picking an off-screen point
      // makes Cesium build an invalid ray and throw ("normalized result is not
      // a number"), so skip anything beyond the canvas bounds.
      const canvas = viewer.scene.canvas;
      if (pos.x < 0 || pos.y < 0 || pos.x > canvas.clientWidth || pos.y > canvas.clientHeight) return null;
      const picked = viewer.scene.pick(pos);
      return Cesium.defined(picked) && picked.id ? (picked.id as Ent).trailSlug ?? null : null;
    };
    // Thin (2px) polylines are nearly impossible to hit with a fingertip, so an
    // exact pick at the tap point usually misses on touch. Sample a few rings of
    // points around the tap and take the first trail we land on. radius scales
    // up for coarse (touch) input.
    const slugNear = (pos: Cesium.Cartesian2, radius: number) => {
      const exact = slugAt(pos);
      if (exact) return exact;
      const scratch = new Cesium.Cartesian2();
      for (let r = 6; r <= radius; r += 6) {
        for (let a = 0; a < 360; a += 30) {
          const rad = (a * Math.PI) / 180;
          scratch.x = pos.x + Math.cos(rad) * r;
          scratch.y = pos.y + Math.sin(rad) * r;
          const slug = slugAt(scratch);
          if (slug) return slug;
        }
      }
      return null;
    };
    picker.setInputAction((e: { position: Cesium.Cartesian2 }) => {
      const slug = slugNear(e.position, 28);
      if (slug) onPickRef.current(slug);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    picker.setInputAction((e: { endPosition: Cesium.Cartesian2 }) => {
      viewer.scene.canvas.style.cursor = slugNear(e.endPosition, 12) ? "pointer" : "";
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

    // report the camera pose (position + orientation) so the URL can reproduce
    // the exact view; fires after each pan/zoom/rotate settles.
    const emitCam = () => {
      const c = viewer.camera;
      const p = c.positionCartographic;
      onCameraChangeRef.current({
        lng: Cesium.Math.toDegrees(p.longitude), lat: Cesium.Math.toDegrees(p.latitude),
        height: p.height, heading: Cesium.Math.toDegrees(c.heading), pitch: Cesium.Math.toDegrees(c.pitch),
      });
    };
    viewer.camera.moveEnd.addEventListener(emitCam);

    // always show every trail in the area; refs reset so a StrictMode remount
    // rebuilds entities against the fresh viewer instead of skipping stale ones.
    entities.current = {};
    segEntities.current = [];
    trails.forEach((_, i) => ensureEntity(i));
    applyHighlight();
    applyVisibility();
    if (initialCam) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(initialCam.lng, initialCam.lat, initialCam.height),
        orientation: { heading: Cesium.Math.toRadians(initialCam.heading), pitch: Cesium.Math.toRadians(initialCam.pitch), roll: 0 },
      });
    } else {
      viewer.camera.flyTo({ destination: LITHUANIA(), duration: 0 });
    }

    return () => {
      viewer.camera.moveEnd.removeEventListener(emitView);
      viewer.camera.moveEnd.removeEventListener(emitCam);
      picker.destroy(); viewer.destroy();
      // drop the ref so post-unmount imperative calls (e.g. clearSegHighlight from
      // DetailPanel's cleanup) don't touch the destroyed viewer's scene
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
  }, []);

  // swap the basemap: add the new stack at the bottom (preserving its bottom→top
  // order), then remove the previous stack's layers
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || basemap === basemapKey.current) return;
    const prev = basemapLayers.current.get(basemapKey.current) ?? [];
    const next = getBasemapLayers(basemap);
    // lowerToBottom in reverse so the first (bottom) layer ends up lowest
    [...next].reverse().forEach((l) => {
      if (!viewer.imageryLayers.contains(l)) viewer.imageryLayers.add(l);
      viewer.imageryLayers.lowerToBottom(l);
    });
    prev.forEach((l) => { if (!next.includes(l)) viewer.imageryLayers.remove(l, false); });
    basemapKey.current = basemap;
    requestRender();
  }, [basemap]);

  // reconcile reference overlays against the active set (add missing, remove extra)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const [key, layer] of overlayLayers.current) {
      if (!overlays.has(key) && viewer.imageryLayers.contains(layer))
        viewer.imageryLayers.remove(layer, false);
    }
    for (const key of overlays) {
      const ov = getOverlayLayer(key);
      if (ov && !viewer.imageryLayers.contains(ov)) viewer.imageryLayers.add(ov);
    }
    requestRender();
  }, [overlays]);

  // hide trails that don't match the current content filters (search/theme/type/attrs)
  useEffect(() => { applyVisibility(); }, [shownSlugs]);

  // requestRenderMode draws only on demand, so any programmatic scene change
  // (entity edits, layer toggles) must explicitly ask for a redraw.
  function requestRender() {
    const v = viewerRef.current;
    if (v && !v.isDestroyed()) v.scene.requestRender();
  }

  // build (and cache) the Cesium layer stack (bottom→top) for a registry basemap key
  function getBasemapLayers(key: string) {
    const cached = basemapLayers.current.get(key);
    if (cached) return cached;
    const b = BASEMAP_BY_KEY.get(key);
    if (!b) return [];
    const layers: Cesium.ImageryLayer[] = [];
    if (b.under)
      layers.push(Cesium.ImageryLayer.fromProviderAsync(
        Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI + b.under + "/MapServer"), {}));
    layers.push(b.kind === "esri"
      ? Cesium.ImageryLayer.fromProviderAsync(
          Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI + b.service + "/MapServer"), {})
      : new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
          url: b.url!, credit: b.credit, maximumLevel: b.maxLevel })));
    basemapLayers.current.set(key, layers);
    return layers;
  }

  function getOverlayLayer(key: string) {
    const cached = overlayLayers.current.get(key);
    if (cached) return cached;
    const o = OVERLAY_BY_KEY.get(key);
    if (!o) return null;
    const layer = Cesium.ImageryLayer.fromProviderAsync(
      Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI + o.service + "/MapServer"), {});
    overlayLayers.current.set(key, layer);
    return layer;
  }

  function applyVisibility() {
    for (const slug in entities.current) {
      const show = shownSlugs.has(slug);
      const arr = Array.isArray(entities.current[slug]) ? (entities.current[slug] as Ent[]) : [entities.current[slug] as Ent];
      for (const e of arr) e.show = show;
    }
    requestRender();
  }

  function applyHighlight() {
    for (const slug in entities.current) {
      const on = slug === activeSlug.current || slug === hoverSlug.current;
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
    requestRender();
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
    requestRender();
  }

  function clearEndpoints() {
    const viewer = viewerRef.current;
    if (viewer) endpointEntities.current.forEach((e) => viewer.entities.remove(e));
    endpointEntities.current = [];
    requestRender();
  }

  // green = start, red = finish; shown only for the active trail. clicking a
  // marker re-selects the trail, matching the polyline pick behaviour.
  function showEndpoints(t: Trail) {
    clearEndpoints();
    const viewer = viewerRef.current;
    if (!viewer) return;
    const add = (p: { lng: number; lat: number }, css: string) => {
      const e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat),
        billboard: {
          image: pinImage(css), width: 30, height: 30,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }) as Ent;
      e.trailSlug = t.slug;
      endpointEntities.current.push(e);
    };
    if (t.start) add(t.start, "#2ecc71");
    if (t.finish) add(t.finish, "#e74c3c");
    requestRender();
  }

  useImperativeHandle(ref, (): MapHandle => ({
    showTrack(i, fly) {
      const viewer = viewerRef.current!;
      const t = trails[i];
      ensureEntity(i);
      activeSlug.current = t.slug;
      onActiveChange(t.slug);
      applyHighlight();
      showEndpoints(t);
      const e = entities.current[t.slug];
      if (fly && e) {
        // preserve the current orientation: only pan/zoom to the trail, keeping
        // the user's heading & pitch instead of tilting to a default 3D view.
        // range 0 lets Cesium compute a fit distance for the trail's extent.
        const offset = new Cesium.HeadingPitchRange(viewer.camera.heading, viewer.camera.pitch, 0);
        viewer.flyTo(e as Ent | Ent[], { duration: 1.2, offset });
      }
    },
    setHover(i) {
      const next = i == null ? null : trails[i].slug;
      if (next === hoverSlug.current) return;
      hoverSlug.current = next;
      applyHighlight();
    },
    resetView() {
      trails.forEach((_, i) => ensureEntity(i));
      applyHighlight();
      clearEndpoints();
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

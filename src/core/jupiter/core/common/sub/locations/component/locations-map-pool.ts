/// <reference types="google.maps" />

import { loadGoogleMapsLibrary } from "#/core/common/sub/locations/component/google-maps-loader";

const KEY_LOCATION_MARKER_URL =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <path fill="#F9A825" stroke="#E65100" stroke-width="1.5"
        d="M16 1C8.3 1 2 7.3 2 15c0 9.5 14 24 14 24s14-14.5 14-24C30 7.3 23.7 1 16 1z"/>
      <path fill="#5D4037"
        d="M16 8.2l1.85 3.75 4.15.6-3 2.92.71 4.13L16 17.7l-3.71 1.9.71-4.13-3-2.92 4.15-.6z"/>
    </svg>`.replace(/\s+/g, " "),
  );

export interface LocationMapMarker {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  href?: string;
  isKey?: boolean;
}

// Everything the map actually draws about a set of markers. Two sets with the
// same key look identical on screen, so there is nothing to redraw between
// them - which is the common case, since every Remix revalidation hands out a
// brand new array holding the very same locations.
function markersKeyOf(markers: LocationMapMarker[]): string {
  return markers
    .map(
      (marker) =>
        `${marker.id}:${marker.latitude}:${marker.longitude}:${marker.href ?? ""}:${marker.isKey ? "1" : "0"}`,
    )
    .join("|");
}

// Google maps are slow to build and they visibly flash while they fetch their
// tiles. React unmounts a route's components on every navigation and Remix
// hands out fresh loader data on every revalidation, so a map whose lifetime
// is a component's lifetime gets thrown away and rebuilt constantly. The maps
// therefore live out here, outside of React, in a small pool: a component
// borrows one while it is on screen and gives it back on unmount, tiles and
// camera and all. Coming back to a view - or a StrictMode double mount, or a
// revalidation - picks up the same map where it left off.
interface PooledMap {
  poolKey: string;
  apiKey: string;
  host: HTMLDivElement;
  map: google.maps.Map | null;
  loading: Promise<google.maps.Map | null> | null;
  pins: google.maps.Marker[];
  listeners: google.maps.MapsEventListener[];
  markersKey: string | null;
  onSelectHref: ((href: string) => void) | null;
  borrowed: boolean;
  returnedAt: number;
}

interface MapsDrawing {
  Marker: typeof google.maps.Marker;
  LatLngBounds: typeof google.maps.LatLngBounds;
  Size: typeof google.maps.Size;
  Point: typeof google.maps.Point;
}

// A borrowed map plus the second one a big screen can show next to it (a leaf
// and its leaflet) is as much as any single call site needs kept warm.
const MAX_IDLE_PER_POOL = 2;
// And this many across all of them, so a long session doesn't accumulate maps.
const MAX_IDLE_TOTAL = 4;

const POOLS = new Map<string, PooledMap[]>();

let drawing: MapsDrawing | null = null;

/** A map borrowed from the pool, for as long as a component is on screen. */
export interface BorrowedMap {
  /** Moves the map into ``container``, keeping whatever it already shows. */
  attachTo(container: HTMLElement): void;
  /** Draws ``markers``, doing nothing at all if they are already drawn. */
  showMarkers(markers: LocationMapMarker[]): void;
  /** Gives the map back to the pool. The map itself stays alive. */
  giveBack(): void;
}

export function borrowLocationsMap(
  cacheKey: string,
  apiKey: string,
  onSelectHref: (href: string) => void,
): BorrowedMap {
  const poolKey = `${cacheKey}::${apiKey}`;
  let pool = POOLS.get(poolKey);
  if (pool === undefined) {
    pool = [];
    POOLS.set(poolKey, pool);
  }

  let pooled = pool.find((candidate) => !candidate.borrowed);
  if (pooled === undefined) {
    pooled = newPooledMap(poolKey, apiKey);
    pool.push(pooled);
  }
  pooled.borrowed = true;
  pooled.onSelectHref = onSelectHref;

  const borrowed = pooled;
  let givenBack = false;

  return {
    attachTo(container: HTMLElement): void {
      attachTo(borrowed, container);
    },
    showMarkers(markers: LocationMapMarker[]): void {
      showMarkers(borrowed, markers);
    },
    giveBack(): void {
      if (givenBack) {
        return;
      }
      givenBack = true;
      borrowed.borrowed = false;
      borrowed.onSelectHref = null;
      borrowed.returnedAt = Date.now();
      borrowed.host.remove();
      dropExtraIdleMaps();
    },
  };
}

function newPooledMap(poolKey: string, apiKey: string): PooledMap {
  // The host fills its container outright, rather than via percentages, so
  // that it works the same in a fixed-height container and in one whose
  // height comes from an aspect ratio.
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.inset = "0";
  return {
    poolKey,
    apiKey,
    host,
    map: null,
    loading: null,
    pins: [],
    listeners: [],
    markersKey: null,
    onSelectHref: null,
    borrowed: false,
    returnedAt: 0,
  };
}

function attachTo(pooled: PooledMap, container: HTMLElement): void {
  if (pooled.host.parentElement !== container) {
    container.replaceChildren(pooled.host);
  }
  void ensureMap(pooled).then((map) => {
    if (map === null || pooled.host.parentElement === null) {
      return;
    }
    // Moving the host around the DOM can leave the map with a viewport it
    // computed while it was detached. Re-stating the camera settles it.
    const center = map.getCenter();
    if (center !== undefined) {
      map.setCenter(center);
    }
  });
}

function showMarkers(pooled: PooledMap, markers: LocationMapMarker[]): void {
  const markersKey = markersKeyOf(markers);
  if (pooled.markersKey === markersKey) {
    return;
  }
  pooled.markersKey = markersKey;
  void ensureMap(pooled).then((map) => {
    if (map === null || pooled.markersKey !== markersKey) {
      return;
    }
    drawMarkers(pooled, map, markers);
  });
}

function ensureMap(pooled: PooledMap): Promise<google.maps.Map | null> {
  if (pooled.loading === null) {
    pooled.loading = buildMap(pooled);
  }
  return pooled.loading;
}

async function buildMap(pooled: PooledMap): Promise<google.maps.Map | null> {
  try {
    const [{ Map }, { Marker }, { LatLngBounds, Size, Point }] =
      await Promise.all([
        loadGoogleMapsLibrary(pooled.apiKey, "maps"),
        loadGoogleMapsLibrary(pooled.apiKey, "marker"),
        loadGoogleMapsLibrary(pooled.apiKey, "core"),
      ]);
    drawing = { Marker, LatLngBounds, Size, Point };
    pooled.map = new Map(pooled.host, {
      center: { lat: 0, lng: 0 },
      zoom: 2,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    return pooled.map;
  } catch {
    // Invalid or blocked API keys should not break the page. Forget the
    // failure though, so that a later attempt gets to try again.
    pooled.loading = null;
    return null;
  }
}

function drawMarkers(
  pooled: PooledMap,
  map: google.maps.Map,
  markers: LocationMapMarker[],
): void {
  for (const listener of pooled.listeners) {
    listener.remove?.();
  }
  pooled.listeners = [];
  for (const pin of pooled.pins) {
    pin.setMap(null);
  }
  pooled.pins = [];

  if (drawing === null || markers.length === 0) {
    return;
  }
  const { Marker, LatLngBounds, Size, Point } = drawing;

  const bounds = new LatLngBounds();
  for (const marker of markers) {
    const position = { lat: marker.latitude, lng: marker.longitude };
    const pin = new Marker({
      map,
      position,
      title: marker.name,
      zIndex: marker.isKey ? 1000 : 1,
      ...(marker.isKey
        ? {
            icon: {
              url: KEY_LOCATION_MARKER_URL,
              scaledSize: new Size(28, 40),
              anchor: new Point(14, 40),
            },
          }
        : {}),
    });
    pooled.pins.push(pin);
    bounds.extend(position);
    const href = marker.href;
    if (href) {
      pooled.listeners.push(
        pin.addListener("click", () => {
          pooled.onSelectHref?.(href);
        }),
      );
    }
  }

  if (markers.length > 1) {
    map.fitBounds(bounds);
  } else {
    map.setCenter({ lat: markers[0].latitude, lng: markers[0].longitude });
    map.setZoom(10);
  }
}

function dropExtraIdleMaps(): void {
  const idlePerPool = new Map<string, number>();
  const idle: PooledMap[] = [];
  for (const pool of POOLS.values()) {
    for (const pooled of pool) {
      if (pooled.borrowed) {
        continue;
      }
      idle.push(pooled);
      idlePerPool.set(
        pooled.poolKey,
        (idlePerPool.get(pooled.poolKey) ?? 0) + 1,
      );
    }
  }

  // Oldest returned first, so the map most likely to be wanted again survives.
  idle.sort((left, right) => left.returnedAt - right.returnedAt);
  let total = idle.length;
  for (const pooled of idle) {
    const perPool = idlePerPool.get(pooled.poolKey) ?? 0;
    if (total <= MAX_IDLE_TOTAL && perPool <= MAX_IDLE_PER_POOL) {
      continue;
    }
    dropMap(pooled);
    total -= 1;
    idlePerPool.set(pooled.poolKey, perPool - 1);
  }
}

function dropMap(pooled: PooledMap): void {
  for (const listener of pooled.listeners) {
    listener.remove?.();
  }
  pooled.listeners = [];
  for (const pin of pooled.pins) {
    pin.setMap(null);
  }
  pooled.pins = [];
  if (pooled.map !== null) {
    google.maps.event.clearInstanceListeners(pooled.map);
  }
  pooled.map = null;
  pooled.loading = null;
  pooled.markersKey = null;
  pooled.host.remove();

  const pool = POOLS.get(pooled.poolKey);
  if (pool === undefined) {
    return;
  }
  const at = pool.indexOf(pooled);
  if (at >= 0) {
    pool.splice(at, 1);
  }
  if (pool.length === 0) {
    POOLS.delete(pooled.poolKey);
  }
}

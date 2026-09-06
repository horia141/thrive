import { JupiterLocationResolver, type Location } from "@jupiter/webapi-client";
import { Box, Typography } from "@mui/material";
import { useContext, useEffect, useRef } from "react";

import type {
  BorrowedMap,
  LocationMapMarker,
} from "#/core/common/sub/locations/component/locations-map-pool";
import { borrowLocationsMap } from "#/core/common/sub/locations/component/locations-map-pool";
import { locationGps } from "#/core/common/sub/locations/sub/location/root";
import { GlobalPropertiesContext } from "#/core/config-client";
import { GoogleMapsApiKeyContext } from "#/core/infra/google-maps-api-key-context";

export type { LocationMapMarker };

interface Props {
  title?: string;
  markers: LocationMapMarker[];
  height?: number;
  /**
   * Which pooled map this view borrows. Views sharing a key hand the same map
   * back and forth as you navigate between them, instead of building a new
   * one each time.
   */
  cacheKey?: string;
  onSelectHref?: (href: string) => void;
}

export function locationToMapMarker(
  location: Location,
  href?: string,
): LocationMapMarker | null {
  const gps = locationGps(location);
  if (!gps) {
    return null;
  }
  return {
    id: location.ref_id,
    name: location.name,
    latitude: gps.latitude,
    longitude: gps.longitude,
    href,
    isKey: location.is_key,
  };
}

export function LocationsMap({
  title = "Map",
  markers,
  height = 280,
  cacheKey = "locations-map",
  onSelectHref,
}: Props) {
  const overviewMap = title.length > 0;
  const globalProperties = useContext(GlobalPropertiesContext);
  const { googleMapsApiKey: apiKey } = useContext(GoogleMapsApiKeyContext);
  const showGoogleMaps =
    globalProperties.locationResolver === JupiterLocationResolver.GOOGLE_MAPS;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const borrowedRef = useRef<BorrowedMap | null>(null);
  const markersRef = useRef(markers);
  const onSelectHrefRef = useRef(onSelectHref);

  useEffect(() => {
    onSelectHrefRef.current = onSelectHref;
  }, [onSelectHref]);

  const canShowMap = showGoogleMaps && !!apiKey && markers.length > 0;

  // Borrow a map for as long as this view is on screen, rather than building
  // one. The map outlives the component, so a navigation away and back, a
  // StrictMode double mount, or a Remix revalidation all pick the same map
  // back up instead of flashing a fresh one into place.
  useEffect(() => {
    if (!canShowMap) {
      return;
    }
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const borrowed = borrowLocationsMap(cacheKey, apiKey as string, (href) =>
      onSelectHrefRef.current?.(href),
    );
    borrowedRef.current = borrowed;
    borrowed.attachTo(container);
    borrowed.showMarkers(markersRef.current);

    return () => {
      borrowedRef.current = null;
      borrowed.giveBack();
    };
  }, [canShowMap, cacheKey, apiKey]);

  // A revalidation hands out a fresh array holding the very same locations, so
  // let the map decide whether anything actually changed - it redraws only
  // when the pins themselves differ, and never touches the camera otherwise.
  useEffect(() => {
    markersRef.current = markers;
    borrowedRef.current?.showMarkers(markers);
  }, [markers]);

  if (!showGoogleMaps || markers.length === 0) {
    return null;
  }

  return (
    <Box sx={{ mb: title ? 2 : 0, width: "100%" }}>
      {title ? (
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {title}
        </Typography>
      ) : null}
      <Box
        ref={containerRef}
        sx={{
          position: "relative",
          width: "100%",
          ...(overviewMap
            ? {
                aspectRatio: "4 / 3",
                height: "auto",
                maxHeight: 480,
              }
            : { height }),
          borderRadius: title ? 1 : 0.5,
          overflow: "hidden",
          ...(title
            ? {
                border: "1px solid",
                borderColor: "divider",
              }
            : undefined),
        }}
      />
    </Box>
  );
}

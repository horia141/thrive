import { JupiterLocationResolver, type Location } from "@jupiter/webapi-client";
import { useContext, useMemo } from "react";

import {
  LocationsMap,
  locationToMapMarker,
} from "#/core/common/sub/locations/component/locations-map";
import { GlobalPropertiesContext } from "#/core/config-client";
import { SectionCard } from "#/core/infra/component/section-card";
import { GoogleMapsApiKeyContext } from "#/core/infra/google-maps-api-key-context";

interface EntityLocationMapSectionProps {
  locations?: Array<Location> | null;
  location?: Location | null;
  /**
   * Which pooled map to borrow. Entity views share one by default, so moving
   * between entities re-pins the map you already have instead of building a
   * new one. A view showing two of these at once needs to override it.
   */
  cacheKey?: string;
}

export function EntityLocationMapSection({
  locations,
  location,
  cacheKey = "entity-location-map",
}: EntityLocationMapSectionProps) {
  const globalProperties = useContext(GlobalPropertiesContext);
  const { googleMapsApiKey: apiKey } = useContext(GoogleMapsApiKeyContext);
  const showGoogleMaps =
    globalProperties.locationResolver === JupiterLocationResolver.GOOGLE_MAPS;
  const markers = useMemo(() => {
    const resolvedLocations = locations ?? (location ? [location] : []);
    return resolvedLocations.flatMap((linkedLocation) => {
      const marker = locationToMapMarker(linkedLocation);
      return marker ? [marker] : [];
    });
  }, [locations, location]);

  if (!showGoogleMaps || !apiKey || markers.length === 0) {
    return null;
  }

  return (
    <SectionCard id="entity-location-map" title="Map">
      <LocationsMap
        title=""
        markers={markers}
        height={240}
        cacheKey={cacheKey}
      />
    </SectionCard>
  );
}

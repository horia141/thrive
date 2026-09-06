import type { Location } from "@jupiter/webapi-client";
import { DocsHelpSubject } from "@jupiter/webapi-client";
import { Typography } from "@mui/material";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { Outlet, useNavigate } from "@remix-run/react";
import { AnimatePresence } from "framer-motion";
import { useCallback, useMemo } from "react";
import { EntityNameComponent } from "@jupiter/core/common/component/entity-name";
import { IsKeyTag } from "@jupiter/core/common/component/is-key-tag";
import { LocationGpsTag } from "@jupiter/core/common/sub/locations/component/location-gps-tag";
import {
  LocationsMap,
  locationToMapMarker,
} from "@jupiter/core/common/sub/locations/component/locations-map";
import {
  locationGps,
  sortLocationsNaturally,
} from "@jupiter/core/common/sub/locations/sub/location/root";
import {
  EntityCard,
  EntityLink,
} from "@jupiter/core/infra/component/entity-card";
import { EntityNoNothingCard } from "@jupiter/core/infra/component/entity-no-nothing-card";
import { EntityStack } from "@jupiter/core/infra/component/entity-stack";
import { SlimChip } from "@jupiter/core/infra/component/chips";
import { makeTrunkErrorBoundary } from "@jupiter/core/infra/component/error-boundary";
import { NestingAwareBlock } from "@jupiter/core/infra/component/layout/nesting-aware-block";
import { TrunkPanel } from "@jupiter/core/infra/component/layout/trunk-panel";
import {
  DisplayType,
  useTrunkNeedsToShowLeaf,
} from "@jupiter/core/infra/component/use-nested-entities";

import { useLoaderDataSafeForAnimation } from "~/rendering/use-loader-data-for-animation";
import { standardShouldRevalidate } from "~/rendering/standard-should-revalidate";
import { getLoggedInApiClient } from "~/api-clients.server";

export const handle = {
  displayType: DisplayType.TRUNK,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const apiClient = await getLoggedInApiClient(request);

  const result = await apiClient.locations.locationFind({
    allow_archived: false,
  });

  return json({
    locations: result.locations as Array<Location>,
  });
}

export const shouldRevalidate: ShouldRevalidateFunction =
  standardShouldRevalidate;

export default function Locations() {
  const { locations } = useLoaderDataSafeForAnimation<typeof loader>();
  const shouldShowALeafToo = useTrunkNeedsToShowLeaf();
  const navigate = useNavigate();
  const handleMapSelect = useCallback(
    (href: string) => {
      navigate(href);
    },
    [navigate],
  );

  const shownLocations = useMemo(
    () => sortLocationsNaturally(locations),
    [locations],
  );

  const mapMarkers = useMemo(
    () =>
      shownLocations.flatMap((location) => {
        const marker = locationToMapMarker(
          location,
          `/app/workspace/core/locations/${location.ref_id}`,
        );
        return marker ? [marker] : [];
      }),
    [shownLocations],
  );

  return (
    <TrunkPanel
      key={"core/locations"}
      createLocation="/app/workspace/core/locations/new"
      returnLocation="/app/workspace"
    >
      <NestingAwareBlock shouldHide={shouldShowALeafToo}>
        <LocationsMap
          title="Locations"
          markers={mapMarkers}
          cacheKey="core-locations"
          onSelectHref={handleMapSelect}
        />

        {shownLocations.length === 0 && (
          <EntityNoNothingCard
            title="No Locations"
            message="There are no locations to show. You can create a new location."
            newEntityLocations="/app/workspace/core/locations/new"
            helpSubject={DocsHelpSubject.ROOT}
          />
        )}

        <EntityStack>
          {shownLocations.map((location) => {
            const gps = locationGps(location);
            return (
              <EntityCard
                entityId={`location-${location.ref_id}`}
                key={`location-${location.ref_id}`}
              >
                <EntityLink
                  to={`/app/workspace/core/locations/${location.ref_id}`}
                  singleLine
                >
                  <IsKeyTag isKey={location.is_key} />
                  <EntityNameComponent name={location.name} />
                  {location.address_line && (
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {location.address_line}
                    </Typography>
                  )}
                  {location.country && (
                    <SlimChip label={location.country} color="info" />
                  )}
                  {gps && <LocationGpsTag gps={gps} />}
                </EntityLink>
              </EntityCard>
            );
          })}
        </EntityStack>
      </NestingAwareBlock>

      <AnimatePresence mode="wait" initial={false}>
        <Outlet />
      </AnimatePresence>
    </TrunkPanel>
  );
}

export const ErrorBoundary = makeTrunkErrorBoundary("/app/workspace", {
  error: () => `There was an error loading the locations! Please try again!`,
});

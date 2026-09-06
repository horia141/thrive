import type {
  Contact,
  Tag,
  TravelWishFindResultEntry,
} from "@jupiter/webapi-client";
import { DocsHelpSubject } from "@jupiter/webapi-client";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { Outlet, useNavigate } from "@remix-run/react";
import { AnimatePresence } from "framer-motion";
import { useCallback, useContext, useMemo, useState } from "react";
import {
  LocationsMap,
  locationToMapMarker,
} from "@jupiter/core/common/sub/locations/component/locations-map";
import { sortTravelWishesNaturally } from "@jupiter/core/apps/vacations/sub/travel_wish/root";
import { EntityNameComponent } from "@jupiter/core/common/component/entity-name";
import { EntityNoNothingCard } from "@jupiter/core/infra/component/entity-no-nothing-card";
import {
  EntityCard,
  EntityLink,
} from "@jupiter/core/infra/component/entity-card";
import { EntityStack } from "@jupiter/core/infra/component/entity-stack";
import { makeTrunkErrorBoundary } from "@jupiter/core/infra/component/error-boundary";
import { NestingAwareBlock } from "@jupiter/core/infra/component/layout/nesting-aware-block";
import { TrunkPanel } from "@jupiter/core/infra/component/layout/trunk-panel";
import {
  DisplayType,
  useTrunkNeedsToShowLeaf,
} from "@jupiter/core/infra/component/use-nested-entities";
import { TopLevelInfoContext } from "@jupiter/core/infra/top-level-context";
import {
  FilterManyOptions,
  NavSingle,
  SectionActions,
} from "@jupiter/core/infra/component/section-actions";
import { TagTag } from "#/core/common/sub/tags/component/tag-tag";
import { ContactTag } from "#/core/common/sub/contacts/component/contact-tag";
import { LocationTag } from "#/core/common/sub/locations/component/location-tag";
import { UserLightChip } from "#/core/users/components/user-light-chip";

import { useLoaderDataSafeForAnimation } from "~/rendering/use-loader-data-for-animation";
import { standardShouldRevalidate } from "~/rendering/standard-should-revalidate";
import { getLoggedInApiClient } from "~/api-clients.server";

export const handle = {
  displayType: DisplayType.TRUNK,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const apiClient = await getLoggedInApiClient(request);
  const response = await apiClient.vacations.travelWishFind({
    allow_archived: false,
    include_tags: true,
  });

  const allTags = await apiClient.tags.tagFind({
    allow_archived: false,
  });
  const allContacts = await apiClient.contacts.contactFind({
    allow_archived: false,
  });

  return json({
    entries: response.entries,
    allTags: allTags.tags as Array<Tag>,
    allContacts: allContacts.contacts as Array<Contact>,
  });
}

export const shouldRevalidate: ShouldRevalidateFunction =
  standardShouldRevalidate;

export default function TravelWishWishlist() {
  const loaderData = useLoaderDataSafeForAnimation<typeof loader>();
  const topLevelInfo = useContext(TopLevelInfoContext);

  const entries = loaderData.entries as Array<TravelWishFindResultEntry>;
  const [selectedTagsRefId, setSelectedTagsRefId] = useState<string[]>([]);
  const [selectedContactsRefId, setSelectedContactsRefId] = useState<string[]>(
    [],
  );

  const entriesByRefId = new Map<string, TravelWishFindResultEntry>();
  for (const entry of entries) {
    entriesByRefId.set(entry.travel_wish.ref_id, entry);
  }

  const sortedTravelWishes = sortTravelWishesNaturally(
    entries
      .map((e) => e.travel_wish)
      .filter((travelWish) => {
        const entry = entriesByRefId.get(travelWish.ref_id);
        const tagsOk =
          selectedTagsRefId.length === 0 ||
          entry?.tags?.some((tag: Tag) =>
            selectedTagsRefId.includes(tag.ref_id),
          );
        const contactsOk =
          selectedContactsRefId.length === 0 ||
          entry?.contacts?.some((contact: Contact) =>
            selectedContactsRefId.includes(contact.ref_id),
          );
        return tagsOk && contactsOk;
      }),
  );

  const shouldShowALeaf = useTrunkNeedsToShowLeaf();
  const navigate = useNavigate();
  const handleMapSelect = useCallback(
    (href: string) => {
      navigate(href);
    },
    [navigate],
  );
  const visibleTravelWishRefIds = useMemo(
    () => new Set(sortedTravelWishes.map((travelWish) => travelWish.ref_id)),
    [sortedTravelWishes],
  );
  const mapMarkers = useMemo(
    () =>
      entries.flatMap((entry) => {
        if (!visibleTravelWishRefIds.has(entry.travel_wish.ref_id)) {
          return [];
        }
        return (entry.locations ?? []).flatMap((location) => {
          const marker = locationToMapMarker(
            location,
            `/app/workspace/apps/vacations/wish-list/${entry.travel_wish.ref_id}`,
          );
          return marker ? [marker] : [];
        });
      }),
    [entries, visibleTravelWishRefIds],
  );

  return (
    <TrunkPanel
      key={"vacations-wishlist"}
      createLocation="/app/workspace/apps/vacations/wish-list/new"
      returnLocation="/app/workspace"
      actions={
        <SectionActions
          id="travel-wishes-actions"
          topLevelInfo={topLevelInfo}
          inputsEnabled={true}
          actions={[
            NavSingle({
              id: "vacations-all",
              text: "All vacations",
              link: "/app/workspace/apps/vacations/vacation",
              icon: <EventAvailableIcon />,
            }),
            FilterManyOptions(
              "Tags",
              loaderData.allTags.map((tag) => ({
                value: tag.ref_id,
                text: tag.name,
              })),
              setSelectedTagsRefId,
            ),
            FilterManyOptions(
              "Contacts",
              loaderData.allContacts.map((contact) => ({
                value: contact.ref_id,
                text: contact.name,
              })),
              setSelectedContactsRefId,
            ),
          ]}
        />
      }
    >
      <NestingAwareBlock shouldHide={shouldShowALeaf}>
        <LocationsMap
          title="Wishlist locations"
          markers={mapMarkers}
          cacheKey="vacations-wish-list"
          onSelectHref={handleMapSelect}
        />

        {sortedTravelWishes.length === 0 && (
          <EntityNoNothingCard
            title="You Have To Start Somewhere"
            message="There are no travel wishes to show. You can add a place you'd like to visit."
            newEntityLocations="/app/workspace/apps/vacations/wish-list/new"
            helpSubject={DocsHelpSubject.VACATIONS}
          />
        )}

        <EntityStack>
          {sortedTravelWishes.map((travelWish) => {
            const entry = entriesByRefId.get(travelWish.ref_id);
            return (
              <EntityCard
                entityId={`travel-wish-${travelWish.ref_id}`}
                key={`travel-wish-${travelWish.ref_id}`}
              >
                {entry && (
                  <UserLightChip
                    user={entry.owner}
                    currentUserRefId={topLevelInfo.user.ref_id}
                  />
                )}
                <EntityLink
                  to={`/app/workspace/apps/vacations/wish-list/${travelWish.ref_id}`}
                >
                  <EntityNameComponent name={travelWish.name} />
                  {entry?.tags?.map((tag: Tag) => (
                    <TagTag key={tag.ref_id} tag={tag} />
                  ))}
                  {entry?.contacts?.map((contact: Contact) => (
                    <ContactTag key={contact.ref_id} contact={contact} />
                  ))}
                  {entry?.locations?.map((location) => (
                    <LocationTag key={location.ref_id} location={location} />
                  ))}
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
  error: () =>
    `There was an error loading the travel wishlist! Please try again!`,
});

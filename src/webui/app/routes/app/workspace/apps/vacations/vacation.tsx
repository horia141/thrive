import type {
  ADate,
  Contact,
  Vacation,
  VacationFindResultEntry,
  Tag,
} from "@jupiter/webapi-client";
import LuggageIcon from "@mui/icons-material/Luggage";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import { Box, IconButton, Typography, styled } from "@mui/material";
import type { CalendarTooltipProps, TimeRangeDayData } from "@nivo/calendar";
import { ResponsiveTimeRange } from "@nivo/calendar";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { Outlet, useNavigate } from "@remix-run/react";
import { AnimatePresence } from "framer-motion";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { aDateToDate } from "@jupiter/core/common/adate";
import {
  LocationsMap,
  locationToMapMarker,
} from "@jupiter/core/common/sub/locations/component/locations-map";
import { DocsHelpSubject } from "@jupiter/webapi-client";
import { sortVacationsNaturally } from "@jupiter/core/apps/vacations/sub/vacation/root";
import { ADateTag } from "@jupiter/core/common/component/adate-tag";
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
import { useBigScreen } from "@jupiter/core/infra/component/use-big-screen";
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
  const response = await apiClient.vacations.vacationFind({
    allow_archived: false,
    include_notes: false,
    include_time_event_blocks: false,
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

export default function Vacations() {
  const loaderData = useLoaderDataSafeForAnimation<typeof loader>();
  const topLevelInfo = useContext(TopLevelInfoContext);

  const entries = loaderData.entries as Array<VacationFindResultEntry>;
  const [selectedTagsRefId, setSelectedTagsRefId] = useState<string[]>([]);
  const [selectedContactsRefId, setSelectedContactsRefId] = useState<string[]>(
    [],
  );

  const entriesByRefId = new Map<string, VacationFindResultEntry>();
  for (const entry of entries) {
    entriesByRefId.set(entry.vacation.ref_id, entry);
  }

  const sortedVacations = sortVacationsNaturally(
    entries
      .map((e) => e.vacation)
      .filter((vacation) => {
        const entry = entriesByRefId.get(vacation.ref_id);
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
  const visibleVacationRefIds = useMemo(
    () => new Set(sortedVacations.map((vacation) => vacation.ref_id)),
    [sortedVacations],
  );
  const mapMarkers = useMemo(
    () =>
      entries.flatMap((entry) => {
        if (!visibleVacationRefIds.has(entry.vacation.ref_id)) {
          return [];
        }
        return (entry.locations ?? []).flatMap((location) => {
          const marker = locationToMapMarker(
            location,
            `/app/workspace/apps/vacations/vacation/${entry.vacation.ref_id}`,
          );
          return marker ? [marker] : [];
        });
      }),
    [entries, visibleVacationRefIds],
  );

  return (
    <TrunkPanel
      key={"vacations"}
      createLocation="/app/workspace/apps/vacations/vacation/new"
      returnLocation="/app/workspace"
      actions={
        <SectionActions
          id="vacations-actions"
          topLevelInfo={topLevelInfo}
          inputsEnabled={true}
          actions={[
            NavSingle({
              id: "vacations-wishlist",
              text: "Wishlist",
              link: "/app/workspace/apps/vacations/wish-list",
              icon: <LuggageIcon />,
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
        <VacationCalendar
          today={topLevelInfo.today}
          sortedVacations={sortedVacations}
        />
        <LocationsMap
          title="Vacation locations"
          markers={mapMarkers}
          cacheKey="vacations"
          onSelectHref={handleMapSelect}
        />

        {sortedVacations.length === 0 && (
          <EntityNoNothingCard
            title="You Have To Start Somewhere"
            message="There are no vacations to show. You can create a new vacation."
            newEntityLocations="/app/workspace/apps/vacations/vacation/new"
            helpSubject={DocsHelpSubject.VACATIONS}
          />
        )}

        <EntityStack>
          {sortedVacations.map((vacation) => {
            const entry = entriesByRefId.get(vacation.ref_id);
            return (
              <EntityCard
                entityId={`vacation-${vacation.ref_id}`}
                key={`vacation-${vacation.ref_id}`}
              >
                {entry && (
                  <UserLightChip
                    user={entry.owner}
                    currentUserRefId={topLevelInfo.user.ref_id}
                  />
                )}
                <EntityLink
                  to={`/app/workspace/apps/vacations/vacation/${vacation.ref_id}`}
                >
                  <EntityNameComponent name={vacation.name} />
                  <ADateTag label="Start Date" date={vacation.start_date} />
                  <ADateTag
                    label="End Date"
                    date={vacation.end_date}
                    color="success"
                  />
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

interface VacationCalendarProps {
  today: ADate;
  sortedVacations: Array<Vacation>;
}

function VacationCalendar({ today, sortedVacations }: VacationCalendarProps) {
  const earliestDate =
    sortedVacations.length > 0
      ? aDateToDate(sortedVacations[sortedVacations.length - 1].start_date)
      : aDateToDate(today);
  const latestDate =
    sortedVacations.length > 0
      ? aDateToDate(sortedVacations[0].end_date)
      : earliestDate;

  const [vacationDays, vacationsById, data] = useMemo(() => {
    const vacationDays = new Map<string, Set<string>>();
    const vacationsById = new Map<string, Vacation>();

    for (const vacation of sortedVacations) {
      let walker = aDateToDate(vacation.start_date).startOf("day");
      const limit = aDateToDate(vacation.end_date).endOf("day").toISODate();
      while (walker.toISODate() <= limit) {
        const entry = vacationDays.get(walker.toISODate()) || new Set<string>();
        entry.add(vacation.ref_id);
        vacationDays.set(walker.toISODate(), entry);
        walker = walker.plus({ days: 1 });
      }

      vacationsById.set(vacation.ref_id, vacation);
    }

    const data = [];
    let currDate = earliestDate!;

    while (currDate.toISODate() <= latestDate.toISODate()) {
      data.push({
        value: vacationDays.has(currDate.toISODate()) ? 100 : 0,
        day: currDate.toISODate(),
      });
      currDate = currDate.plus({ days: 1 });
    }

    return [vacationDays, vacationsById, data];
  }, [sortedVacations, earliestDate, latestDate]);

  const isBigScreen = useBigScreen();
  const intervalStep = isBigScreen ? "year" : "month";

  const firstIntervalRoundDate = earliestDate.startOf(intervalStep);
  const lastIntervalRoundDate = latestDate.endOf(intervalStep);
  const [currentInterval, setCurrentInterval] = useState(
    lastIntervalRoundDate.startOf(intervalStep),
  );
  useEffect(() => {
    setCurrentInterval(() => lastIntervalRoundDate.startOf(intervalStep));
    // Disabled beacuse eslint is wrong here!
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBigScreen]);

  const dayClickNavigate = useNavigate();

  function handlePrevInterval() {
    if (currentInterval === firstIntervalRoundDate) {
      return;
    }
    setCurrentInterval((ci) =>
      intervalStep === "year"
        ? ci.minus({ years: 1 })
        : ci.minus({ months: 1 }),
    );
  }

  function handleNextInterval() {
    if (currentInterval === lastIntervalRoundDate) {
      return;
    }
    setCurrentInterval((ci) =>
      intervalStep === "year" ? ci.plus({ years: 1 }) : ci.plus({ months: 1 }),
    );
  }

  function handleDayClick(datum: TimeRangeDayData) {
    if (!vacationDays.has(datum.day)) {
      return null;
    }

    const [theId] = vacationDays.get(datum.day) as Set<string>;
    dayClickNavigate(`/app/workspace/apps/vacations/vacation/${theId}`);
  }

  function handleTooltip(props: CalendarTooltipProps) {
    if (!vacationDays.has(props.day)) {
      return null;
    }

    const [theId] = vacationDays.get(props.day) as Set<string>;
    const vacation = vacationsById.get(theId) as Vacation;
    return (
      <TooltipBox
        sx={{
          backgroundColor: "white",
        }}
      >
        {vacation.name}
      </TooltipBox>
    );
  }

  return (
    <StyledDiv>
      <IconButton
        disabled={currentInterval.equals(firstIntervalRoundDate)}
        onClick={handlePrevInterval}
        aria-label="previous-interval"
        size="large"
      >
        <ArrowBackIosNewIcon fontSize="inherit" />
      </IconButton>
      <Box sx={{ minWidth: isBigScreen ? "900px" : "200px" }}>
        <Typography sx={{ textAlign: "center" }}>
          Year {currentInterval.toFormat("yyyy")}
        </Typography>
        <ResponsiveTimeRange
          data={data}
          from={currentInterval.toFormat("yyyy-MM-dd")}
          to={currentInterval.endOf(intervalStep).toFormat("yyyy-MM-dd")}
          weekdayLegendOffset={60}
          weekdayTicks={[0, 1, 2, 3, 4, 5, 6]}
          onClick={handleDayClick}
          tooltip={handleTooltip}
          minValue={0}
          maxValue={100}
          emptyColor="#eeeeee"
          colors={["#eeeeee", "#61cdbb"]}
          align="center"
          margin={{
            top: 40,
            right: isBigScreen ? 100 : 60,
            bottom: 20,
            left: isBigScreen ? 40 : 0,
          }}
        />
      </Box>
      <IconButton
        disabled={currentInterval
          .endOf(intervalStep)
          .equals(lastIntervalRoundDate)}
        onClick={handleNextInterval}
        aria-label="next-interval"
        size="large"
      >
        <ArrowForwardIosIcon fontSize="inherit" />
      </IconButton>
    </StyledDiv>
  );
}

export const ErrorBoundary = makeTrunkErrorBoundary("/app/workspace", {
  error: () => `There was an error loading the vacations! Please try again!`,
});

const TooltipBox = styled("div")`
  font-size: 1rem;
  border: 1px dashed gray;
  padding: 5px;
  border-radius: 5px;
`;

const StyledDiv = styled("div")`
  height: 180px;
  display: flex;
  justify-content: space-between;
  flex-direction: row;
`;

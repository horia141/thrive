import { NamedEntityTag } from "@jupiter/webapi-client";
import {
  FormControl,
  InputLabel,
  OutlinedInput,
  Stack,
  Typography,
} from "@mui/material";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { useActionData, useNavigation } from "@remix-run/react";
import { ReasonPhrases, StatusCodes } from "http-status-codes";
import { useContext } from "react";
import { z } from "zod";
import { parseForm, parseParams } from "zodix";
import { entityLinkStd } from "@jupiter/core/common/entity-link";
import { EntityLocationMapSection } from "@jupiter/core/common/sub/locations/component/entity-location-map-section";
import { LocationsEditor } from "@jupiter/core/common/sub/locations/component/locations-editor";
import { TagsEditor } from "@jupiter/core/common/sub/tags/component/tags-editor";
import { DirSelect } from "@jupiter/core/apps/docs/sub/dir/component/select";
import { makeLeafErrorBoundary } from "@jupiter/core/infra/component/error-boundary";
import { FieldError, GlobalError } from "@jupiter/core/infra/component/errors";
import { LeafPanel } from "@jupiter/core/infra/component/layout/leaf-panel";
import { SectionCard } from "@jupiter/core/infra/component/section-card";
import {
  ActionSingle,
  SectionActions,
} from "@jupiter/core/infra/component/section-actions";
import { DisplayType } from "@jupiter/core/infra/component/use-nested-entities";
import { LeafPanelExpansionState } from "@jupiter/core/infra/leaf-panel-expansion";
import { TopLevelInfoContext } from "@jupiter/core/infra/top-level-context";
import { accessStatusAllowsWriterOrAbove } from "#/core/common/sub/access/access-level";
import {
  handleActionApiError,
  handleLoaderApiError,
} from "@jupiter/core/infra/errors.server";

import { standardShouldRevalidate } from "~/rendering/standard-should-revalidate";
import { useLoaderDataSafeForAnimation } from "~/rendering/use-loader-data-for-animation";
import { getLoggedInApiClient } from "~/api-clients.server";

const ParamsSchema = z.object({
  dirId: z.string(),
  docId: z.string(),
});

const UpdateFormSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("update"),
    name: z.string(),
    parent_dir_ref_id: z.string(),
  }),
]);

export const handle = {
  displayType: DisplayType.LEAFLET,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const apiClient = await getLoggedInApiClient(request);
  const { dirId, docId } = parseParams(params, ParamsSchema);

  try {
    const [docResult, findResult, allTags] = await Promise.all([
      apiClient.docs.docLoad({
        ref_id: docId,
        allow_archived: true,
      }),
      apiClient.docs.dirFind({
        allow_archived: false,
        include_tags: false,
      }),
      apiClient.tags.tagFind({
        allow_archived: false,
      }),
    ]);

    if (docResult.doc.parent_dir_ref_id !== dirId) {
      throw new Response(ReasonPhrases.NOT_FOUND, {
        status: StatusCodes.NOT_FOUND,
        statusText: ReasonPhrases.NOT_FOUND,
      });
    }

    const allDirsByRefId = new Map(
      findResult.entries.map((e) => [e.dir.ref_id, e.dir]),
    );
    const parentDirAccessible = allDirsByRefId.has(
      docResult.doc.parent_dir_ref_id,
    );
    if (!parentDirAccessible) {
      // Keep the current parent displayable when the viewer cannot access that
      // folder (shared doc without parent-dir access). The select is disabled.
      allDirsByRefId.set(docResult.doc.parent_dir_ref_id, {
        ref_id: docResult.doc.parent_dir_ref_id,
        version: 0,
        archived: false,
        created_time: docResult.doc.created_time,
        last_modified_time: docResult.doc.last_modified_time,
        name: "Folder (no access)",
        doc_collection_ref_id: "",
        parent_dir_ref_id: null,
      });
    }

    return json({
      doc: docResult.doc,
      tags: docResult.tags,
      location: docResult.location ?? null,
      owner: docResult.owner,
      accessStatus: docResult.access_status ?? null,
      allDirs: [...allDirsByRefId.values()],
      parentDirAccessible,
      allTags: allTags.tags,
      dirId,
      docId,
    });
  } catch (error) {
    handleLoaderApiError(error);
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const apiClient = await getLoggedInApiClient(request);
  const { dirId, docId } = parseParams(params, ParamsSchema);
  const form = await parseForm(request, UpdateFormSchema);

  try {
    switch (form.intent) {
      case "update": {
        const docResult = await apiClient.docs.docLoad({
          ref_id: docId,
          allow_archived: true,
        });
        if (docResult.doc.parent_dir_ref_id !== dirId) {
          throw new Response(ReasonPhrases.NOT_FOUND, {
            status: StatusCodes.NOT_FOUND,
            statusText: ReasonPhrases.NOT_FOUND,
          });
        }
        if (docResult.doc.archived) {
          return redirect(
            `/app/workspace/apps/docs/${dirId}/doc/${docId}/settings`,
          );
        }

        const parentChanged =
          form.parent_dir_ref_id !== docResult.doc.parent_dir_ref_id;

        await apiClient.docs.docUpdate({
          ref_id: docId,
          name: {
            should_change: true,
            value: form.name,
          },
          parent_dir_ref_id: parentChanged
            ? {
                should_change: true,
                value: form.parent_dir_ref_id,
              }
            : { should_change: false },
        });

        return redirect(
          `/app/workspace/apps/docs/${form.parent_dir_ref_id}/doc/${docId}`,
        );
      }

      default:
        throw new Response("Bad Intent", { status: 500 });
    }
  } catch (error) {
    return handleActionApiError(error);
  }
}

export const shouldRevalidate: ShouldRevalidateFunction =
  standardShouldRevalidate;

export default function DocSettings() {
  const loaderData = useLoaderDataSafeForAnimation<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const topLevelInfo = useContext(TopLevelInfoContext);
  const inputsEnabled =
    navigation.state === "idle" &&
    !loaderData.doc.archived &&
    accessStatusAllowsWriterOrAbove(loaderData.accessStatus);

  return (
    <LeafPanel
      key={`docs-doc-settings-${loaderData.doc.ref_id}`}
      entityType={NamedEntityTag.DOC}
      entityRefId={loaderData.doc.ref_id}
      isLeaflet
      fakeKey={`docs-doc-settings-${loaderData.doc.ref_id}`}
      returnLocation={`/app/workspace/apps/docs/${loaderData.dirId}/doc/${loaderData.doc.ref_id}`}
      forgetReturnLocation="/app/workspace/apps/docs/root-redirect"
      inputsEnabled={inputsEnabled}
      entityArchived={loaderData.doc.archived}
      accessable
      accessOwner={loaderData.owner}
      accessStatus={loaderData.accessStatus}
      initialExpansionState={LeafPanelExpansionState.FULL}
    >
      <GlobalError actionResult={actionData} />

      <SectionCard
        title="Doc"
        actions={
          !loaderData.doc.archived ? (
            <SectionActions
              id="docs-doc-settings-save"
              topLevelInfo={topLevelInfo}
              inputsEnabled={inputsEnabled}
              actions={[
                ActionSingle({
                  id: "docs-doc-settings-save",
                  text: "Save",
                  value: "update",
                  highlight: true,
                }),
              ]}
            />
          ) : undefined
        }
      >
        <Stack spacing={2}>
          {loaderData.doc.archived && (
            <Typography variant="body2" color="text.secondary">
              This doc is archived; settings cannot be edited.
            </Typography>
          )}
          <FormControl fullWidth>
            <InputLabel id="docs-doc-settings-name">Name</InputLabel>
            <OutlinedInput
              label="Name"
              name="name"
              defaultValue={loaderData.doc.name}
              readOnly={!inputsEnabled}
              inputProps={{
                "aria-labelledby": "docs-doc-settings-name",
              }}
            />
            <FieldError actionResult={actionData} fieldName="/name" />
          </FormControl>

          <DirSelect
            name="parent_dir_ref_id"
            label="Folder"
            inputsEnabled={inputsEnabled && loaderData.parentDirAccessible}
            disabled={!loaderData.parentDirAccessible}
            allDirs={loaderData.allDirs}
            defaultValue={loaderData.doc.parent_dir_ref_id}
          />

          <Stack
            direction="row"
            spacing={1}
            sx={{ minWidth: 0, width: "100%" }}
          >
            <TagsEditor
              name="tags"
              allTags={loaderData.allTags}
              defaultValue={loaderData.tags.map((t) => t.ref_id)}
              inputsEnabled={inputsEnabled}
              owner={entityLinkStd(NamedEntityTag.DOC, loaderData.doc.ref_id)}
              label="Tags"
              aloneOnLine
            />
            <LocationsEditor
              name="locations"
              aloneOnLine
              linkedLocation={loaderData.location}
              inputsEnabled={inputsEnabled}
              entityOwnerRefId={loaderData.owner?.ref_id}
              owner={entityLinkStd(NamedEntityTag.DOC, loaderData.doc.ref_id)}
            />
          </Stack>
        </Stack>
      </SectionCard>
      <EntityLocationMapSection
        location={loaderData.location}
        cacheKey="entity-location-map-leaflet"
      />
    </LeafPanel>
  );
}

export const ErrorBoundary = makeLeafErrorBoundary(
  (params) => `/app/workspace/apps/docs/${params.dirId}/doc/${params.docId}`,
  ParamsSchema,
  {
    notFound: (params) => `Could not find doc #${params.docId}!`,
    error: (params) =>
      `There was an error loading doc settings #${params.docId}! Please try again!`,
  },
);

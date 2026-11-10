import { useEffect, useMemo, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";

import {
  createCustomConnector,
  deleteCanonicalConnector,
  fetchCanonicalConnectors,
  promoteRegistryDomain,
  searchOpsRegistry,
  type CanonicalConnectorRow,
  type RegistrySearchHit,
} from "../../api/opsRegistry.js";
import { LogoTile } from "./adminConnectorLogo.js";
import {
  buildRegistrySearchRows,
  canDeleteCanonical,
  CUSTOM_SURFACE_KINDS,
  emptyCustomSurfaceDraft,
  liveCanonicalRows,
  parseCustomConnectorForm,
  SURFACE_CHIP_LABELS,
  type CustomSurfaceDraft,
  type CustomSurfaceKind,
} from "./opsRegistry.js";

function KindChips({ kinds }: { kinds: RegistrySearchHit["kinds"] }) {
  return (
    <HStack gap={1} align="center">
      {kinds.map((kind) => (
        <Badge
          key={kind}
          variant="neutral"
          label={SURFACE_CHIP_LABELS[kind]}
        />
      ))}
    </HStack>
  );
}

function CustomConnectorForm(input: {
  busy: boolean;
  onSubmit: (draft: {
    slug: string;
    label: string;
    surface: CustomSurfaceDraft;
  }) => void;
}): React.JSX.Element {
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [surface, setSurface] = useState<CustomSurfaceDraft>(
    emptyCustomSurfaceDraft,
  );

  function patch(next: Partial<CustomSurfaceDraft>) {
    setSurface((current) => ({ ...current, ...next }));
  }

  return (
    <form
      data-testid="ops-registry-custom-form"
      onSubmit={(event) => {
        event.preventDefault();
        input.onSubmit({ slug, label, surface });
      }}
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-background-surface)",
        padding: "var(--spacing-3)",
        width: 360,
      }}
    >
      <VStack gap={3}>
        <TextInput
          label="Slug"
          value={slug}
          onChange={setSlug}
          htmlName="slug"
          isDisabled={input.busy}
        />
        <TextInput
          label="Label"
          value={label}
          onChange={setLabel}
          htmlName="label"
          isDisabled={input.busy}
        />
        <label>
          <Text type="supporting" color="secondary">
            Surface
          </Text>
          <select
            aria-label="Surface"
            data-testid="ops-registry-custom-kind"
            value={surface.kind}
            disabled={input.busy}
            onChange={(event) =>
              patch({ kind: event.target.value as CustomSurfaceKind })
            }
          >
            {CUSTOM_SURFACE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {SURFACE_CHIP_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        {surface.kind === "mcp" ? (
          <>
            <TextInput
              label="Initialize URL"
              value={surface.initialize_url}
              onChange={(value: string) => patch({ initialize_url: value })}
              htmlName="initialize_url"
              isDisabled={input.busy}
            />
            <TextInput
              label="Auth kind"
              value={surface.auth_kind}
              onChange={(value: string) => patch({ auth_kind: value })}
              htmlName="auth_kind"
              isDisabled={input.busy}
            />
          </>
        ) : null}
        {surface.kind === "openapi" ? (
          <label>
            <Text type="supporting" color="secondary">
              OpenAPI JSON
            </Text>
            <textarea
              aria-label="OpenAPI JSON"
              data-testid="ops-registry-custom-spec"
              value={surface.spec_text}
              disabled={input.busy}
              onChange={(event) => patch({ spec_text: event.target.value })}
              rows={8}
              style={{ width: "100%" }}
            />
          </label>
        ) : null}
        {surface.kind === "cli" ? (
          <TextInput
            label="CLI argv"
            value={surface.argv_text}
            onChange={(value: string) => patch({ argv_text: value })}
            htmlName="argv"
            isDisabled={input.busy}
          />
        ) : null}
        <Button
          type="submit"
          label="Add"
          variant="primary"
          size="sm"
          isDisabled={input.busy}
          data-testid="ops-registry-custom-submit"
        />
      </VStack>
    </form>
  );
}

export function OpsConnectorRegistryPage() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RegistrySearchHit[]>([]);
  const [canonical, setCanonical] = useState<CanonicalConnectorRow[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyDomain, setBusyDomain] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customBusy, setCustomBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchCanonicalConnectors();
        if (!cancelled) {
          setCanonical(rows);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Registry failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void (async () => {
      try {
        const next = await searchOpsRegistry(q);
        if (!cancelled) {
          setHits(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setHits([]);
          setError(err instanceof Error ? err.message : "Search failed");
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const searchRows = useMemo(
    () => buildRegistrySearchRows(hits, canonical ?? []),
    [hits, canonical],
  );
  const liveRows = useMemo(
    () => liveCanonicalRows(canonical ?? []),
    [canonical],
  );

  async function handlePromote(domain: string) {
    setBusyDomain(domain);
    setError(null);
    try {
      await promoteRegistryDomain(domain);
      setCanonical(await fetchCanonicalConnectors());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Promote failed");
    } finally {
      setBusyDomain(null);
    }
  }

  async function handleDelete(row: CanonicalConnectorRow) {
    if (!canDeleteCanonical(row)) {
      return;
    }
    if (!window.confirm(`Delete ${row.label}?`)) {
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      await deleteCanonicalConnector(row.id);
      setCanonical(await fetchCanonicalConnectors());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCustom(draft: {
    slug: string;
    label: string;
    surface: CustomSurfaceDraft;
  }) {
    const parsed = parseCustomConnectorForm(draft);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setCustomBusy(true);
    setFormError(null);
    setError(null);
    try {
      await createCustomConnector(parsed.value);
      setCanonical(await fetchCanonicalConnectors());
      setCustomOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Custom add failed");
    } finally {
      setCustomBusy(false);
    }
  }

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={4}>
          <VStack gap={4}>
            <HStack gap={4} align="center">
              <Text type="body" weight="semibold" data-testid="ops-registry-page">
                Registry
              </Text>
              <Button
                type="button"
                label="Add custom"
                variant="secondary"
                size="sm"
                data-testid="ops-registry-add-custom"
                onClick={() => {
                  setCustomOpen((open) => !open);
                  setFormError(null);
                }}
              />
            </HStack>
            {error ? (
              <div data-testid="ops-registry-error" role="alert">
                <Banner status="error" title={error} container="section" />
              </div>
            ) : null}
            {formError ? (
              <div data-testid="ops-registry-form-error" role="alert">
                <Banner status="error" title={formError} container="section" />
              </div>
            ) : null}
            <HStack gap={4} align="start">
              <div style={{ flex: 1, minWidth: 0 }}>
                <VStack gap={3}>
                  <div data-testid="ops-registry-search">
                    <TextInput
                      label="Search"
                      value={query}
                      onChange={setQuery}
                      htmlName="registry-search"
                    />
                  </div>
                  {searching ? (
                    <Spinner label="Searching…" size="sm" />
                  ) : null}
                  {query.trim() && searchRows.length === 0 && !searching ? (
                    <EmptyState title="No results" />
                  ) : null}
                  {searchRows.length > 0 ? (
                    <div
                      data-testid="ops-registry-results"
                      style={{
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        background: "var(--color-background-surface)",
                      }}
                    >
                      <List hasDividers>
                        {searchRows.map((row) => (
                          <ListItem
                            key={row.domain}
                            label={row.name}
                            startContent={<LogoTile label={row.name} />}
                            description={<KindChips kinds={row.kinds} />}
                            data-testid={`ops-registry-hit-${row.domain}`}
                            endContent={
                              busyDomain === row.domain ? (
                                <Spinner
                                  label={`Promoting ${row.name}…`}
                                  size="sm"
                                />
                              ) : row.action.kind === "on_registry" ? (
                                <Text
                                  type="supporting"
                                  color="secondary"
                                  data-testid={`ops-registry-on-registry-${row.domain}`}
                                >
                                  On registry
                                </Text>
                              ) : (
                                <Button
                                  type="button"
                                  label="Promote"
                                  variant="secondary"
                                  size="sm"
                                  data-testid={`ops-registry-promote-${row.domain}`}
                                  onClick={() => {
                                    void handlePromote(row.domain);
                                  }}
                                />
                              )
                            }
                          />
                        ))}
                      </List>
                    </div>
                  ) : null}
                  {canonical && liveRows.length === 0 ? (
                    <EmptyState title="No connectors" />
                  ) : null}
                  {liveRows.length > 0 ? (
                    <div data-testid="ops-registry-canonical">
                      <Table aria-label="Canonical connectors" density="balanced">
                        <TableHeader>
                          <TableRow>
                            <TableHeaderCell>Connector</TableHeaderCell>
                            <TableHeaderCell>Domain</TableHeaderCell>
                            <TableHeaderCell>Source</TableHeaderCell>
                            <TableHeaderCell>Tenants</TableHeaderCell>
                            <TableHeaderCell> </TableHeaderCell>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {liveRows.map((row) => {
                            const deletable = canDeleteCanonical(row);
                            return (
                              <TableRow
                                key={row.id}
                                data-testid={`ops-registry-row-${row.id}`}
                              >
                                <TableCell>
                                  <HStack gap={2} align="center">
                                    <LogoTile label={row.label} />
                                    <Text type="body">{row.label}</Text>
                                  </HStack>
                                </TableCell>
                                <TableCell>
                                  <Text type="supporting" color="secondary">
                                    {row.domain ?? "—"}
                                  </Text>
                                </TableCell>
                                <TableCell>
                                  <Text type="supporting" color="secondary">
                                    {row.source || "—"}
                                  </Text>
                                </TableCell>
                                <TableCell>
                                  <Text
                                    type="supporting"
                                    data-testid={`ops-registry-onboarded-${row.id}`}
                                  >
                                    {row.onboarded_tenant_count}
                                  </Text>
                                </TableCell>
                                <TableCell>
                                  {busyId === row.id ? (
                                    <Spinner
                                      label={`Deleting ${row.label}…`}
                                      size="sm"
                                    />
                                  ) : (
                                    <Button
                                      type="button"
                                      label="Delete"
                                      variant="secondary"
                                      size="sm"
                                      isDisabled={!deletable}
                                      data-testid={`ops-registry-delete-${row.id}`}
                                      onClick={() => {
                                        void handleDelete(row);
                                      }}
                                    />
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </VStack>
              </div>
              {customOpen ? (
                <CustomConnectorForm
                  busy={customBusy}
                  onSubmit={(draft) => {
                    void handleCustom(draft);
                  }}
                />
              ) : null}
            </HStack>
          </VStack>
        </LayoutContent>
      }
    />
  );
}

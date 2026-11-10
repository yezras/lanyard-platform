import { useCallback, useEffect, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { OpsTenantSummary } from "../../api/opsAdmin.js";
import {
  deleteOpsSecret,
  fetchOpsSecrets,
  putOpsSecret,
  type OpsSecretSlotRow,
} from "../../api/opsSecrets.js";

function slotLabel(row: OpsSecretSlotRow): string {
  return row.slot.kind === "env_key" ? row.slot_id : `${row.slot_id} (OAuth)`;
}

type OpsSecretsPageProps = {
  tenant: OpsTenantSummary;
};

/**
 * Class B provider model keys for the shell tenant. Class C paste lives on
 * connector detail, never here.
 */
export function OpsSecretsPage({ tenant }: OpsSecretsPageProps) {
  const [rows, setRows] = useState<OpsSecretSlotRow[] | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);

  const loadRows = useCallback(async (id: string) => {
    try {
      const next = await fetchOpsSecrets(id);
      setRows(next);
      setError(null);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Failed to load secrets");
    }
  }, []);

  useEffect(() => {
    setRows(null);
    setDraftValues({});
    setError(null);
    void loadRows(tenant.tenant_id);
  }, [tenant.tenant_id, loadRows]);

  async function handleSave(slotId: string) {
    const value = draftValues[slotId]?.trim();
    if (!value) return;
    setBusySlot(slotId);
    setError(null);
    try {
      await putOpsSecret({ tenantId: tenant.tenant_id, slotId, value });
      setDraftValues((prev) => ({ ...prev, [slotId]: "" }));
      await loadRows(tenant.tenant_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Secret save failed");
    } finally {
      setBusySlot(null);
    }
  }

  async function handleDelete(slotId: string) {
    setBusySlot(slotId);
    setError(null);
    try {
      await deleteOpsSecret({ tenantId: tenant.tenant_id, slotId });
      await loadRows(tenant.tenant_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Secret delete failed");
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={4}>
          <VStack gap={4}>
            <Text type="body" weight="semibold" data-testid="ops-secrets-page">
              Provider secrets
            </Text>
            {error ? (
              <Text
                type="body"
                color="secondary"
                role="alert"
                data-testid="ops-secrets-error"
              >
                {error}
              </Text>
            ) : null}
            <VStack gap={2}>
              {(rows ?? []).map((row) => (
                <HStack key={row.slot_id} gap={3} align="center">
                  <span data-testid={`ops-secret-slot-${row.slot_id}`}>
                    <Badge
                      label={slotLabel(row)}
                      variant={row.present ? "success" : "neutral"}
                    />
                  </span>
                  <Text type="supporting" color="secondary">
                    {row.present
                      ? `set · ${row.fingerprint ?? "fingerprint n/a"}${
                          row.rotated_at ? ` · ${row.rotated_at}` : ""
                        }`
                      : "not set"}
                  </Text>
                  <TextInput
                    label={`${row.slot_id} value`}
                    isLabelHidden
                    value={draftValues[row.slot_id] ?? ""}
                    onChange={(next) =>
                      setDraftValues((prev) => ({
                        ...prev,
                        [row.slot_id]: next,
                      }))
                    }
                    placeholder={row.present ? "Replace value…" : "Paste value…"}
                    isDisabled={busySlot === row.slot_id}
                    htmlName={`ops-secret-${row.slot_id}`}
                    data-testid={`ops-secret-input-${row.slot_id}`}
                  />
                  <Button
                    type="button"
                    label={row.present ? "Rotate" : "Set"}
                    size="sm"
                    isLoading={busySlot === row.slot_id}
                    isDisabled={!draftValues[row.slot_id]?.trim()}
                    onClick={() => void handleSave(row.slot_id)}
                    data-testid={`ops-secret-save-${row.slot_id}`}
                  />
                  {row.present ? (
                    <Button
                      type="button"
                      label="Delete"
                      variant="secondary"
                      size="sm"
                      isLoading={busySlot === row.slot_id}
                      onClick={() => void handleDelete(row.slot_id)}
                      data-testid={`ops-secret-delete-${row.slot_id}`}
                    />
                  ) : null}
                </HStack>
              ))}
            </VStack>
          </VStack>
        </LayoutContent>
      }
    />
  );
}

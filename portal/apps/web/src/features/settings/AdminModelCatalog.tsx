/**
 * Admin model keys. Provider and model lists come from LiteLLM's catalog.
 */

import { useEffect, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { apiFetch } from "../../api/client.js";

type SavedModel = {
  id: string;
  provider: string;
  name: string;
  last4: string;
};

type LiteModel = {
  id: string;
  name: string;
};

function isSavedModel(value: unknown): value is SavedModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<SavedModel>;
  return (
    typeof model.id === "string" &&
    typeof model.provider === "string" &&
    typeof model.name === "string" &&
    typeof model.last4 === "string"
  );
}

function isLiteModel(value: unknown): value is LiteModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<LiteModel>;
  return typeof model.id === "string" && typeof model.name === "string";
}

async function errorMessage(response: Response, fallback: string, secret = ""): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  const message = body.error || fallback;
  if (secret && message.includes(secret)) return fallback;
  return message;
}

export function AdminModelCatalog({ isAdmin }: { isAdmin: boolean }) {
  const [providers, setProviders] = useState<string[]>([]);
  const [provider, setProvider] = useState("");
  const [models, setModels] = useState<LiteModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState<SavedModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void Promise.all([
      apiFetch("/api/settings/litellm-providers"),
      apiFetch("/api/settings/model-keys"),
    ])
      .then(async ([providersResponse, savedResponse]) => {
        if (!providersResponse.ok || !savedResponse.ok) throw new Error("load");
        const providersBody = (await providersResponse.json()) as { providers?: unknown };
        const savedBody = (await savedResponse.json()) as { models?: unknown };
        if (cancelled) return;
        setProviders(
          Array.isArray(providersBody.providers)
            ? providersBody.providers.filter((item): item is string => typeof item === "string")
            : [],
        );
        setSaved(Array.isArray(savedBody.models) ? savedBody.models.filter(isSavedModel) : []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load models");
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !provider) {
      setModels([]);
      setModelId("");
      return;
    }
    let cancelled = false;
    setModels([]);
    setModelId("");
    void apiFetch(`/api/settings/litellm-models?provider=${encodeURIComponent(provider)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("models");
        const body = (await response.json()) as { models?: unknown };
        const next = Array.isArray(body.models) ? body.models.filter(isLiteModel) : [];
        if (!cancelled) setModels(next);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load models");
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, provider]);

  if (!isAdmin) return null;

  async function save() {
    const secret = apiKey.trim();
    if (!provider || !modelId || !secret) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/api/settings/model-keys", {
        method: "POST",
        body: JSON.stringify({ provider, model: modelId, api_key: secret }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, "Could not save API key", secret));
        return;
      }
      const body = (await response.json()) as { model?: unknown };
      if (!isSavedModel(body.model)) {
        setError("Could not save API key");
        return;
      }
      setSaved((current) => [...current.filter((model) => model.id !== body.model!.id), body.model as SavedModel]);
      setApiKey("");
    } catch {
      setError("Could not save API key");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/settings/model-keys/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await errorMessage(response, "Could not remove model"));
        return;
      }
      const body = (await response.json()) as { models?: unknown };
      setSaved(Array.isArray(body.models) ? body.models.filter(isSavedModel) : []);
    } catch {
      setError("Could not remove model");
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={4} data-testid="admin-model-catalog">
      {error ? (
        <Text type="supporting" color="secondary" role="alert" data-testid="admin-model-key-error">
          {error}
        </Text>
      ) : null}
      <FormLayout>
        <Selector
          label="Provider"
          placeholder="Provider"
          value={provider}
          onChange={(next) => setProvider(next ?? "")}
          options={providers.map((name) => ({ value: name, label: name }))}
          isDisabled={busy || providers.length === 0}
          data-testid="admin-provider-select"
          placement="below"
        />
        <Selector
          label="Model"
          placeholder="Model"
          value={modelId}
          onChange={(next) => setModelId(next ?? "")}
          options={models.map((model) => ({ value: model.id, label: model.name }))}
          isDisabled={busy || !provider || models.length === 0}
          data-testid="admin-model-select"
          placement="below"
        />
        <TextInput
          label="API key"
          type="password"
          value={apiKey}
          isDisabled={busy}
          onChange={setApiKey}
          htmlName="provider-api-key"
          data-testid="admin-provider-key-input"
        />
        <Button
          type="button"
          label="Save"
          isLoading={busy}
          isDisabled={!provider || !modelId || !apiKey.trim()}
          onClick={() => void save()}
          data-testid="admin-provider-key-save"
        />
      </FormLayout>
      {saved.map((model) => (
        <HStack key={model.id} gap={2} align="center" data-testid={`admin-saved-model-${model.id}`}>
          <Text type="body">{model.provider}</Text>
          <Text type="body">{model.name}</Text>
          <Text type="supporting">{`••••${model.last4}`}</Text>
          <Button
            type="button"
            label="Remove"
            variant="secondary"
            size="sm"
            isDisabled={busy}
            onClick={() => void remove(model.id)}
          />
        </HStack>
      ))}
    </VStack>
  );
}

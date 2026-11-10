import { createSerializationAdapter } from "@tanstack/react-router";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { ApiError, deserializeApiError } from "@lanyard/shared";
import type { SerializedApiError } from "@lanyard/shared";

const apiErrorAdapter = createSerializationAdapter({
  key: "lanyard-api-error",
  test: (value: unknown): value is ApiError => value instanceof ApiError,
  toSerializable: ({ code, message }) => ({ code, message }),
  fromSerializable: (value: SerializedApiError) => deserializeApiError(value),
});

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  serializationAdapters: [apiErrorAdapter],
}));

/**
 * lp-hdzm.25 — OpenAPI fixture used by the fromSpec adapter tests.
 *
 * Mirrors the Stripe surface inlined by the promote compiler: JSON GETs
 * plus unsupported OPTIONS / multipart so skip reasons are real.
 */
export const STRIPE_OPENAPI_FIXTURE = {
  openapi: "3.0.0",
  info: { title: "Stripe", version: "1" },
  servers: [{ url: "https://api.stripe.com" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      apiKey: { type: "apiKey", in: "header", name: "Authorization" },
    },
    schemas: {
      Customer: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string" },
        },
      },
    },
    parameters: {
      Limit: {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer" },
      },
    },
  },
  paths: {
    "/v1/customers": {
      get: {
        operationId: "GetCustomers",
        summary: "List customers",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          {
            name: "api_key",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "Authorization",
            in: "header",
            schema: { type: "string" },
          },
        ],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Customer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      options: {
        operationId: "OptionsCustomers",
        summary: "CORS preflight",
        responses: { "204": { description: "empty" } },
      },
    },
    "/v1/customers/{customer}": {
      get: {
        operationId: "GetCustomer",
        summary: "Retrieve a customer",
        parameters: [
          {
            name: "customer",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Customer" },
              },
            },
          },
        },
      },
    },
    "/v1/account": {
      get: {
        operationId: "GetAccount",
        summary: "Retrieve account",
        responses: {
          "200": { description: "ok" },
        },
      },
    },
    "/v1/files": {
      post: {
        operationId: "PostFiles",
        summary: "Upload a file",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  },
} as const;

export function openApiSpecOverCap(count: number) {
  const paths: Record<string, unknown> = {};
  for (let i = 1; i <= count; i += 1) {
    paths[`/v1/items/${i}`] = {
      get: {
        operationId: `GetItem${i}`,
        summary: `Get item ${i}`,
        responses: { "200": { description: "ok" } },
      },
    };
  }
  return {
    openapi: "3.0.0",
    info: { title: "Over cap", version: "1" },
    servers: [{ url: "https://api.example.test" }],
    paths,
  };
}

/**
 * Add-connector catalog seed (lp-2qs.8.2).
 *
 * ~50 common integrations.sh-style domains the admin console can offer.
 * This is the picker source only — the main connector list stays entitled /
 * connected rows. Auth types are never flattened to OAuth-only: chips show
 * OAuth | CLI | API key | MCP, and QR marks scan-to-pair flows (ops never
 * scans; tenant admins finish those).
 */

export const ADMIN_AUTH_TYPES = ["oauth", "cli", "api_key", "mcp"] as const;
export type AdminAuthType = (typeof ADMIN_AUTH_TYPES)[number];

export const ADMIN_AUTH_CHIP_LABELS: Record<AdminAuthType, string> = {
  oauth: "OAuth",
  cli: "CLI",
  api_key: "API key",
  mcp: "MCP",
};

export type AdminCatalogEntry = {
  id: string;
  label: string;
  auth: AdminAuthType;
  /** Scan-to-pair (WhatsApp-style). Tenant admin finishes; ops never scans. */
  qr?: boolean;
};

export const ADMIN_CONNECTOR_CATALOG: readonly AdminCatalogEntry[] = [
  { id: "google", label: "Google", auth: "oauth" },
  { id: "hubspot", label: "HubSpot", auth: "oauth" },
  { id: "whatsapp", label: "WhatsApp", auth: "oauth", qr: true },
  { id: "slack", label: "Slack", auth: "mcp" },
  { id: "github", label: "GitHub", auth: "cli" },
  { id: "notion", label: "Notion", auth: "oauth" },
  { id: "linear", label: "Linear", auth: "api_key" },
  { id: "postgres", label: "Postgres", auth: "mcp" },
  { id: "stripe", label: "Stripe", auth: "api_key" },
  { id: "jira", label: "Jira", auth: "oauth" },
  { id: "gmail", label: "Gmail", auth: "oauth" },
  { id: "gdrive", label: "Google Drive", auth: "oauth" },
  { id: "gcalendar", label: "Google Calendar", auth: "oauth" },
  { id: "gdocs", label: "Google Docs", auth: "oauth" },
  { id: "gsheets", label: "Google Sheets", auth: "oauth" },
  { id: "salesforce", label: "Salesforce", auth: "oauth" },
  { id: "zendesk", label: "Zendesk", auth: "api_key" },
  { id: "intercom", label: "Intercom", auth: "api_key" },
  { id: "front", label: "Front", auth: "api_key" },
  { id: "helpscout", label: "Help Scout", auth: "api_key" },
  { id: "asana", label: "Asana", auth: "oauth" },
  { id: "trello", label: "Trello", auth: "api_key" },
  { id: "monday", label: "Monday", auth: "api_key" },
  { id: "clickup", label: "ClickUp", auth: "api_key" },
  { id: "height", label: "Height", auth: "api_key" },
  { id: "confluence", label: "Confluence", auth: "oauth" },
  { id: "bitbucket", label: "Bitbucket", auth: "cli" },
  { id: "gitlab", label: "GitLab", auth: "cli" },
  { id: "npm", label: "npm", auth: "cli" },
  { id: "pypi", label: "PyPI", auth: "cli" },
  { id: "docker", label: "Docker Hub", auth: "cli" },
  { id: "terraform-cloud", label: "Terraform Cloud", auth: "api_key" },
  { id: "aws", label: "AWS", auth: "cli" },
  { id: "gcp", label: "Google Cloud", auth: "cli" },
  { id: "azure", label: "Azure", auth: "cli" },
  { id: "vercel", label: "Vercel", auth: "api_key" },
  { id: "netlify", label: "Netlify", auth: "api_key" },
  { id: "cloudflare", label: "Cloudflare", auth: "api_key" },
  { id: "datadog", label: "Datadog", auth: "api_key" },
  { id: "pagerduty", label: "PagerDuty", auth: "api_key" },
  { id: "sentry", label: "Sentry", auth: "api_key" },
  { id: "grafana", label: "Grafana", auth: "mcp" },
  { id: "prometheus", label: "Prometheus", auth: "mcp" },
  { id: "airtable", label: "Airtable", auth: "api_key" },
  { id: "mailchimp", label: "Mailchimp", auth: "oauth" },
  { id: "sendgrid", label: "SendGrid", auth: "api_key" },
  { id: "twilio", label: "Twilio", auth: "api_key" },
  { id: "shopify", label: "Shopify", auth: "oauth" },
  { id: "quickbooks", label: "QuickBooks", auth: "oauth" },
  { id: "xero", label: "Xero", auth: "oauth" },
] as const;

export function findAdminCatalogEntry(
  id: string,
): AdminCatalogEntry | undefined {
  return ADMIN_CONNECTOR_CATALOG.find((entry) => entry.id === id);
}

export function searchAdminCatalog(query: string): AdminCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...ADMIN_CONNECTOR_CATALOG];
  }
  return ADMIN_CONNECTOR_CATALOG.filter(
    (entry) =>
      entry.label.toLowerCase().includes(needle) ||
      entry.id.includes(needle),
  );
}

/** Pure formatting helpers for the ops list pages (unit-tested). */

export function formatIsoOrDash(value: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function tenantPickerLabel(tenant: {
  tenant_slug: string;
  display_name: string;
}): string {
  return `${tenant.display_name} (${tenant.tenant_slug})`;
}

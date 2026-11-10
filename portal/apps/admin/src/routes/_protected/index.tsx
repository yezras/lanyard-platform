import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";

export const Route = createFileRoute("/_protected/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={4}>
          <EmptyState
            title="No catalog to manage"
            description="Third-party services are defined in the product schema, not from this admin site."
          />
        </LayoutContent>
      }
    />
  );
}

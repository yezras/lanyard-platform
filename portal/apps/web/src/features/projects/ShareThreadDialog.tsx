import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import {
  Dialog,
  DialogHeader,
} from "@astryxdesign/core/Dialog";
import { HStack } from "@astryxdesign/core/HStack";
import {
  Layout,
  LayoutContent,
  LayoutFooter,
} from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";

import {
  createChatThreadShare,
  listChatThreadShares,
  listOrgMembers,
  revokeChatThreadShare,
} from "../../api/sessionShares.js";
import type {
  OrgMember,
  SessionShareGrant,
  SessionShareMode,
} from "../../api/types.js";

export type ShareThreadDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
  threadTitle?: string;
};

function modeLabel(mode: SessionShareMode): string {
  return mode === "collaborate" ? "Collaborate" : "Read";
}

/**
 * Owner-only dialog: list/revoke active grants and invite same-org members
 * (read or collaborate). Stays open after a successful share so multiple
 * members can be invited in one session.
 */
export function ShareThreadDialog({
  isOpen,
  onOpenChange,
  threadId,
  threadTitle,
}: ShareThreadDialogProps) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersStatus, setMembersStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [membersError, setMembersError] = useState<string | null>(null);
  const [grants, setGrants] = useState<SessionShareGrant[]>([]);
  const [grantsStatus, setGrantsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionShareMode>("read");
  const [isSharing, setIsSharing] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFilter("");
    setSelectedEmail(null);
    setMode("read");
    setIsSharing(false);
    setRevokingUserId(null);
    setShareError(null);
    setSuccessMessage(null);
    setMembersError(null);
    setGrantsError(null);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetForm();
      setMembers([]);
      setMembersStatus("idle");
      setGrants([]);
      setGrantsStatus("idle");
    }
    onOpenChange(open);
  };

  const refreshGrants = useCallback(async () => {
    if (!threadId) {
      return;
    }
    setGrantsStatus("loading");
    setGrantsError(null);
    try {
      const list = await listChatThreadShares(threadId);
      setGrants(list.filter((g) => g.revoked_at == null));
      setGrantsStatus("ready");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load shares";
      setGrantsError(message);
      setGrantsStatus("error");
    }
  }, [threadId]);

  useEffect(() => {
    if (!isOpen || !threadId) {
      return;
    }
    let cancelled = false;
    setMembersStatus("loading");
    setMembersError(null);
    setGrantsStatus("loading");
    setGrantsError(null);

    void listOrgMembers()
      .then((memberList) => {
        if (cancelled) {
          return;
        }
        setMembers(memberList);
        setMembersStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to load org members";
        setMembersError(message);
        setMembersStatus("error");
      });

    void listChatThreadShares(threadId)
      .then((grantList) => {
        if (cancelled) {
          return;
        }
        setGrants(grantList.filter((g) => g.revoked_at == null));
        setGrantsStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to load shares";
        setGrantsError(message);
        setGrantsStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, threadId]);

  const emailByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      map.set(m.user_id, m.email);
    }
    return map;
  }, [members]);

  const activeGranteeIds = useMemo(
    () => new Set(grants.map((g) => g.grantee_user_id)),
    [grants],
  );

  const filteredMembers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return members.filter((m) => {
      // Hide members who already have an active grant.
      if (activeGranteeIds.has(m.user_id)) {
        return false;
      }
      if (!q) {
        return true;
      }
      return m.email.toLowerCase().includes(q);
    });
  }, [filter, members, activeGranteeIds]);

  const handleShare = async () => {
    if (!selectedEmail) {
      setShareError("Select an org member to share with");
      return;
    }
    setIsSharing(true);
    setShareError(null);
    setSuccessMessage(null);
    try {
      await createChatThreadShare({
        threadId,
        granteeEmail: selectedEmail,
        mode,
      });
      setSuccessMessage(
        `Shared with ${selectedEmail} (${modeLabel(mode)})`,
      );
      setSelectedEmail(null);
      await refreshGrants();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create share";
      setShareError(message);
    } finally {
      setIsSharing(false);
    }
  };

  const handleRevoke = async (granteeUserId: string) => {
    setRevokingUserId(granteeUserId);
    setShareError(null);
    setSuccessMessage(null);
    try {
      await revokeChatThreadShare({ threadId, granteeUserId });
      const email = emailByUserId.get(granteeUserId);
      setSuccessMessage(
        email ? `Revoked access for ${email}` : "Access revoked",
      );
      // Optimistic remove, then refresh to stay in sync with API.
      setGrants((prev) =>
        prev.filter((g) => g.grantee_user_id !== granteeUserId),
      );
      await refreshGrants();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to revoke share";
      setShareError(message);
    } finally {
      setRevokingUserId(null);
    }
  };

  const subtitle = threadTitle
    ? `Share “${threadTitle}” with someone in your organization`
    : "Share this chat with someone in your organization";

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      purpose="form"
      width={440}
    >
      <Layout
        header={
          <DialogHeader
            title="Share chat"
            subtitle={subtitle}
            onOpenChange={handleOpenChange}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={4}>
              {grantsStatus === "loading" && grants.length === 0 ? (
                <HStack gap={2} align="center">
                  <Spinner size="sm" />
                  <Text type="supporting" color="secondary">
                    Loading people with access…
                  </Text>
                </HStack>
              ) : null}

              {grantsStatus === "error" && grantsError ? (
                <Text type="supporting" color="secondary" role="alert">
                  {grantsError}
                </Text>
              ) : null}

              {grantsStatus === "ready" || grants.length > 0 ? (
                <List
                  density="compact"
                  header={
                    <Text type="supporting" color="secondary">
                      People with access
                    </Text>
                  }
                >
                  {grants.length === 0 ? (
                    <ListItem
                      label="No one else has access yet"
                      isDisabled
                    />
                  ) : (
                    grants.map((grant) => {
                      const email =
                        emailByUserId.get(grant.grantee_user_id) ??
                        grant.grantee_user_id;
                      const isRevoking =
                        revokingUserId === grant.grantee_user_id;
                      return (
                        <ListItem
                          key={grant.grant_id}
                          label={email}
                          description={modeLabel(grant.mode)}
                          endContent={
                            <Button
                              label="Revoke"
                              variant="secondary"
                              size="sm"
                              isLoading={isRevoking}
                              isDisabled={
                                revokingUserId !== null && !isRevoking
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleRevoke(grant.grantee_user_id);
                              }}
                            />
                          }
                        />
                      );
                    })
                  )}
                </List>
              ) : null}

              <SegmentedControl
                label="Access mode"
                value={mode}
                onChange={(value) => setMode(value as SessionShareMode)}
                size="sm"
                layout="fill"
              >
                <SegmentedControlItem value="read" label="Read" />
                <SegmentedControlItem
                  value="collaborate"
                  label="Collaborate"
                />
              </SegmentedControl>

              <TextInput
                label="Filter members"
                value={filter}
                onChange={setFilter}
                placeholder="Search by email"
              />

              {membersStatus === "loading" ? (
                <HStack gap={2} align="center">
                  <Spinner size="sm" />
                  <Text type="supporting" color="secondary">
                    Loading org members…
                  </Text>
                </HStack>
              ) : null}

              {membersStatus === "error" && membersError ? (
                <Text type="supporting" color="secondary" role="alert">
                  {membersError}
                </Text>
              ) : null}

              {membersStatus === "ready" && filteredMembers.length === 0 ? (
                <Text type="supporting" color="secondary">
                  {members.length === 0
                    ? "No other org members to share with."
                    : activeGranteeIds.size > 0 &&
                        members.every((m) => activeGranteeIds.has(m.user_id))
                      ? "Everyone in your org already has access."
                      : "No members match that filter."}
                </Text>
              ) : null}

              {membersStatus === "ready" && filteredMembers.length > 0 ? (
                <List
                  density="compact"
                  header={
                    <Text type="supporting" color="secondary">
                      Organization members
                    </Text>
                  }
                >
                  {filteredMembers.map((member) => (
                    <ListItem
                      key={member.user_id}
                      label={member.email}
                      isSelected={selectedEmail === member.email}
                      onClick={() => {
                        setSelectedEmail(member.email);
                        setShareError(null);
                        setSuccessMessage(null);
                      }}
                    />
                  ))}
                </List>
              ) : null}

              {shareError ? (
                <Text type="supporting" color="secondary" role="alert">
                  {shareError}
                </Text>
              ) : null}

              {successMessage ? (
                <Text type="supporting" color="secondary" role="status">
                  {successMessage}
                </Text>
              ) : null}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button
                label="Done"
                variant="secondary"
                size="sm"
                onClick={() => handleOpenChange(false)}
              />
              <Button
                label="Share"
                variant="primary"
                size="sm"
                isLoading={isSharing}
                isDisabled={!selectedEmail || membersStatus !== "ready"}
                onClick={() => void handleShare()}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

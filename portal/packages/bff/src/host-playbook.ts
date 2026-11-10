/**
 * Host playbook for inbound spine (lp-k5c4.21).
 *
 * Short page, not an OpenAPI dump. Lists host-owned tools and when to use them.
 * Injected on every harness turn (1:1 and group). Model never POSTs /api/*.
 *
 * Tools are the contract; the host enqueues. Inbound spine is the request log.
 */

export const HOST_PLAYBOOK = `You have host tools, not HTTP. Use the tool that matches the job. Do not call mailbox.send on every turn.

- Search, research, Palantir/Databricks/AWS, current facts → web_search (or spawn_subagent). Do the work yourself. Do not mailbox.send another agent to search for you.
- Recurring ping / cron / "every N minutes" → scheduled_task. Do not mailbox.send Atlas (or anyone) to create a job.
- Nested research helpers → spawn_subagent.
- Message a teammate only when you need them as a person, not as a proxy for your own tools → mailbox.send {to, text}. Host fills room. Skip it if you can answer or act with web_search / scheduled_task / spawn_subagent.
- In a shared channel, @Name or @here asks a teammate in that room and they reply there. mailbox.send to their 1:1 only when you are not already together.
- Invite to a channel → channel.add_member.
- Workflow → workflow.create.

There is no mailbox.receive tool. Inbound mail is a wake in that agent's room, not a fetch. Recursion stays fused: hop cap ≤8 consecutive a2a, 40/room/hour. Halt freezes. Never POST /api/* as Jack.` as const;

export const HOST_PLAYBOOK_TOOL_NAMES = [
  "mailbox.send",
  "channel.add_member",
  "scheduled_task.create",
  "workflow.create",
] as const;

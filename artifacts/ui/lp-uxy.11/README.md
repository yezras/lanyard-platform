# lp-uxy.11 — hard-reload multi-subagent hydrate isolation

## Symptom
Hard reload of a complex multi-subagent chat crashed / blanked the thread.
UIQA also found: multi-subagent turn with a final ```chart fence showed
`TimelineItemErrorBoundary` ("Could not display this message") before and after
reload because recharts threw Invalid hook call / useContext(null), wiping
subagent chips + tools for the whole turn.

## Fix
1. **Per-event hydrate isolation** in `historyEventsToTimelineItems` and `applyChatEvent`
   — one corrupt `tool_progress` cannot wipe the whole timeline.
2. **Truncate** oversized tool results on history load (`MAX_HISTORY_TOOL_RESULT_CHARS = 48k`).
3. **ChatTimeline** defensive render: `TimelineItemErrorBoundary` per item,
   per-tool isolation in `toChatToolCallItems`, safe segment filtering,
   `AnswerContentErrorBoundary` around final answer so chart throws cannot hide
   mid-turn subagent chips.
4. **ChartFenceErrorBoundary** around lazy PortalChartCard so recharts failures
   surface as `ChartSpecErrorCard` instead of unmounting the assistant turn.
5. **Vite/Vitest React singleton**: `resolve.dedupe` + absolute `react` /
   `react-dom` aliases so prebundled recharts shares one React dispatcher
   (root cause of Invalid hook call / useResponsiveContainerContext null).

## Evidence (unit / integration)
```
pnpm --filter @lanyard/web exec vitest run \
  src/hooks/useChatEvents.test.ts \
  src/features/chat/ChatTimeline.test.tsx \
  src/features/chat/ChatRichCodeBlock.chart-isolate.test.tsx
```

Key cases:
- `historyEventsToTimelineItems` multi-subagent + many nested tools + corrupt row
- `applyChatEvent` returns prior items when tool_progress throws
- `historyFetcher` reload does not leave empty / pending timeline
- ChatTimeline renders complex multi-subagent hydrate fixture without throw
- Single turn render failure does not blank the thread
- Multi-subagent chips remain when answer includes ```chart fence
- ChartFenceErrorBoundary isolates PortalChartCard / Invalid hook call throw

Browser QA (`needs_ui_qa=true`): hard-reload a completed multi-subagent thread
(with chart answer if available) in mocklab/dev Portal and confirm timeline
paints without blank screen / whole-turn item error; subagent chips visible.

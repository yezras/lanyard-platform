import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatEvent, ChatHistoryEvent } from "../api/types.js";

import {
  applyChatEvent,
  citationsFromSubagentToolCalls,
  citationsFromToolCalls,
  historyEventsToTimelineItems,
  isAssistantTurnOpen,
  isChatResponsePending,
  isVaultFileToolTarget,
  MAX_HISTORY_TOOL_RESULT_CHARS,
  sanitizeHistoryEventForHydrate,
  truncateHistoryToolResult,
  useChatEvents,
  type ChatTimelineAssistantTurn,
  type ChatTimelineItem,
} from "./useChatEvents.js";

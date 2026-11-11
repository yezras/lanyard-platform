import { createLogger, InvalidVaultPathError } from "@lanyard/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

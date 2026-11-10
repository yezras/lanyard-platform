import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Vendored from Evil Charts `src/lib/utils.ts` (cn only). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

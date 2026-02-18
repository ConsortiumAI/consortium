/**
 * Claude message type definitions with Zod parsers
 */

import { z } from "zod";

export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative(),
  service_tier: z.string().optional(),
}).passthrough();

export const RawJSONLinesSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
    isSidechain: z.boolean().optional(),
    isMeta: z.boolean().optional(),
    uuid: z.string(),
    message: z.object({
      content: z.union([z.string(), z.any()])
    }).passthrough()
  }).passthrough(),

  z.object({
    uuid: z.string(),
    type: z.literal("assistant"),
    message: z.object({
      usage: UsageSchema.optional(),
      model: z.string().optional(),
    }).passthrough().optional()
  }).passthrough(),

  z.object({
    type: z.literal("summary"),
    summary: z.string(),
    leafUuid: z.string()
  }).passthrough(),

  z.object({
    type: z.literal("system"),
    uuid: z.string()
  }).passthrough()
]);

export type RawJSONLines = z.infer<typeof RawJSONLinesSchema>

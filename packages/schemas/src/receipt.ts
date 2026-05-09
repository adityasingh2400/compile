import { z } from "zod";

/**
 * One observed LLM call. Substrate of the identification pipeline.
 * See DESIGN.md "Receipt logging".
 */
export const ReceiptSchema = z.object({
  call_id: z.string(),
  timestamp: z.string().datetime(),
  agent_id: z.string(),
  prompt: z.string(),
  tool_schemas: z.array(z.record(z.unknown())).default([]),
  input: z.unknown(),
  output: z.unknown(),
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  latency_ms: z.number().nonnegative(),
  model: z.string(),
  parent_task_id: z.string().optional(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/**
 * Output of the templater stage: prompts collapsed by structural diff
 * into a static wrapper + typed slots.
 */
export const TemplateSchema = z.object({
  template_id: z.string(),
  prompt_template: z.string(),
  slots: z.array(
    z.object({
      name: z.string(),
      json_schema: z.record(z.unknown()),
    }),
  ),
  tool_schemas: z.array(z.record(z.unknown())).default([]),
  receipt_ids: z.array(z.string()),
});
export type Template = z.infer<typeof TemplateSchema>;

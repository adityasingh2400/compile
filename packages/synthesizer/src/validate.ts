import {
  SynthesisEnvelopeSchema,
  type SynthesisEnvelope,
} from "@compile/schemas";

/**
 * Strict Zod validation of an agent-emitted envelope. Failure → reject and
 * return `failure_reason` to the agent; one retry is allowed before the
 * cluster goes to negative Vault.
 */
export function validateEnvelope(raw: unknown):
  | { ok: true; envelope: SynthesisEnvelope }
  | { ok: false; failure_reason: string } {
  const parsed = SynthesisEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, failure_reason: parsed.error.message };
  }
  return { ok: true, envelope: parsed.data };
}

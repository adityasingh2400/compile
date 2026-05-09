/**
 * @compile/synthesizer — assembles the SynthesisSpec sent to the customer's
 * agent via compile.request_synthesis(), and validates the SynthesisEnvelope
 * the agent returns via compile.submit_synthesis().
 *
 * Note: Compile NEVER calls a frontier LLM here (D9). The codegen happens
 * in the customer's agent context, billed to the customer's API key.
 */
export * from "./assemble.js";
export * from "./validate.js";

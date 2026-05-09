import { StubNiaClient, type INiaClient } from "./index.js";
import { RealNiaClient } from "./real-client.js";

export interface CreateNiaClientOptions {
  apiKey?: string;
  vaultId?: string;
  /** Force a specific implementation; otherwise selected from env. */
  mode?: "real" | "stub";
}

/**
 * Picks the right Nia client for the current environment.
 *
 *  - Real: NIA_API_KEY + NIA_VAULT_ID set, or both passed explicitly.
 *  - Stub: anything else. Lets local dev / CI run without a key.
 */
export function createNiaClient(opts: CreateNiaClientOptions = {}): INiaClient {
  const apiKey = opts.apiKey ?? process.env.NIA_API_KEY;
  const vaultId = opts.vaultId ?? process.env.NIA_VAULT_ID;
  const wantReal = opts.mode === "real" || (opts.mode === undefined && apiKey && vaultId);
  if (wantReal) {
    if (!apiKey) throw new Error("createNiaClient(real): missing NIA_API_KEY");
    if (!vaultId) throw new Error("createNiaClient(real): missing NIA_VAULT_ID");
    return new RealNiaClient({ apiKey, vaultId });
  }
  return new StubNiaClient();
}

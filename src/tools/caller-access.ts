/**
 * MCP tools for the Caller Access Plane (doc 50 §6.1).
 *
 * The Caller Access Plane is the policy engine that decides whether an
 * inbound caller (phone, WhatsApp, mesh agent, …) is allowed to reach a
 * business. Policies are persisted at one of three scopes — `default`,
 * `channel:{voice|whatsapp}`, or `agent:{id}` — and consist of an
 * ordered list of `AccessRule`s evaluated by the PEP. See
 * `davoxi-backend/docs/architecture/50-caller-access-plane.md`.
 *
 * # Backend HTTP contracts
 *
 * | Method | Path                                          | What it does |
 * |--------|-----------------------------------------------|--------------|
 * | GET    | `/api/businesses/{id}/access?scope=…`         | Read the current policy for a scope. |
 * | PUT    | `/api/businesses/{id}/access`                 | Replace the rule list at a scope (optimistic concurrency). |
 * | GET    | `/api/businesses/{id}/access/audit?since&limit` | Paginated audit feed. |
 *
 * The backend uses the same bearer-token auth as the rest of the MCP.
 *
 * # Hashing
 *
 * Handles (phone numbers, emails, agent ids, org ids) are NEVER sent
 * raw — they are hashed client-side via {@link hashHandle} (sha256, hex
 * encoded, first 16 hex chars) and only the hash is appended to the
 * `HandleAllowList` / `HandleDenyList` rule. This mirrors the Rust
 * `identity_graph::hash_handle` exactly so a hash authored here will
 * match what the PEP computes at ingress for the same raw handle.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ─── HTTP helper (same shape as src/tools/callers.ts) ──────────────── //

interface AccessApiOptions {
  apiKey: string;
  apiUrl: string;
}

async function accessRequest<T = unknown>(
  opts: AccessApiOptions,
  method: "GET" | "PUT" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${opts.apiUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiKey}`,
    Accept: "application/json",
  };
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(30_000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ─── Handle hashing (mirrors `identity_graph::hash_handle`) ─────────── //

/**
 * Hash a raw caller handle (E.164 phone, email, agent id, org id) into
 * the stable key used by the Caller Access Plane.
 *
 * Wire contract: `hex(sha256(raw))[:16]` — the first 16 hex characters
 * (= first 8 bytes) of the SHA-256 digest. Matches the Rust
 * `identity_graph::hash_handle` byte-for-byte so a hash authored here
 * will match what the PEP computes at ingress for the same raw handle.
 *
 * The raw handle never leaves this process — only the prefix is
 * forwarded to the backend.
 */
export function hashHandle(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
}

// ─── Wire-format zod schemas (mirror Rust serde) ───────────────────── //

const handleKindSchema = z
  .enum(["phone", "email", "agent", "org"])
  .describe("Which kind of identifier the rule's handle list applies to.");

const listModeSchema = z
  .enum(["allow", "deny"])
  .describe("Allow vs deny semantics on list-style rules.");

const attestationLevelSchema = z
  .enum(["none", "c", "b", "a"])
  .describe("STIR/SHAKEN attestation tier (None < C < B < A).");

const rlScopeSchema = z
  .enum(["per_caller", "per_org", "per_country", "per_business"])
  .describe(
    "What dimension a RateLimit counter rolls up to. `per_caller` is the most common.",
  );

const trustLevelSchema = z
  .enum([
    "anonymous",
    "phone_possession",
    "voice_confirmed",
    "knows_secret",
    "two_factor",
    "identity_verified",
    "background_checked",
  ])
  .describe(
    "Trust level the caller has presented in this session. Snake_case wire tag matching the Rust `agent_core::confirmation::TrustLevel` enum.",
  );

const trustRequirementSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("at_least"),
      level: trustLevelSchema,
    }),
    z.object({
      kind: z.literal("any"),
      levels: z.array(trustLevelSchema).min(1),
    }),
    z.object({
      kind: z.literal("all"),
      levels: z.array(trustLevelSchema).min(1),
    }),
  ])
  .describe(
    "What trust the caller must hold. Mirrors the Rust `TrustRequirement` enum (snake_case kind tag).",
  );

const timeWindowSpecSchema = z
  .object({
    days: z
      .array(z.number().int().min(0).max(6))
      .describe("Days of week: 0=Sun … 6=Sat. Empty array = any day."),
    start: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .describe("Window start, 24h `HH:MM`."),
    end: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .describe("Window end, 24h `HH:MM` (exclusive upper bound)."),
  })
  .describe(
    "One recurring time window. Mirrors `shared::models::TimeWindow`.",
  );

/**
 * `AccessRule` discriminated union — mirrors the Rust `AccessRule` enum
 * with snake_case `type` tags. Every variant on the Rust side has a
 * matching member here.
 */
const accessRuleSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("handle_allow_list"),
      handle_kind: handleKindSchema,
      hashes: z
        .array(z.string().regex(/^[0-9a-f]{16}$/))
        .describe("16-hex-char handle prefixes (output of `hashHandle`)."),
    }),
    z.object({
      type: z.literal("handle_deny_list"),
      handle_kind: handleKindSchema,
      hashes: z
        .array(z.string().regex(/^[0-9a-f]{16}$/))
        .describe("16-hex-char handle prefixes (output of `hashHandle`)."),
    }),
    z.object({
      type: z.literal("country_gate"),
      iso_codes: z
        .array(z.string().length(2))
        .describe("ISO 3166-1 alpha-2 codes, e.g. `[\"FR\",\"BE\"]`."),
      mode: listModeSchema,
      unknown_country: listModeSchema.describe(
        "What to do if the country can't be resolved.",
      ),
      min_attestation: attestationLevelSchema.optional(),
    }),
    z.object({
      type: z.literal("reputation_floor"),
      min_score: z
        .number()
        .min(-1)
        .max(1)
        .describe(
          "Minimum reputation score in `[-1.0, 1.0]`. Doc 50 default: `-0.5`.",
        ),
    }),
    z.object({
      type: z.literal("trust_uplift"),
      require: trustRequirementSchema,
    }),
    z.object({
      type: z.literal("time_window"),
      tz: z.string().describe("IANA timezone, e.g. `America/New_York`."),
      windows: z.array(timeWindowSpecSchema).min(1),
    }),
    z.object({
      type: z.literal("rate_limit"),
      window_sec: z
        .number()
        .int()
        .min(1)
        .describe("Window length in seconds (3600 = 1h rolling)."),
      max: z
        .number()
        .int()
        .min(0)
        .describe("Maximum events allowed in any rolling window."),
      scope: rlScopeSchema,
    }),
  ])
  .describe(
    "One rule in a `BusinessAccessPolicy`. The PEP evaluates rules in order and short-circuits on the first non-Allow.",
  );

const policyScopeSchema = z
  .string()
  .regex(/^(default|channel:(voice|whatsapp)|agent:[A-Za-z0-9_\-:.]+)$/)
  .describe(
    "Where the policy applies: `default` | `channel:voice` | `channel:whatsapp` | `agent:{agent_id}`.",
  );

// ─── Helpers for the higher-level convenience tools ─────────────────── //

interface PolicyResponse {
  policy: {
    business_id: string;
    scope: unknown;
    rules: AccessRule[];
    mandatory: boolean;
    updated_at: string;
    updated_by?: string;
  } | null;
}

type AccessRule = z.infer<typeof accessRuleSchema>;

/**
 * GET the current policy at a scope, returning the `updated_at` token
 * and current rule list. Used by the convenience tools that mutate one
 * rule without replacing the whole list.
 */
async function getPolicy(
  opts: AccessApiOptions,
  businessId: string,
  scope: string,
): Promise<{ rules: AccessRule[]; updated_at: string | null; mandatory: boolean }> {
  const qs = new URLSearchParams({ scope });
  const path = `/api/businesses/${encodeURIComponent(businessId)}/access?${qs.toString()}`;
  const res = await accessRequest<PolicyResponse>(opts, "GET", path);
  if (!res?.policy) {
    return { rules: [], updated_at: null, mandatory: false };
  }
  return {
    rules: res.policy.rules ?? [],
    updated_at: res.policy.updated_at,
    mandatory: res.policy.mandatory ?? false,
  };
}

/**
 * PUT a new rule list at a scope. Threads the `expected_updated_at`
 * token from the prior GET so the backend can reject racing edits.
 */
async function putPolicy(
  opts: AccessApiOptions,
  businessId: string,
  scope: string,
  rules: AccessRule[],
  mandatory: boolean,
  expectedUpdatedAt: string | null,
): Promise<{ updated_at: string }> {
  const path = `/api/businesses/${encodeURIComponent(businessId)}/access`;
  const body: Record<string, unknown> = {
    scope: parseScope(scope),
    rules,
    mandatory,
  };
  if (expectedUpdatedAt) body.expected_updated_at = expectedUpdatedAt;
  return accessRequest<{ updated_at: string }>(opts, "PUT", path, body);
}

/**
 * Parse a string scope (`default` | `channel:voice` | `agent:{id}`)
 * into the wire-format object the backend deserializes via
 * `PolicyScope` (`#[serde(tag = "kind", rename_all = "snake_case")]`).
 *
 * `channel:voice` maps to the Rust `ChannelKind::TwilioVoice` variant
 * (the canonical voice channel) and `channel:whatsapp` to
 * `ChannelKind::Whatsapp`. The inner `ChannelKind` enum has no
 * `rename_all` attribute so its variant tags serialize PascalCase by
 * default — that's the wire format the PUT body must use.
 */
function parseScope(scope: string): Record<string, unknown> {
  if (scope === "default") {
    return { kind: "default" };
  }
  if (scope.startsWith("channel:")) {
    const channel = scope.slice("channel:".length);
    const channelKind = channel === "voice" ? "TwilioVoice" : "Whatsapp";
    return { kind: "channel", channel: channelKind };
  }
  if (scope.startsWith("agent:")) {
    return { kind: "agent", agent: scope.slice("agent:".length) };
  }
  throw new Error(`Invalid scope: ${scope}`);
}

/**
 * Best-effort emit a `-0.3` reputation signal when a caller is added
 * to a deny list (per doc 50 §6.1). The Trust Plane reputation-signal
 * endpoint is still in flight — log and continue if it doesn't yet
 * exist so the deny-list write isn't blocked on it.
 */
async function emitDenyReputationSignal(
  opts: AccessApiOptions,
  handleHash: string,
): Promise<{ ok: boolean; note?: string }> {
  try {
    await accessRequest(opts, "POST", `/api/trust/reputation/signal`, {
      handle_hash: handleHash,
      delta: -0.3,
      reason: "manual_blocklist",
    });
    return { ok: true };
  } catch (err) {
    // TODO(caller-access): Trust Plane reputation-signal endpoint may
    // not be live yet. Per doc 50 §6.1 we degrade gracefully — log and
    // continue. The deny-list rule write itself succeeded, which is
    // the primary effect.
    const note = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(
      `[caller-access] reputation signal best-effort skipped: ${note}`,
    );
    return { ok: false, note };
  }
}

// ─── Tool registration ─────────────────────────────────────────────── //

export function registerCallerAccessTools(
  server: McpServer,
  apiOpts: AccessApiOptions,
): void {
  // ── set_access_policy ─────────────────────────────────────────────── //
  server.tool(
    "set_access_policy",
    `Replace the rule list at \`(business_id, scope)\` with the supplied rules. This is the canonical "author a policy from scratch" tool — for incremental edits to an existing policy prefer the convenience tools (\`add_caller_to_allowlist\`, \`add_caller_to_blocklist\`, \`set_caller_rate_limit\`).

The scope selects which Caller Access Plane policy row to write:
- \`default\` — applies to every ingress for the business.
- \`channel:voice\` / \`channel:whatsapp\` — channel-specific override.
- \`agent:{agent_id}\` — narrowest, per-agent override.

Rules are evaluated in order and the PEP short-circuits on the first non-Allow verdict. See doc 50 §3.1 for the full \`AccessRule\` DSL.

Implementation: GETs the current row to read its \`updated_at\` token, then PUTs the new rule list with that token threaded as \`expected_updated_at\` so racing edits are rejected with 409.`,
    {
      business_id: z
        .string()
        .min(1)
        .describe("Target business id."),
      scope: policyScopeSchema,
      rules: z
        .array(accessRuleSchema)
        .describe(
          "Ordered list of rules to write. Empty array = no policy (everyone allowed).",
        ),
      mandatory: z
        .boolean()
        .optional()
        .describe(
          "If true, child businesses cannot loosen this policy. Org-level only — businesses cannot set this on their own rows. Default: false.",
        ),
    },
    async ({ business_id, scope, rules, mandatory }) => {
      try {
        const current = await getPolicy(apiOpts, business_id, scope);
        const result = await putPolicy(
          apiOpts,
          business_id,
          scope,
          rules,
          mandatory ?? current.mandatory,
          current.updated_at,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { ok: true, scope, rule_count: rules.length, ...result },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error setting access policy: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── add_caller_to_allowlist ───────────────────────────────────────── //
  server.tool(
    "add_caller_to_allowlist",
    `Append one caller to a \`HandleAllowList\` rule at the requested scope. Hashes the raw \`handle_value\` client-side (sha256, first 16 hex chars) so the raw handle never leaves this process.

If no \`HandleAllowList\` rule exists yet for the given \`handle_kind\` at this scope, a new one is appended to the rule list. Otherwise the hash is added to the existing rule.

Note: an allow list is exclusive — once present, it blocks every caller of the same \`handle_kind\` who is not on the list. Use sparingly.`,
    {
      business_id: z.string().min(1).describe("Target business id."),
      scope: policyScopeSchema.optional().describe(
        "Policy scope. Defaults to `default` if omitted.",
      ),
      handle_kind: handleKindSchema,
      handle_value: z
        .string()
        .min(1)
        .describe(
          "Raw handle (E.164 phone, email, agent id, org id). Hashed client-side — NEVER sent to the backend in raw form.",
        ),
    },
    async ({ business_id, scope, handle_kind, handle_value }) => {
      const effectiveScope = scope ?? "default";
      try {
        const hash = hashHandle(handle_value);
        const current = await getPolicy(apiOpts, business_id, effectiveScope);
        const rules: AccessRule[] = [...current.rules];
        let mutated = false;
        for (let i = 0; i < rules.length; i++) {
          const r = rules[i];
          if (r.type === "handle_allow_list" && r.handle_kind === handle_kind) {
            if (!r.hashes.includes(hash)) {
              rules[i] = { ...r, hashes: [...r.hashes, hash] };
            }
            mutated = true;
            break;
          }
        }
        if (!mutated) {
          rules.push({
            type: "handle_allow_list",
            handle_kind,
            hashes: [hash],
          });
        }
        const result = await putPolicy(
          apiOpts,
          business_id,
          effectiveScope,
          rules,
          current.mandatory,
          current.updated_at,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: true,
                  scope: effectiveScope,
                  handle_kind,
                  added_hash: hash,
                  ...result,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error adding to allowlist: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── add_caller_to_blocklist ───────────────────────────────────────── //
  server.tool(
    "add_caller_to_blocklist",
    `Append one caller to a \`HandleDenyList\` rule at the requested scope, and (best-effort) emit a \`-0.3\` reputation signal so the caller drops on the Trust Plane scoreboard.

The raw \`handle_value\` is hashed client-side (sha256, first 16 hex chars) — only the hash leaves this process.

The reputation signal is best-effort: if the Trust Plane endpoint is unavailable the deny-list rule still writes successfully. The endpoint may not be live in every environment yet.`,
    {
      business_id: z.string().min(1).describe("Target business id."),
      scope: policyScopeSchema.optional().describe(
        "Policy scope. Defaults to `default` if omitted.",
      ),
      handle_kind: handleKindSchema,
      handle_value: z
        .string()
        .min(1)
        .describe(
          "Raw handle (E.164 phone, email, agent id, org id). Hashed client-side — NEVER sent to the backend in raw form.",
        ),
    },
    async ({ business_id, scope, handle_kind, handle_value }) => {
      const effectiveScope = scope ?? "default";
      try {
        const hash = hashHandle(handle_value);
        const current = await getPolicy(apiOpts, business_id, effectiveScope);
        const rules: AccessRule[] = [...current.rules];
        let mutated = false;
        for (let i = 0; i < rules.length; i++) {
          const r = rules[i];
          if (r.type === "handle_deny_list" && r.handle_kind === handle_kind) {
            if (!r.hashes.includes(hash)) {
              rules[i] = { ...r, hashes: [...r.hashes, hash] };
            }
            mutated = true;
            break;
          }
        }
        if (!mutated) {
          rules.push({
            type: "handle_deny_list",
            handle_kind,
            hashes: [hash],
          });
        }
        const result = await putPolicy(
          apiOpts,
          business_id,
          effectiveScope,
          rules,
          current.mandatory,
          current.updated_at,
        );
        const repSignal = await emitDenyReputationSignal(apiOpts, hash);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: true,
                  scope: effectiveScope,
                  handle_kind,
                  added_hash: hash,
                  reputation_signal: repSignal,
                  ...result,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error adding to blocklist: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── set_caller_rate_limit ─────────────────────────────────────────── //
  server.tool(
    "set_caller_rate_limit",
    `Convenience: replace any existing \`RateLimit\` rule at the given scope with a single new one. Use this when you just want "no more than N hits per window for this business" without authoring the full policy.

If a \`RateLimit\` rule already exists in the policy it is replaced in place; otherwise the new rule is appended.

Common shape: \`window_sec=3600, max=60, rl_scope='per_caller'\` = "60 calls per hour per caller".`,
    {
      business_id: z.string().min(1).describe("Target business id."),
      scope: policyScopeSchema.optional().describe(
        "Policy scope. Defaults to `default` if omitted.",
      ),
      window_sec: z
        .number()
        .int()
        .min(1)
        .describe("Window length in seconds (3600 = rolling 1 h)."),
      max: z
        .number()
        .int()
        .min(0)
        .describe("Maximum events allowed in any rolling window."),
      rl_scope: rlScopeSchema.describe(
        "Counter dimension: `per_caller` is most common.",
      ),
    },
    async ({ business_id, scope, window_sec, max, rl_scope }) => {
      const effectiveScope = scope ?? "default";
      try {
        const current = await getPolicy(apiOpts, business_id, effectiveScope);
        const rules: AccessRule[] = [...current.rules];
        const newRule: AccessRule = {
          type: "rate_limit",
          window_sec,
          max,
          scope: rl_scope,
        };
        const idx = rules.findIndex((r) => r.type === "rate_limit");
        if (idx >= 0) {
          rules[idx] = newRule;
        } else {
          rules.push(newRule);
        }
        const result = await putPolicy(
          apiOpts,
          business_id,
          effectiveScope,
          rules,
          current.mandatory,
          current.updated_at,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: true,
                  scope: effectiveScope,
                  rate_limit: {
                    window_sec,
                    max,
                    scope: rl_scope,
                  },
                  ...result,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error setting rate limit: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── list_blocked_callers ──────────────────────────────────────────── //
  server.tool(
    "list_blocked_callers",
    `Return every hash that appears in any \`HandleDenyList\` rule at the given scope, grouped by \`handle_kind\`.

Returns hashes only — by design we never had the raw handle, and the deny list is intentionally redacted (doc 50 §4.2: "Block reasons are a closed enum, never the matched rule body").`,
    {
      business_id: z.string().min(1).describe("Target business id."),
      scope: policyScopeSchema.optional().describe(
        "Policy scope. Defaults to `default` if omitted.",
      ),
    },
    async ({ business_id, scope }) => {
      const effectiveScope = scope ?? "default";
      try {
        const current = await getPolicy(apiOpts, business_id, effectiveScope);
        const blocked: Record<string, string[]> = {};
        let total = 0;
        for (const r of current.rules) {
          if (r.type === "handle_deny_list") {
            const bucket = blocked[r.handle_kind] ?? [];
            for (const h of r.hashes) {
              if (!bucket.includes(h)) bucket.push(h);
            }
            blocked[r.handle_kind] = bucket;
            total += r.hashes.length;
          }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  business_id,
                  scope: effectiveScope,
                  total_blocked: total,
                  by_handle_kind: blocked,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing blocked callers: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_caller_access_audit ───────────────────────────────────────── //
  server.tool(
    "get_caller_access_audit",
    `Paginated stream of \`PolicyAuditEntry\` rows for a business — one row per accept/deny decision authored by the PEP. Rows are append-only and carry the rule attribution, decision tag, and optional block reason.

Pagination: pass \`since\` (ISO 8601) for "give me everything after this timestamp", and \`limit\` for the page size. Follow the \`next_cursor\` field on the response for subsequent pages.`,
    {
      business_id: z.string().min(1).describe("Target business id."),
      since: z
        .string()
        .datetime()
        .optional()
        .describe(
          "ISO 8601 timestamp lower bound (`>=`). Omitting fetches from the start of the audit feed.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Max rows per page (default backend-decided)."),
    },
    async ({ business_id, since, limit }) => {
      try {
        const qs = new URLSearchParams();
        if (since) qs.set("since", since);
        if (limit) qs.set("limit", String(limit));
        const q = qs.toString();
        const path = `/api/businesses/${encodeURIComponent(business_id)}/access/audit${q ? `?${q}` : ""}`;
        const result = await accessRequest(apiOpts, "GET", path);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching access audit: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * DavoxiClient — HTTP client wrapping the Davoxi REST API.
 *
 * All methods return parsed JSON or throw a descriptive error.
 */

import type {
  Business,
  VoiceConfig,
  MasterConfig,
  AgentDefinition,
  UsageRecord,
  UsageSummary,
  Subscription,
  Invoice,
  UserProfile,
  ApiKey,
  ApiKeyCreated,
} from "./types.js";

export class DavoxiApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    super(`Davoxi API error ${statusCode} ${statusText}: ${body}`);
    this.name = "DavoxiApiError";
  }
}

export class DavoxiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl ?? "https://api.davoxi.com").replace(/\/+$/, "");
  }

  // ------------------------------------------------------------------ //
  //  Internal helpers                                                    //
  // ------------------------------------------------------------------ //

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
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

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new Error(
        `Network error calling Davoxi API (${method} ${path}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new DavoxiApiError(res.status, res.statusText, text);
    }

    // 204 No Content
    if (res.status === 204) {
      return undefined as unknown as T;
    }

    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `Davoxi API returned non-JSON response (${res.status}): ${text.slice(0, 200)}`,
      );
    }
  }

  // ------------------------------------------------------------------ //
  //  Businesses                                                          //
  // ------------------------------------------------------------------ //

  async listBusinesses(): Promise<Business[]> {
    return this.request<Business[]>("GET", "/businesses");
  }

  async getBusiness(id: string): Promise<Business> {
    return this.request<Business>("GET", `/businesses/${encodeURIComponent(id)}`);
  }

  async createBusiness(data: {
    name: string;
    phone_numbers?: string[];
    voice_config?: Partial<Business["voice_config"]>;
    master_config?: Partial<Business["master_config"]>;
  }): Promise<Business> {
    return this.request<Business>("POST", "/businesses", data);
  }

  async updateBusiness(
    id: string,
    data: Partial<Omit<Business, "business_id" | "created_at" | "updated_at" | "voice_config" | "master_config">> & {
      voice_config?: Partial<VoiceConfig>;
      master_config?: Partial<MasterConfig>;
    },
  ): Promise<Business> {
    return this.request<Business>(
      "PUT",
      `/businesses/${encodeURIComponent(id)}`,
      data,
    );
  }

  async deleteBusiness(id: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/businesses/${encodeURIComponent(id)}`,
    );
  }

  // ------------------------------------------------------------------ //
  //  Agents                                                              //
  // ------------------------------------------------------------------ //

  async getAgent(businessId: string, agentId: string): Promise<AgentDefinition> {
    return this.request<AgentDefinition>(
      "GET",
      `/businesses/${encodeURIComponent(businessId)}/agents/${encodeURIComponent(agentId)}`,
    );
  }

  async listAgents(businessId: string): Promise<AgentDefinition[]> {
    return this.request<AgentDefinition[]>(
      "GET",
      `/businesses/${encodeURIComponent(businessId)}/agents`,
    );
  }

  async createAgent(
    businessId: string,
    data: {
      description: string;
      system_prompt: string;
      tools?: AgentDefinition["tools"];
      knowledge_sources?: string[];
      trigger_tags?: string[];
      enabled?: boolean;
    },
  ): Promise<AgentDefinition> {
    return this.request<AgentDefinition>(
      "POST",
      `/businesses/${encodeURIComponent(businessId)}/agents`,
      data,
    );
  }

  async updateAgent(
    businessId: string,
    agentId: string,
    data: Partial<
      Omit<
        AgentDefinition,
        "business_id" | "agent_id" | "created_at" | "updated_at" | "stats"
      >
    >,
  ): Promise<AgentDefinition> {
    return this.request<AgentDefinition>(
      "PUT",
      `/businesses/${encodeURIComponent(businessId)}/agents/${encodeURIComponent(agentId)}`,
      data,
    );
  }

  async deleteAgent(businessId: string, agentId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/businesses/${encodeURIComponent(businessId)}/agents/${encodeURIComponent(agentId)}`,
    );
  }

  // ------------------------------------------------------------------ //
  //  Usage & Analytics                                                   //
  // ------------------------------------------------------------------ //

  async getUsage(): Promise<UsageRecord[]> {
    return this.request<UsageRecord[]>("GET", "/usage");
  }

  async getUsageSummary(): Promise<UsageSummary> {
    return this.request<UsageSummary>("GET", "/usage/summary");
  }

  // ------------------------------------------------------------------ //
  //  Billing                                                             //
  // ------------------------------------------------------------------ //

  async getSubscription(): Promise<Subscription> {
    return this.request<Subscription>("GET", "/billing/subscription");
  }

  async listInvoices(): Promise<Invoice[]> {
    return this.request<Invoice[]>("GET", "/billing/invoices");
  }

  // ------------------------------------------------------------------ //
  //  Users                                                               //
  // ------------------------------------------------------------------ //

  async getProfile(): Promise<UserProfile> {
    return this.request<UserProfile>("GET", "/users/me");
  }

  // ------------------------------------------------------------------ //
  //  API Keys                                                            //
  // ------------------------------------------------------------------ //

  async listApiKeys(): Promise<ApiKey[]> {
    return this.request<ApiKey[]>("GET", "/api-keys");
  }

  async createApiKey(name?: string): Promise<ApiKeyCreated> {
    return this.request<ApiKeyCreated>("POST", "/api-keys", name ? { name } : undefined);
  }

  async revokeApiKey(prefix: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/api-keys/${encodeURIComponent(prefix)}`,
    );
  }
}

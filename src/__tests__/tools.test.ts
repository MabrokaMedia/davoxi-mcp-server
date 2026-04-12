import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DavoxiClient ────────────────────────────────────────────────

function createMockClient() {
  return {
    // Businesses
    listBusinesses: vi.fn(),
    getBusiness: vi.fn(),
    createBusiness: vi.fn(),
    updateBusiness: vi.fn(),
    deleteBusiness: vi.fn(),
    // Agents
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    duplicateAgent: vi.fn(),
    // Call Logs
    listCallLogs: vi.fn(),
    getCallLog: vi.fn(),
    // Webhooks
    listWebhooks: vi.fn(),
    createWebhook: vi.fn(),
    updateWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    // Phone Numbers
    listPhoneNumbers: vi.fn(),
    // Analytics
    getUsage: vi.fn(),
    getUsageSummary: vi.fn(),
    getSubscription: vi.fn(),
    listInvoices: vi.fn(),
    // Account
    getProfile: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
  };
}

type MockClient = ReturnType<typeof createMockClient>;

// ── Mock MCP Server ──────────────────────────────────────────────────

interface RegisteredTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (params: any) => Promise<any>;
}

function createMockServer() {
  const tools: RegisteredTool[] = [];

  return {
    tool(
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (params: any) => Promise<any>,
    ) {
      tools.push({ name, description, schema, handler });
    },
    _tools: tools,
    getTool(name: string): RegisteredTool | undefined {
      return tools.find((t) => t.name === name);
    },
  };
}

type MockServer = ReturnType<typeof createMockServer>;

// ── Imports (dynamic to avoid ESM issues with mocking) ───────────────

import { registerBusinessTools } from '../tools/businesses.js';
import { registerAgentTools } from '../tools/agents.js';
import { registerAnalyticsTools } from '../tools/analytics.js';
import { registerAccountTools } from '../tools/account.js';
import { registerCallTools } from '../tools/calls.js';
import { registerWebhookTools } from '../tools/webhooks.js';
import { registerPhoneTools } from '../tools/phones.js';

// ── Tests ────────────────────────────────────────────────────────────

describe('MCP Tools', () => {
  let mockClient: MockClient;
  let server: MockServer;

  beforeEach(() => {
    mockClient = createMockClient();
    server = createMockServer();
    const getClient = () => mockClient as any;

    registerBusinessTools(server as any, getClient);
    registerAgentTools(server as any, getClient);
    registerCallTools(server as any, getClient);
    registerWebhookTools(server as any, getClient);
    registerPhoneTools(server as any, getClient);
    registerAnalyticsTools(server as any, getClient);
    registerAccountTools(server as any, getClient);
  });

  // ── Registration ─────────────────────────────────────────────────
  describe('tool registration', () => {
    it('registers all expected business tools', () => {
      const names = server._tools.map((t) => t.name);
      expect(names).toContain('list_businesses');
      expect(names).toContain('get_business');
      expect(names).toContain('create_business');
      expect(names).toContain('update_business');
      expect(names).toContain('delete_business');
    });

    it('registers all expected agent tools', () => {
      const names = server._tools.map((t) => t.name);
      expect(names).toContain('list_agents');
      expect(names).toContain('get_agent');
      expect(names).toContain('create_agent');
      expect(names).toContain('update_agent');
      expect(names).toContain('delete_agent');
      expect(names).toContain('duplicate_agent');
    });

    it('registers all expected call log tools', () => {
      const names = server._tools.map((t) => t.name);
      expect(names).toContain('list_call_logs');
      expect(names).toContain('get_call_log');
    });

    it('registers all expected webhook tools', () => {
      const names = server._tools.map((t) => t.name);
      expect(names).toContain('list_webhooks');
      expect(names).toContain('create_webhook');
      expect(names).toContain('update_webhook');
      expect(names).toContain('delete_webhook');
    });

    it('registers phone number tools', () => {
      const names = server._tools.map((t) => t.name);
      expect(names).toContain('list_phone_numbers');
    });

    it('registers all expected analytics tools', () => {
      const names = server._tools.map((t) => t.name);
      expect(names).toContain('get_usage');
      expect(names).toContain('get_usage_summary');
      expect(names).toContain('get_subscription');
      expect(names).toContain('list_invoices');
    });

    it('registers all expected account tools', () => {
      const names = server._tools.map((t) => t.name);
      expect(names).toContain('get_profile');
      expect(names).toContain('list_api_keys');
      expect(names).toContain('create_api_key');
      expect(names).toContain('revoke_api_key');
    });

    it('registers exactly 26 tools total', () => {
      expect(server._tools.length).toBe(26);
    });
  });

  // ── Business tools ───────────────────────────────────────────────
  describe('list_businesses', () => {
    it('returns businesses on success', async () => {
      const data = [{ business_id: 'biz_1', name: 'Acme' }];
      mockClient.listBusinesses.mockResolvedValue(data);

      const result = await server.getTool('list_businesses')!.handler({});

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual(data);
      expect(result.isError).toBeUndefined();
    });

    it('returns error response on failure', async () => {
      mockClient.listBusinesses.mockRejectedValue(new Error('Network error'));

      const result = await server.getTool('list_businesses')!.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('get_business', () => {
    it('returns business details on success', async () => {
      const biz = { business_id: 'biz_1', name: 'Acme' };
      mockClient.getBusiness.mockResolvedValue(biz);

      const result = await server.getTool('get_business')!.handler({
        business_id: 'biz_1',
      });

      expect(mockClient.getBusiness).toHaveBeenCalledWith('biz_1');
      expect(JSON.parse(result.content[0].text)).toEqual(biz);
    });

    it('returns error on failure', async () => {
      mockClient.getBusiness.mockRejectedValue(new Error('Not found'));

      const result = await server.getTool('get_business')!.handler({
        business_id: 'biz_bad',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Not found');
    });
  });

  describe('create_business', () => {
    it('creates a business with minimal params', async () => {
      const created = { business_id: 'biz_new', name: 'NewCo' };
      mockClient.createBusiness.mockResolvedValue(created);

      const result = await server.getTool('create_business')!.handler({
        name: 'NewCo',
      });

      expect(mockClient.createBusiness).toHaveBeenCalledWith({ name: 'NewCo' });
      expect(JSON.parse(result.content[0].text)).toEqual(created);
    });

    it('passes voice_config and master_config when provided', async () => {
      mockClient.createBusiness.mockResolvedValue({ business_id: 'biz_2' });

      await server.getTool('create_business')!.handler({
        name: 'VoiceCo',
        voice: 'alloy',
        language: 'en-US',
        personality_prompt: 'Be friendly',
        temperature: 0.7,
        max_specialists_per_turn: 3,
      });

      expect(mockClient.createBusiness).toHaveBeenCalledWith({
        name: 'VoiceCo',
        voice_config: {
          voice: 'alloy',
          language: 'en-US',
          personality_prompt: 'Be friendly',
        },
        master_config: {
          temperature: 0.7,
          max_specialists_per_turn: 3,
        },
      });
    });

    it('returns error on failure', async () => {
      mockClient.createBusiness.mockRejectedValue(new Error('Validation failed'));

      const result = await server.getTool('create_business')!.handler({
        name: 'Bad',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });
  });

  describe('update_business', () => {
    it('updates business with provided fields', async () => {
      mockClient.updateBusiness.mockResolvedValue({ business_id: 'biz_1', name: 'Updated' });

      const result = await server.getTool('update_business')!.handler({
        business_id: 'biz_1',
        name: 'Updated',
        voice: 'shimmer',
      });

      expect(mockClient.updateBusiness).toHaveBeenCalledWith('biz_1', {
        name: 'Updated',
        voice_config: { voice: 'shimmer' },
      });
      expect(result.isError).toBeUndefined();
    });

    it('returns error on failure', async () => {
      mockClient.updateBusiness.mockRejectedValue(new Error('Forbidden'));

      const result = await server.getTool('update_business')!.handler({
        business_id: 'biz_1',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('delete_business', () => {
    it('requires confirm=true to proceed', async () => {
      const result = await server.getTool('delete_business')!.handler({
        business_id: 'biz_1',
        confirm: false,
      });

      expect(result.content[0].text).toContain('not confirmed');
      expect(mockClient.deleteBusiness).not.toHaveBeenCalled();
    });

    it('deletes business when confirmed', async () => {
      mockClient.deleteBusiness.mockResolvedValue(undefined);

      const result = await server.getTool('delete_business')!.handler({
        business_id: 'biz_1',
        confirm: true,
      });

      expect(mockClient.deleteBusiness).toHaveBeenCalledWith('biz_1');
      expect(result.content[0].text).toContain('deleted successfully');
    });

    it('returns error on failure', async () => {
      mockClient.deleteBusiness.mockRejectedValue(new Error('Server error'));

      const result = await server.getTool('delete_business')!.handler({
        business_id: 'biz_1',
        confirm: true,
      });

      expect(result.isError).toBe(true);
    });
  });

  // ── Agent tools ──────────────────────────────────────────────────
  describe('list_agents', () => {
    it('returns agents for a business', async () => {
      const agents = [{ agent_id: 'ag_1', description: 'Booking agent' }];
      mockClient.listAgents.mockResolvedValue(agents);

      const result = await server.getTool('list_agents')!.handler({
        business_id: 'biz_1',
      });

      expect(mockClient.listAgents).toHaveBeenCalledWith('biz_1');
      expect(JSON.parse(result.content[0].text)).toEqual(agents);
    });

    it('returns error on failure', async () => {
      mockClient.listAgents.mockRejectedValue(new Error('Unauthorized'));

      const result = await server.getTool('list_agents')!.handler({
        business_id: 'biz_1',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('get_agent', () => {
    it('returns agent details', async () => {
      const agent = { agent_id: 'ag_1', description: 'Support' };
      mockClient.getAgent.mockResolvedValue(agent);

      const result = await server.getTool('get_agent')!.handler({
        business_id: 'biz_1',
        agent_id: 'ag_1',
      });

      expect(mockClient.getAgent).toHaveBeenCalledWith('biz_1', 'ag_1');
      expect(JSON.parse(result.content[0].text)).toEqual(agent);
    });
  });

  describe('create_agent', () => {
    it('creates an agent with required fields', async () => {
      const agent = { agent_id: 'ag_new' };
      mockClient.createAgent.mockResolvedValue(agent);

      const result = await server.getTool('create_agent')!.handler({
        business_id: 'biz_1',
        description: 'FAQ agent',
        system_prompt: 'Answer FAQs',
      });

      expect(mockClient.createAgent).toHaveBeenCalledWith('biz_1', {
        description: 'FAQ agent',
        system_prompt: 'Answer FAQs',
      });
      expect(JSON.parse(result.content[0].text)).toEqual(agent);
    });

    it('passes optional fields when provided', async () => {
      mockClient.createAgent.mockResolvedValue({ agent_id: 'ag_2' });

      await server.getTool('create_agent')!.handler({
        business_id: 'biz_1',
        description: 'Booking',
        system_prompt: 'Handle bookings',
        trigger_tags: ['book', 'appointment'],
        enabled: false,
        knowledge_sources: ['https://docs.example.com'],
      });

      expect(mockClient.createAgent).toHaveBeenCalledWith('biz_1', {
        description: 'Booking',
        system_prompt: 'Handle bookings',
        trigger_tags: ['book', 'appointment'],
        enabled: false,
        knowledge_sources: ['https://docs.example.com'],
      });
    });

    it('returns error on failure', async () => {
      mockClient.createAgent.mockRejectedValue(new Error('Bad request'));

      const result = await server.getTool('create_agent')!.handler({
        business_id: 'biz_1',
        description: 'Test',
        system_prompt: 'Test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Bad request');
    });
  });

  describe('update_agent', () => {
    it('updates agent with provided fields', async () => {
      mockClient.updateAgent.mockResolvedValue({ agent_id: 'ag_1' });

      const result = await server.getTool('update_agent')!.handler({
        business_id: 'biz_1',
        agent_id: 'ag_1',
        description: 'Updated desc',
        enabled: false,
      });

      expect(mockClient.updateAgent).toHaveBeenCalledWith('biz_1', 'ag_1', {
        description: 'Updated desc',
        enabled: false,
      });
      expect(result.isError).toBeUndefined();
    });
  });

  describe('delete_agent', () => {
    it('requires confirm=true to proceed', async () => {
      const result = await server.getTool('delete_agent')!.handler({
        business_id: 'biz_1',
        agent_id: 'ag_1',
        confirm: false,
      });

      expect(result.content[0].text).toContain('not confirmed');
      expect(result.content[0].text).toContain('enabled=false');
      expect(mockClient.deleteAgent).not.toHaveBeenCalled();
    });

    it('deletes agent when confirmed', async () => {
      mockClient.deleteAgent.mockResolvedValue(undefined);

      const result = await server.getTool('delete_agent')!.handler({
        business_id: 'biz_1',
        agent_id: 'ag_1',
        confirm: true,
      });

      expect(mockClient.deleteAgent).toHaveBeenCalledWith('biz_1', 'ag_1');
      expect(result.content[0].text).toContain('deleted successfully');
    });
  });

  describe('duplicate_agent', () => {
    it('duplicates an agent with defaults', async () => {
      const copy = { agent_id: 'ag_copy', description: 'FAQ (copy)' };
      mockClient.duplicateAgent.mockResolvedValue(copy);

      const result = await server.getTool('duplicate_agent')!.handler({
        business_id: 'biz_1',
        agent_id: 'ag_1',
      });

      expect(mockClient.duplicateAgent).toHaveBeenCalledWith('biz_1', 'ag_1', {});
      expect(JSON.parse(result.content[0].text)).toEqual(copy);
    });

    it('duplicates with custom description and enabled', async () => {
      mockClient.duplicateAgent.mockResolvedValue({ agent_id: 'ag_copy2' });

      await server.getTool('duplicate_agent')!.handler({
        business_id: 'biz_1',
        agent_id: 'ag_1',
        new_description: 'Spanish FAQ agent',
        enabled: true,
      });

      expect(mockClient.duplicateAgent).toHaveBeenCalledWith('biz_1', 'ag_1', {
        description: 'Spanish FAQ agent',
        enabled: true,
      });
    });

    it('returns error on failure', async () => {
      mockClient.duplicateAgent.mockRejectedValue(new Error('Not found'));

      const result = await server.getTool('duplicate_agent')!.handler({
        business_id: 'biz_1',
        agent_id: 'ag_bad',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Not found');
    });
  });

  // ── Call log tools ───────────────────────────────────────────────
  describe('list_call_logs', () => {
    it('returns paginated call logs', async () => {
      const data = {
        calls: [{ call_id: 'call_1', status: 'completed' }],
        next_cursor: 'abc',
      };
      mockClient.listCallLogs.mockResolvedValue(data);

      const result = await server.getTool('list_call_logs')!.handler({
        business_id: 'biz_1',
        start_date: '2026-01-01',
        status: 'completed',
        limit: 10,
      });

      expect(mockClient.listCallLogs).toHaveBeenCalledWith('biz_1', {
        start_date: '2026-01-01',
        end_date: undefined,
        status: 'completed',
        agent_id: undefined,
        limit: 10,
        cursor: undefined,
      });
      expect(JSON.parse(result.content[0].text)).toEqual(data);
    });

    it('returns error on failure', async () => {
      mockClient.listCallLogs.mockRejectedValue(new Error('Forbidden'));

      const result = await server.getTool('list_call_logs')!.handler({
        business_id: 'biz_1',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('get_call_log', () => {
    it('returns call details', async () => {
      const call = { call_id: 'call_1', duration_seconds: 120, status: 'completed' };
      mockClient.getCallLog.mockResolvedValue(call);

      const result = await server.getTool('get_call_log')!.handler({
        business_id: 'biz_1',
        call_id: 'call_1',
      });

      expect(mockClient.getCallLog).toHaveBeenCalledWith('biz_1', 'call_1');
      expect(JSON.parse(result.content[0].text)).toEqual(call);
    });
  });

  // ── Webhook tools ────────────────────────────────────────────────
  describe('list_webhooks', () => {
    it('returns webhooks for a business', async () => {
      const hooks = [{ webhook_id: 'wh_1', url: 'https://example.com/hook' }];
      mockClient.listWebhooks.mockResolvedValue(hooks);

      const result = await server.getTool('list_webhooks')!.handler({
        business_id: 'biz_1',
      });

      expect(mockClient.listWebhooks).toHaveBeenCalledWith('biz_1');
      expect(JSON.parse(result.content[0].text)).toEqual(hooks);
    });
  });

  describe('create_webhook', () => {
    it('creates a webhook', async () => {
      const hook = { webhook_id: 'wh_new', url: 'https://example.com/hook' };
      mockClient.createWebhook.mockResolvedValue(hook);

      const result = await server.getTool('create_webhook')!.handler({
        business_id: 'biz_1',
        url: 'https://example.com/hook',
        events: ['call.completed', 'call.missed'],
      });

      expect(mockClient.createWebhook).toHaveBeenCalledWith('biz_1', {
        url: 'https://example.com/hook',
        events: ['call.completed', 'call.missed'],
        enabled: undefined,
      });
      expect(JSON.parse(result.content[0].text)).toEqual(hook);
    });

    it('returns error on failure', async () => {
      mockClient.createWebhook.mockRejectedValue(new Error('Invalid URL'));

      const result = await server.getTool('create_webhook')!.handler({
        business_id: 'biz_1',
        url: 'not-a-url',
        events: ['call.completed'],
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('update_webhook', () => {
    it('updates a webhook', async () => {
      const hook = { webhook_id: 'wh_1', enabled: false };
      mockClient.updateWebhook.mockResolvedValue(hook);

      const result = await server.getTool('update_webhook')!.handler({
        business_id: 'biz_1',
        webhook_id: 'wh_1',
        enabled: false,
      });

      expect(mockClient.updateWebhook).toHaveBeenCalledWith('biz_1', 'wh_1', {
        url: undefined,
        events: undefined,
        enabled: false,
      });
      expect(result.isError).toBeUndefined();
    });
  });

  describe('delete_webhook', () => {
    it('requires confirm=true to proceed', async () => {
      const result = await server.getTool('delete_webhook')!.handler({
        business_id: 'biz_1',
        webhook_id: 'wh_1',
        confirm: false,
      });

      expect(result.content[0].text).toContain('not confirmed');
      expect(mockClient.deleteWebhook).not.toHaveBeenCalled();
    });

    it('deletes webhook when confirmed', async () => {
      mockClient.deleteWebhook.mockResolvedValue(undefined);

      const result = await server.getTool('delete_webhook')!.handler({
        business_id: 'biz_1',
        webhook_id: 'wh_1',
        confirm: true,
      });

      expect(mockClient.deleteWebhook).toHaveBeenCalledWith('biz_1', 'wh_1');
      expect(result.content[0].text).toContain('deleted successfully');
    });
  });

  // ── Phone number tools ──────────────────────────────────────────
  describe('list_phone_numbers', () => {
    it('returns phone numbers', async () => {
      const numbers = [{ phone_number: '+15551234567', status: 'active' }];
      mockClient.listPhoneNumbers.mockResolvedValue(numbers);

      const result = await server.getTool('list_phone_numbers')!.handler({});

      expect(JSON.parse(result.content[0].text)).toEqual(numbers);
    });

    it('returns error on failure', async () => {
      mockClient.listPhoneNumbers.mockRejectedValue(new Error('Forbidden'));

      const result = await server.getTool('list_phone_numbers')!.handler({});

      expect(result.isError).toBe(true);
    });
  });

  // ── Analytics tools ──────────────────────────────────────────────
  describe('get_usage', () => {
    it('returns usage data', async () => {
      const usage = { total_calls: 100, total_minutes: 250 };
      mockClient.getUsage.mockResolvedValue(usage);

      const result = await server.getTool('get_usage')!.handler({});

      expect(JSON.parse(result.content[0].text)).toEqual(usage);
    });

    it('returns error on failure', async () => {
      mockClient.getUsage.mockRejectedValue(new Error('Timeout'));

      const result = await server.getTool('get_usage')!.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Timeout');
    });
  });

  describe('get_usage_summary', () => {
    it('returns usage summary', async () => {
      const summary = { total_cost: 42.5, period: '2025-01' };
      mockClient.getUsageSummary.mockResolvedValue(summary);

      const result = await server.getTool('get_usage_summary')!.handler({});

      expect(JSON.parse(result.content[0].text)).toEqual(summary);
    });
  });

  describe('get_subscription', () => {
    it('returns subscription details', async () => {
      const sub = { plan: 'pro', status: 'active' };
      mockClient.getSubscription.mockResolvedValue(sub);

      const result = await server.getTool('get_subscription')!.handler({});

      expect(JSON.parse(result.content[0].text)).toEqual(sub);
    });

    it('returns error on failure', async () => {
      mockClient.getSubscription.mockRejectedValue(new Error('Not found'));

      const result = await server.getTool('get_subscription')!.handler({});

      expect(result.isError).toBe(true);
    });
  });

  describe('list_invoices', () => {
    it('returns invoice list', async () => {
      const invoices = [{ id: 'inv_1', amount: 99.0, status: 'paid' }];
      mockClient.listInvoices.mockResolvedValue(invoices);

      const result = await server.getTool('list_invoices')!.handler({});

      expect(JSON.parse(result.content[0].text)).toEqual(invoices);
    });
  });

  // ── Account tools ────────────────────────────────────────────────
  describe('get_profile', () => {
    it('returns user profile', async () => {
      const profile = { user_id: 'u_1', email: 'test@example.com' };
      mockClient.getProfile.mockResolvedValue(profile);

      const result = await server.getTool('get_profile')!.handler({});

      expect(JSON.parse(result.content[0].text)).toEqual(profile);
    });

    it('returns error on failure', async () => {
      mockClient.getProfile.mockRejectedValue(new Error('Auth expired'));

      const result = await server.getTool('get_profile')!.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Auth expired');
    });
  });

  describe('list_api_keys', () => {
    it('returns API keys list', async () => {
      const keys = [{ prefix: 'sk_abc', name: 'prod' }];
      mockClient.listApiKeys.mockResolvedValue(keys);

      const result = await server.getTool('list_api_keys')!.handler({});

      expect(JSON.parse(result.content[0].text)).toEqual(keys);
    });
  });

  describe('create_api_key', () => {
    it('creates an API key with a name', async () => {
      const key = { prefix: 'sk_new', key: 'sk_new_fullkey' };
      mockClient.createApiKey.mockResolvedValue(key);

      const result = await server.getTool('create_api_key')!.handler({
        name: 'staging',
      });

      expect(mockClient.createApiKey).toHaveBeenCalledWith('staging');
      expect(JSON.parse(result.content[0].text)).toEqual(key);
    });

    it('creates an API key without a name', async () => {
      const key = { prefix: 'sk_anon' };
      mockClient.createApiKey.mockResolvedValue(key);

      const result = await server.getTool('create_api_key')!.handler({});

      expect(mockClient.createApiKey).toHaveBeenCalledWith(undefined);
      expect(result.isError).toBeUndefined();
    });

    it('returns error on failure', async () => {
      mockClient.createApiKey.mockRejectedValue(new Error('Limit reached'));

      const result = await server.getTool('create_api_key')!.handler({
        name: 'extra',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Limit reached');
    });
  });

  describe('revoke_api_key', () => {
    it('requires confirm=true to proceed', async () => {
      const result = await server.getTool('revoke_api_key')!.handler({
        prefix: 'sk_old',
        confirm: false,
      });

      expect(result.content[0].text).toContain('not confirmed');
      expect(mockClient.revokeApiKey).not.toHaveBeenCalled();
    });

    it('revokes an API key when confirmed', async () => {
      mockClient.revokeApiKey.mockResolvedValue(undefined);

      const result = await server.getTool('revoke_api_key')!.handler({
        prefix: 'sk_old',
        confirm: true,
      });

      expect(mockClient.revokeApiKey).toHaveBeenCalledWith('sk_old');
      expect(result.content[0].text).toContain('revoked successfully');
    });

    it('returns error on failure', async () => {
      mockClient.revokeApiKey.mockRejectedValue(new Error('Key not found'));

      const result = await server.getTool('revoke_api_key')!.handler({
        prefix: 'sk_missing',
        confirm: true,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Key not found');
    });
  });

  // ── Error formatting ─────────────────────────────────────────────
  describe('error formatting', () => {
    it('handles non-Error thrown values', async () => {
      mockClient.listBusinesses.mockRejectedValue('raw string error');

      const result = await server.getTool('list_businesses')!.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('raw string error');
    });

    it('handles Error objects with message', async () => {
      mockClient.getProfile.mockRejectedValue(new TypeError('type problem'));

      const result = await server.getTool('get_profile')!.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('type problem');
    });
  });
});

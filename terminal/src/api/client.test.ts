import { describe, expect, it, vi } from 'vitest';

import { apiRequest, createApiClient } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiRequest', () => {
  it('asks the local server for a configured bot and does not send a password', () => {
    const request = apiRequest('us-vxtrans-com-2894', '/status');
    expect(request.url).toBe('/api/v1/status');
    expect(request.headers.get('X-Ft-Bot')).toBe('us-vxtrans-com-2894');
    expect(request.headers.get('Authorization')).toBeNull();
  });
});

describe('createApiClient', () => {
  it('sends the selected bot id', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('X-Ft-Bot')).toBe('sg');
      expect(new Headers(init?.headers).get('Authorization')).toBeNull();
      return jsonResponse({ ok: true });
    });
    const client = createApiClient({ getBotId: () => 'sg', fetchImpl });
    await expect(client.get<{ ok: boolean }>('/ping')).resolves.toEqual({ ok: true });
  });
});

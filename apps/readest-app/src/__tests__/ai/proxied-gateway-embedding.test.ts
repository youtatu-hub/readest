import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockFetch, mockGetAccessToken } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockGetAccessToken: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);
vi.mock('@/utils/access', () => ({
  getAccessToken: mockGetAccessToken,
}));

import { createProxiedEmbeddingModel } from '@/services/ai/providers/ProxiedGatewayEmbedding';

interface CallableEmbeddingModel {
  doEmbed(args: { values: string[] }): Promise<unknown>;
}

describe('ProxiedGatewayEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('readest-access-token');
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ embedding: [0.1, 0.2] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  test('does not send an indexing request without a Readest session', async () => {
    mockGetAccessToken.mockResolvedValue(null);
    const model = createProxiedEmbeddingModel({
      apiKey: 'gateway-key',
    }) as unknown as CallableEmbeddingModel;

    await expect(model.doEmbed({ values: ['Chapter text'] })).rejects.toThrow('Not authenticated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('authenticates indexing requests and forwards the selected embedding model', async () => {
    const model = createProxiedEmbeddingModel({
      apiKey: 'gateway-key',
      model: 'cohere/embed-v4.0',
    }) as unknown as CallableEmbeddingModel;

    await model.doEmbed({ values: ['Chapter text'] });

    expect(mockGetAccessToken).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ai/embed');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer readest-access-token');
    expect(JSON.parse(init.body as string)).toEqual({
      texts: ['Chapter text'],
      single: true,
      apiKey: 'gateway-key',
      model: 'cohere/embed-v4.0',
    });
  });
});

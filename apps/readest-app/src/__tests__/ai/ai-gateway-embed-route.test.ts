import { beforeEach, describe, expect, test, vi } from 'vitest';

const { createGatewayMock, embeddingModelMock, embedManyMock, validateUserAndTokenMock } =
  vi.hoisted(() => ({
    createGatewayMock: vi.fn(),
    embeddingModelMock: vi.fn(),
    embedManyMock: vi.fn(),
    validateUserAndTokenMock: vi.fn(),
  }));

vi.mock('ai', () => ({
  createGateway: createGatewayMock,
  embed: vi.fn(),
  embedMany: embedManyMock,
}));

vi.mock('@/utils/access', () => ({
  validateUserAndToken: validateUserAndTokenMock,
}));

import { POST } from '@/app/api/ai/embed/route';

describe('POST /api/ai/embed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateUserAndTokenMock.mockResolvedValue({
      user: { id: 'user-1' },
      token: 'readest-token',
    });
    createGatewayMock.mockReturnValue({ embeddingModel: embeddingModelMock });
    embeddingModelMock.mockReturnValue({ id: 'embedding-model' });
    embedManyMock.mockResolvedValue({ embeddings: [[0.1, 0.2]] });
  });

  test('uses the embedding model selected by the client', async () => {
    const request = new Request('https://readest.test/api/ai/embed', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer readest-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: ['Chapter text'],
        single: false,
        apiKey: 'gateway-key',
        model: 'cohere/embed-v4.0',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(createGatewayMock).toHaveBeenCalledWith({ apiKey: 'gateway-key' });
    expect(embeddingModelMock).toHaveBeenCalledWith('cohere/embed-v4.0');
  });
});

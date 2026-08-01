import { validateUserAndToken } from '@/utils/access';
import { streamText, createGateway } from 'ai';
import type { ModelMessage } from 'ai';

type IncomingMessage = { role: string; content?: unknown; attachments?: unknown[] };

function normalizeIncomingMessages(value: unknown): ModelMessage[] {
  if (!Array.isArray(value)) return [];
  return value.map((message: IncomingMessage) => {
    const rawContent = Array.isArray(message.content) ? [...message.content] : message.content ?? '';
    const parts: unknown[] = Array.isArray(rawContent) ? rawContent : [{ type: 'text', text: String(rawContent) }];
    for (const attachment of message.attachments ?? []) {
      if (!attachment || typeof attachment !== 'object') continue;
      const attachmentContent = (attachment as { content?: unknown }).content;
      if (!Array.isArray(attachmentContent)) continue;
      for (const part of attachmentContent) {
        if (!part || typeof part !== 'object') continue;
        const candidate = part as { type?: unknown; image?: unknown };
        if (candidate.type !== 'image' || typeof candidate.image !== 'string') continue;
        if (!parts.some((existing) => {
          if (!existing || typeof existing !== 'object') return false;
          const prior = existing as { type?: unknown; image?: unknown };
          return prior.type === 'image' && prior.image === candidate.image;
        })) parts.push({ type: 'image', image: candidate.image });
      }
    }
    return { role: message.role, content: parts };
  }) as ModelMessage[];
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
    if (!user || !token) {
      return Response.json({ error: 'Not authenticated' }, { status: 403 });
    }

    const { messages: rawMessages, system, apiKey, model } = await req.json();
    const messages = normalizeIncomingMessages(rawMessages);

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const gatewayApiKey = apiKey || process.env['AI_GATEWAY_API_KEY'];
    if (!gatewayApiKey) {
      return new Response(JSON.stringify({ error: 'API key required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const gateway = createGateway({ apiKey: gatewayApiKey });
    const languageModel = gateway(model || 'google/gemini-2.5-flash-lite');

    const result = streamText({
      model: languageModel,
      system: system || 'You are a helpful assistant.',
      messages: messages as ModelMessage[],
    });

    return result.toTextStreamResponse();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: `Chat failed: ${errorMessage}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

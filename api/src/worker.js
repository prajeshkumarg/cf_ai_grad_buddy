// Study Assistant Worker (API-only)
//
// Routes:
//   POST /api/chat         full reply as JSON
//   POST /api/chat/stream  reply streamed token by token as Server-Sent Events
//   POST /api/clear        delete a user's history
//   POST /api/history      read a user's history (debugging)

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_HISTORY_MESSAGES = 20; // 10 exchanges
const HISTORY_TTL_SECONDS = 86400 * 7; // 7 days
const GENERATION = { max_tokens: 512, temperature: 0.7 };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM_PROMPT = `You are StudyBBot, a helpful study assistant. Your purpose is to help learners understand concepts, especially the math behind machine learning, and to practice effectively.

Guidelines:
- Explain concepts clearly and simply, using step-by-step reasoning when helpful.
- Offer small practice questions or short quizzes on request; include correct answers and brief explanations.
- Break down complex topics into understandable parts; provide concrete examples and simple analogies.
- Be friendly, patient, supportive, and educational. Prefer concise responses (2–4 short paragraphs or compact bullet points). If the user asks for more depth, elaborate.
- Ask 1–2 clarifying questions when the prompt is ambiguous; otherwise proceed with reasonable assumptions and state them briefly.
- Prefer accurate math and notation; when deriving formulas, show key steps. Keep equations readable in plain text.
- Remember recent context from the conversation to avoid repeating yourself.

Tone and scope:
- Keep answers on-topic to what the user asked. Avoid unnecessary digressions.
- If a request is unrelated to studying or learning, briefly say you can only help with study topics and offer a related way to help.
- Encourage and motivate, but prioritize correctness and clarity.
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // No HTML served here; UI is hosted on Cloudflare Pages
    if (request.method === 'POST') {
      switch (url.pathname) {
        case '/api/chat': return handleChat(request, env);
        case '/api/chat/stream': return handleChatStream(request, env);
        case '/api/clear': return handleClear(request, env);
        case '/api/history': return handleGetHistory(request, env); // optional, for debugging
      }
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function historyKey(userId) {
  return `chat_history_${userId}`;
}

async function loadHistory(env, userId) {
  const historyJson = await env.STUDY_DATA.get(historyKey(userId));
  return historyJson ? JSON.parse(historyJson) : [];
}

// Appends one exchange, keeps only the most recent messages so the prompt
// stays bounded, and writes back with a TTL. Returns the new history length.
async function saveExchange(env, userId, history, userMessage, assistantMessage) {
  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: assistantMessage });
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES);
  }
  await env.STUDY_DATA.put(historyKey(userId), JSON.stringify(history), {
    expirationTtl: HISTORY_TTL_SECONDS,
  });
  return history.length;
}

function buildMessages(history, message) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: message },
  ];
}

// Reads { message, userId } from the body. Returns [fields, null] or [null, errorResponse].
async function readChatRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return [null, jsonResponse({ error: 'Request body must be JSON', success: false }, 400)];
  }
  const { message, userId } = body || {};
  if (!message || !userId) {
    return [null, jsonResponse({ error: 'Missing message or userId', success: false }, 400)];
  }
  return [{ message, userId }, null];
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// Handle chat messages (non-streaming)
async function handleChat(request, env) {
  const [req, errorResponse] = await readChatRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const history = await loadHistory(env, req.userId);

    // Call Llama 3.3 via Workers AI
    const aiResponse = await env.AI.run(MODEL, {
      messages: buildMessages(history, req.message),
      ...GENERATION,
    });
    const assistantMessage = aiResponse.response;

    const historyLength = await saveExchange(env, req.userId, history, req.message, assistantMessage);
    return jsonResponse({ response: assistantMessage, success: true, historyLength });
  } catch (error) {
    console.error('Chat error:', error);
    return jsonResponse({ error: error.message || 'Internal server error', success: false }, 500);
  }
}

// Handle chat messages, streaming the reply as Server-Sent Events.
//
// Workers AI streams its own SSE (`data: {"response":"..."}` ... `data: [DONE]`).
// We parse it as it arrives and re-emit a small, stable event format:
//
//   event: token   data: {"token":"..."}          one per generated chunk
//   event: done    data: {"historyLength":N}      after history is saved
//   event: error   data: {"error":"..."}          if something fails mid-stream
//
// The full reply is accumulated while streaming and saved to KV once the
// model finishes, so memory works the same as the non-streaming route.
async function handleChatStream(request, env) {
  const [req, errorResponse] = await readChatRequest(request);
  if (errorResponse) return errorResponse;

  let history, upstream;
  try {
    history = await loadHistory(env, req.userId);
    upstream = await env.AI.run(MODEL, {
      messages: buildMessages(history, req.message),
      ...GENERATION,
      stream: true,
    });
  } catch (error) {
    console.error('Stream setup error:', error);
    return jsonResponse({ error: error.message || 'Internal server error', success: false }, 500);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';

  const emit = (controller, event, data) =>
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  // Handles one complete upstream SSE event (the text between blank lines).
  const handleUpstreamEvent = (rawEvent, controller) => {
    for (const line of rawEvent.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue; // ignore malformed lines rather than killing the stream
      }
      if (typeof parsed.response === 'string' && parsed.response.length > 0) {
        reply += parsed.response;
        emit(controller, 'token', { token: parsed.response });
      }
    }
  };

  const relay = new TransformStream({
    transform(chunk, controller) {
      // Chunks can split an event (or a UTF-8 character) anywhere, so buffer
      // until a full event, terminated by a blank line, has arrived.
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        handleUpstreamEvent(buffer.slice(0, end), controller);
        buffer = buffer.slice(end + 2);
      }
    },
    async flush(controller) {
      buffer += decoder.decode().replace(/\r/g, '');
      if (buffer.trim()) handleUpstreamEvent(buffer, controller);

      if (!reply) {
        emit(controller, 'error', { error: 'The model returned an empty response' });
        return;
      }
      try {
        const historyLength = await saveExchange(env, req.userId, history, req.message, reply);
        emit(controller, 'done', { historyLength });
      } catch (error) {
        console.error('Saving history failed:', error);
        emit(controller, 'error', { error: 'Reply was not saved to history' });
      }
    },
  });

  return new Response(upstream.pipeThrough(relay), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      ...CORS_HEADERS,
    },
  });
}

// Handle clear history
async function handleClear(request, env) {
  try {
    const { userId } = await request.json();
    if (!userId) {
      return jsonResponse({ error: 'Missing userId', success: false }, 400);
    }
    await env.STUDY_DATA.delete(historyKey(userId));
    return jsonResponse({ success: true, message: 'Chat history cleared successfully' });
  } catch (error) {
    console.error('Clear error:', error);
    return jsonResponse({ error: error.message || 'Internal server error', success: false }, 500);
  }
}

// Handle get history (optional - for debugging)
async function handleGetHistory(request, env) {
  try {
    const { userId } = await request.json();
    if (!userId) {
      return jsonResponse({ error: 'Missing userId', success: false }, 400);
    }
    const history = await loadHistory(env, userId);
    return jsonResponse({ success: true, history, count: history.length });
  } catch (error) {
    console.error('Get history error:', error);
    return jsonResponse({ error: error.message || 'Internal server error', success: false }, 500);
  }
}

// Helper function for JSON responses
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

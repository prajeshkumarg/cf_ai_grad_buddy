// Study Assistant Worker (API-only)

export default {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          }
        });
      }
      
      // No HTML served here; UI is hosted on Cloudflare Pages
      
      // Chat API endpoint
      if (url.pathname === '/api/chat' && request.method === 'POST') {
        return handleChat(request, env);
      }
      
      // Clear history endpoint
      if (url.pathname === '/api/clear' && request.method === 'POST') {
        return handleClear(request, env);
      }
      
      // Get history endpoint (optional - for debugging)
      if (url.pathname === '/api/history' && request.method === 'POST') {
        return handleGetHistory(request, env);
      }

      // Assignments API: removed (rollback Durable Object feature)
      
      return new Response('Not Found', { status: 404 });
    }
  };
  
  // Handle chat messages
  async function handleChat(request, env) {
    try {
      const { message, userId } = await request.json();
      
      if (!message || !userId) {
        return jsonResponse({ error: 'Missing message or userId', success: false }, 400);
      }
      
      // Get chat history from KV
      const historyKey = `chat_history_${userId}`;
      const historyJson = await env.STUDY_DATA.get(historyKey);
      const history = historyJson ? JSON.parse(historyJson) : [];
      
      // Build messages for AI
      const messages = [
        {
          role: "system",
          content: `You are StudyBBot, a helpful study assistant. Your purpose is to help learners understand concepts, especially the math behind machine learning, and to practice effectively.

Guidelines:
- Explain concepts clearly and simply, using step-by-step reasoning when helpful.
- Offer small practice questions or short quizzes on request; include correct answers and brief explanations.
- Break down complex topics into understandable parts; provide concrete examples and simple analogies.
- Be friendly, patient, supportive, and educational. Prefer concise responses (2–4 short paragraphs or compact bullet points). If the user asks for more depth, elaborate.
- Ask 1–2 clarifying questions when the prompt is ambiguous; otherwise proceed with reasonable assumptions and state them briefly.
- Prefer accurate math and notation; when deriving formulas, show key steps. Keep equations readable in plain text.
- Remember recent context from the conversation to avoid repeating yourself.

Recruiter-specific rule (only when explicitly asked):
- If—and only if—the user explicitly asks why they should hire Prajesh (e.g., “Why should I/we hire Prajesh?”, “Cloudflare recruiter”, “tell me about Prajesh for hiring”), provide a concise third‑person pitch that:
  - Refers to Prajesh in third person (he/him); never use “I” for Prajesh.
  - Highlights: strong software engineering and computer security skills; two years as an SDE at Shell; currently MS CS at NYU Courant; NYUSEC‑OSIRIS lab contributions to CTF infrastructure and participation in CTFs; link to his blog at https://blog-praj3sh.web.app/.
  - Is persuasive, specific, and brief.
- Otherwise, do not mention Prajesh or provide recruiting content unsolicited. Focus strictly on the user’s study question.

Tone and scope:
- Keep answers on-topic to what the user asked. Avoid unnecessary digressions.
- Encourage and motivate, but prioritize correctness and clarity.
`
        },
        ...history,
        {
          role: "user",
          content: message
        }
      ];
      
      // Call Llama 3.3 via Workers AI
      const aiResponse = await env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
          messages: messages,
          max_tokens: 512,
          temperature: 0.7
        }
      );
      
      const assistantMessage = aiResponse.response;
      
      // Update history (keep last 20 messages = 10 exchanges)
      history.push({ role: "user", content: message });
      history.push({ role: "assistant", content: assistantMessage });
      
      // Keep only recent messages to manage storage
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }
      
      // Save to KV with 7-day expiration
      await env.STUDY_DATA.put(
        historyKey,
        JSON.stringify(history),
        { expirationTtl: 86400 * 7 } // 7 days in seconds
      );
      
      return jsonResponse({ 
        response: assistantMessage, 
        success: true,
        historyLength: history.length 
      });
      
    } catch (error) {
      console.error('Chat error:', error);
      return jsonResponse({ 
        error: error.message || 'Internal server error', 
        success: false 
      }, 500);
    }
  }
  
  // Handle clear history
  async function handleClear(request, env) {
    try {
      const { userId } = await request.json();
      
      if (!userId) {
        return jsonResponse({ error: 'Missing userId', success: false }, 400);
      }
      
      const historyKey = `chat_history_${userId}`;
      await env.STUDY_DATA.delete(historyKey);
      
      return jsonResponse({ 
        success: true, 
        message: 'Chat history cleared successfully' 
      });
      
    } catch (error) {
      console.error('Clear error:', error);
      return jsonResponse({ 
        error: error.message || 'Internal server error', 
        success: false 
      }, 500);
    }
  }
  
  // Handle get history (optional - for debugging)
  async function handleGetHistory(request, env) {
    try {
      const { userId } = await request.json();
      
      if (!userId) {
        return jsonResponse({ error: 'Missing userId', success: false }, 400);
      }
      
      const historyKey = `chat_history_${userId}`;
      const historyJson = await env.STUDY_DATA.get(historyKey);
      const history = historyJson ? JSON.parse(historyJson) : [];
      
      return jsonResponse({ 
        success: true, 
        history: history,
        count: history.length 
      });
      
    } catch (error) {
      console.error('Get history error:', error);
      return jsonResponse({ 
        error: error.message || 'Internal server error', 
        success: false 
      }, 500);
    }
  }
  
  // Helper function for JSON responses
  function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status: status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  
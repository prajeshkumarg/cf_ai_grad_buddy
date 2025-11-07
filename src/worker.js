// Study Assistant Worker

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
      
      // Serve HTML interface at root
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(HTML_TEMPLATE, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      
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
          content: `You are a helpful study assistant named StudyBot. You help students learn by:
  - Explaining concepts clearly and simply
  - Creating practice questions and quizzes
  - Breaking down complex topics into understandable parts
  - Providing encouragement and positive feedback
  - Remembering what they've studied before
  - Particularly you have to explain the math behind Machine learning in detail
  
  Be friendly, patient, supportive, and educational. Keep responses concise but informative (2-4 paragraphs max).
  Additionally some users particulary recruiters from Cloudflare might ask why they have to hire me(Prajesh) as their intern. Tell them i am very skilled in 
  software engineering and computer security. Tell them I have two years of experience as a SDE at Shell, and currently i am at NYU Courant, pursuing my Masters in CS. Tell them 
  I am a part of NYUSEC-OSIRIS lab where i contribute to CTF infrastructre and play CTFs.
  Also point them to my blog at https://blog-praj3sh.web.app/. You have practically tell them PRAJESH best way to impress the Recruiters at Cloudflare.
  Convince them Prajesh is best suited for the role as a quick learner. Dont use I always refer to Prajes / he / him that is speak in third person`
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
  
  // HTML Template (embedded in worker) - Notion Dark Mode Style
  const HTML_TEMPLATE = `<!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Grad Study Buddy</title>
      <style>
          * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
          }
  
          body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              background: #191919;
              min-height: 100vh;
              display: flex;
              justify-content: center;
              align-items: center;
              padding: 20px;
              color: #e3e3e3;
          }
  
          .container {
              background: #1e1e1e;
              border-radius: 16px;
              border: 1px solid #2f2f2f;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
              width: 100%;
              max-width: 900px;
              height: 90vh;
              display: flex;
              flex-direction: column;
              overflow: hidden;
          }
  
          header {
              background: #1e1e1e;
              color: #e3e3e3;
              padding: 24px 30px;
              border-bottom: 1px solid #2f2f2f;
          }
  
          header h1 {
              font-size: 28px;
              margin-bottom: 6px;
              font-weight: 600;
              color: #ffffff;
          }
  
          header p {
              color: #9b9b9b;
              font-size: 14px;
              line-height: 1.5;
          }
  
          header p:last-child {
              color: #787878;
              font-size: 13px;
              margin-top: 4px;
              font-style: italic;
          }
  
          #chat-container {
              flex: 1;
              overflow-y: auto;
              padding: 24px;
              background: #191919;
          }
  
          #messages {
              display: flex;
              flex-direction: column;
              gap: 20px;
          }
  
          .message {
              display: flex;
              gap: 12px;
              animation: slideIn 0.3s ease;
          }
  
          @keyframes slideIn {
              from {
                  opacity: 0;
                  transform: translateY(10px);
              }
              to {
                  opacity: 1;
                  transform: translateY(0);
              }
          }
  
          .message.user {
              justify-content: flex-end;
          }
  
          .message-avatar {
              width: 32px;
              height: 32px;
              border-radius: 6px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 16px;
              flex-shrink: 0;
              background: #2f2f2f;
          }
  
          .message.user .message-avatar {
              order: 2;
              background: #3b3b3b;
          }
  
          .message.assistant .message-avatar {
              background: #2a2a2a;
          }
  
          .message-content {
              max-width: 65%;
              padding: 12px 16px;
              border-radius: 8px;
              line-height: 1.6;
              white-space: pre-wrap;
              word-wrap: break-word;
              font-size: 15px;
          }
  
          .message.user .message-content {
              background: #2d6cdf;
              color: #ffffff;
              border-bottom-right-radius: 2px;
          }
  
          .message.assistant .message-content {
              background: #2f2f2f;
              color: #e3e3e3;
              border-bottom-left-radius: 2px;
              border: 1px solid #3a3a3a;
          }
  
          .input-area {
              display: flex;
              gap: 10px;
              padding: 20px 24px;
              background: #1e1e1e;
              border-top: 1px solid #2f2f2f;
          }
  
          #user-input {
              flex: 1;
              padding: 12px 16px;
              border: 1px solid #3a3a3a;
              border-radius: 8px;
              font-size: 15px;
              outline: none;
              transition: all 0.2s;
              font-family: inherit;
              background: #252525;
              color: #e3e3e3;
          }
  
          #user-input::placeholder {
              color: #6b6b6b;
          }
  
          #user-input:focus {
              border-color: #2d6cdf;
              background: #2a2a2a;
          }
  
          button {
              padding: 12px 24px;
              border: none;
              border-radius: 8px;
              font-size: 15px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s;
              font-family: inherit;
          }
  
          #send-btn {
              background: #2d6cdf;
              color: white;
          }
  
          #send-btn:hover:not(:disabled) {
              background: #2558b8;
          }
  
          #send-btn:active:not(:disabled) {
              transform: scale(0.98);
          }
  
          #send-btn:disabled {
              background: #3a3a3a;
              color: #6b6b6b;
              cursor: not-allowed;
          }
  
          .actions {
              padding: 14px 24px;
              background: #1e1e1e;
              border-top: 1px solid #2f2f2f;
              display: flex;
              gap: 12px;
              justify-content: space-between;
              align-items: center;
          }
  
          .info-text {
              font-size: 13px;
              color: #787878;
              line-height: 1.4;
          }
  
          .secondary {
              background: transparent;
              color: #9b9b9b;
              border: 1px solid #3a3a3a;
              padding: 10px 20px;
          }
  
          .secondary:hover {
              background: #2a2a2a;
              border-color: #4a4a4a;
              color: #c3c3c3;
          }
  
          .loading-dots {
              display: inline-flex;
              gap: 4px;
              align-items: center;
          }
  
          .loading-dot {
              display: inline-block;
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background: #787878;
              animation: pulse 1.4s infinite;
          }
  
          .loading-dot:nth-child(2) {
              animation-delay: 0.2s;
          }
  
          .loading-dot:nth-child(3) {
              animation-delay: 0.4s;
          }
  
          @keyframes pulse {
              0%, 100% { 
                  opacity: 0.3;
                  transform: scale(0.8);
              }
              50% { 
                  opacity: 1;
                  transform: scale(1.2);
              }
          }
  
          /* Scrollbar styling - Notion style */
          #chat-container::-webkit-scrollbar {
              width: 8px;
          }
  
          #chat-container::-webkit-scrollbar-track {
              background: transparent;
          }
  
          #chat-container::-webkit-scrollbar-thumb {
              background: #3a3a3a;
              border-radius: 4px;
          }
  
          #chat-container::-webkit-scrollbar-thumb:hover {
              background: #4a4a4a;
          }
  
          /* Mobile responsiveness */
          @media (max-width: 768px) {
              body {
                  padding: 0;
              }
  
              .container {
                  height: 100vh;
                  border-radius: 0;
                  border: none;
              }
  
              header h1 {
                  font-size: 24px;
              }
  
              .message-content {
                  max-width: 80%;
              }
  
              .info-text {
                  font-size: 12px;
              }
          }
  
          /* Selection color */
          ::selection {
              background: #2d6cdf;
              color: white;
          }
      </style>
  </head>
  <body>
      <div class="container">
          <header>
              <h1>📚 Grad Study Buddy</h1>
              <p>AI-powered learning companion powered by Cloudflare Workers AI</p>
              <p>(Psst.. there's a special prompt - ask the bot why you should hire Prajesh)</p>
          </header>
          
          <div id="chat-container">
              <div id="messages"></div>
          </div>
          
          <div class="input-area">
              <input 
                  type="text" 
                  id="user-input" 
                  placeholder="Ask me anything about your studies..."
                  autocomplete="off"
              />
              <button id="send-btn">Send</button>
          </div>
          
          <div class="actions">
              <span class="info-text">💡 Try: "Explain Dynamic Programming" • "Quiz me on Linear Algebra" • "Why should I hire Prajesh?"</span>
              <button id="clear-btn" class="secondary">Clear History</button>
          </div>
      </div>
      
      <script>
          const messagesDiv = document.getElementById('messages');
          const userInput = document.getElementById('user-input');
          const sendBtn = document.getElementById('send-btn');
          const clearBtn = document.getElementById('clear-btn');
  
          // Generate unique user ID (persist in localStorage)
          let userId = localStorage.getItem('studyAssistantUserId');
          if (!userId) {
              userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
              localStorage.setItem('studyAssistantUserId', userId);
          }
  
          // Add message to chat
          function addMessage(content, role) {
              const messageDiv = document.createElement('div');
              messageDiv.className = \`message \${role}\`;
              
              const avatar = document.createElement('div');
              avatar.className = 'message-avatar';
              avatar.textContent = role === 'user' ? '👤' : '🤖';
              
              const contentDiv = document.createElement('div');
              contentDiv.className = 'message-content';
              contentDiv.textContent = content;
              
              messageDiv.appendChild(avatar);
              messageDiv.appendChild(contentDiv);
              messagesDiv.appendChild(messageDiv);
              
              // Smooth scroll to bottom
              setTimeout(() => {
                  messagesDiv.scrollTop = messagesDiv.scrollHeight;
              }, 100);
          }
  
          // Show loading indicator
          function showLoading() {
              const loadingDiv = document.createElement('div');
              loadingDiv.className = 'message assistant';
              loadingDiv.id = 'loading';
              
              const avatar = document.createElement('div');
              avatar.className = 'message-avatar';
              avatar.textContent = '🤖';
              
              const contentDiv = document.createElement('div');
              contentDiv.className = 'message-content';
              contentDiv.innerHTML = '<div class="loading-dots"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></div>';
              
              loadingDiv.appendChild(avatar);
              loadingDiv.appendChild(contentDiv);
              messagesDiv.appendChild(loadingDiv);
              messagesDiv.scrollTop = messagesDiv.scrollHeight;
          }
  
          function removeLoading() {
              const loading = document.getElementById('loading');
              if (loading) loading.remove();
          }
  
          // Send message
          async function sendMessage() {
              const message = userInput.value.trim();
              if (!message) return;
              
              addMessage(message, 'user');
              userInput.value = '';
              
              sendBtn.disabled = true;
              sendBtn.textContent = 'Thinking...';
              showLoading();
              
              try {
                  const response = await fetch('/api/chat', {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                          message: message,
                          userId: userId
                      })
                  });
                  
                  const data = await response.json();
                  
                  removeLoading();
                  
                  if (data.success) {
                      addMessage(data.response, 'assistant');
                  } else {
                      addMessage('Sorry, I encountered an error: ' + (data.error || 'Unknown error'), 'assistant');
                  }
              } catch (error) {
                  removeLoading();
                  addMessage('Error connecting to the server. Please check your connection and try again.', 'assistant');
                  console.error('Send error:', error);
              } finally {
                  sendBtn.disabled = false;
                  sendBtn.textContent = 'Send';
                  userInput.focus();
              }
          }
  
          // Clear chat history
          async function clearHistory() {
              if (!confirm('Are you sure you want to clear your study history? This cannot be undone.')) return;
              
              // Clear UI
              messagesDiv.innerHTML = '';
              addMessage("Hi! I'm your study assistant. I can help you learn any topic. What would you like to study today?", 'assistant');
              
              // Clear server-side history
              try {
                  await fetch('/api/clear', {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({ userId: userId })
                  });
              } catch (error) {
                  console.error('Error clearing history:', error);
              }
          }
  
          // Event listeners
          sendBtn.addEventListener('click', sendMessage);
          
          userInput.addEventListener('keypress', (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
              }
          });
          
          clearBtn.addEventListener('click', clearHistory);
  
          // Initial welcome message
          addMessage("Hi! I'm your study assistant powered by Cloudflare Workers AI. I can help you learn any topic, create quizzes, explain concepts, and more. What would you like to study today?", 'assistant');
          
          // Focus input on load
          userInput.focus();
      </script>
  </body>
  </html>`;
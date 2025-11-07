
# 📚 Grad Study Buddy

An AI-powered study assistant built with **Cloudflare Workers AI**, featuring an interactive chat interface and conversation memory. This project demonstrates a complete AI application using Cloudflare's serverless platform.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![Workers AI](https://img.shields.io/badge/Workers-AI-blue)](https://developers.cloudflare.com/workers-ai/)
[![Llama 3.3](https://img.shields.io/badge/Model-Llama%203.3%2070B-green)](https://www.llama.com/)

## 🚀 Live Demo

**Try it here**: https://grad-buddy-ui.pages.dev/

Example interactions:
```
You: "Explain dynamic programming"
Bot: [Provides detailed explanation with examples]

You: "Give me a practice problem"
Bot: [Creates a custom DP problem]

You: "Why should I hire Prajesh?"
Bot: [Special recruiter pitch with experience]
```

## 🎯 Features

- **🤖 AI-Powered Learning**: Uses Llama 3.3 70B Instruct for intelligent tutoring
- **💬 Interactive Chat Interface**: Beautiful Notion-inspired dark mode UI
- **🧠 Conversation Memory**: Maintains context across sessions using KV storage
- **📱 Responsive Design**: Works seamlessly on desktop and mobile
- **⚡ Serverless Architecture**: Built entirely on Cloudflare's edge network
- **🎨 Modern UI**: Clean, distraction-free learning experience

## 🏗️ Architecture

This project demonstrates all components of a production AI application:

### 1️⃣ **LLM Integration** ✅

The worker calls **Llama 3.3 70B Instruct** via the Workers AI binding:

```javascript
const aiResponse = await env.AI.run(
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  {
    messages: messages,
    max_tokens: 512,
    temperature: 0.7
  }
);
const assistantMessage = aiResponse.response;
```

**Location**: `src/worker.js` (lines 77-84)  
**Model**: Llama 3.3 70B Instruct (FP8 Fast variant for optimal performance)

### 2️⃣ **Workflow / Coordination** ✅

The Worker coordinates the entire application flow:
- **Request Routing**: Handles chat, history, and clear operations
- **Message Processing**: Builds conversation context with system prompts
- **State Management**: Manages conversation history and persistence

**Key Functions**:
- `handleChat()` - Main conversation handler with AI integration
- `handleClear()` - History management
- `handleGetHistory()` - Debug endpoint for conversation inspection

### 3️⃣ **User Input (Chat Interface) — Cloudflare Pages** ✅

The frontend is served by Cloudflare Pages at `pages-site/index.html` and talks to the Worker API. It includes:
- Real-time message display with smooth animations
- Loading indicator while the assistant is replying
- Enter key to send messages
- Clear history functionality
- Clean, responsive layout

The Pages UI calls the Worker API over HTTPS in production, and defaults to the local Worker in dev.

**API communication (from Pages):**
```javascript
// Pages selects the API base (Workers.dev in prod, 127.0.0.1:8787 in dev)
const API = window.API_BASE || 'https://<your-worker>.workers.dev';
await fetch(`${API}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, userId })
});
```

Tip: During local development, run both in separate terminals:
- Worker API: `wrangler dev` (in `bold-sunset-9de3/`)
- Pages UI: `wrangler pages dev ./pages-site` (at repo root)

**Try These Commands**:
- `"Explain photosynthesis"`
- `"Quiz me on linear algebra"`
- `"What's the math behind gradient descent?"`
- `"Why should I hire Prajesh?"` 😉

### 4️⃣ **Memory / State** ✅

Uses **Cloudflare KV** for persistent conversation storage:

```javascript
// Read chat history
const historyJson = await env.STUDY_DATA.get(historyKey);
const history = historyJson ? JSON.parse(historyJson) : [];

// Write with 7-day TTL
await env.STUDY_DATA.put(
  historyKey,
  JSON.stringify(history),
  { expirationTtl: 86400 * 7 }
);

// Delete history
await env.STUDY_DATA.delete(historyKey);
```


## 🔧 Local Development

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/grad-study-buddy.git
cd grad-study-buddy/bold-sunset-9de3
```

### 2. Install Wrangler

```bash
npm install -g wrangler
```

### 3. Configure Environment

Your `wrangler.json` should include:

```json
{
  "ai": {
    "binding": "AI"
  },
  "kv_namespaces": [
    {
      "id": "YOUR_KV_NAMESPACE_ID",
      "binding": "STUDY_DATA"
    }
  ]
}
```

### 4. Run Development Servers (Worker API + Pages UI)

Run the Worker API and the Pages UI in two terminals:

Terminal 1 — Worker API (in `bold-sunset-9de3`):
```zsh
cd bold-sunset-9de3
wrangler dev
```

Terminal 2 — Pages UI (from repo root):
```zsh
cd /Users/gprajeshkumar/dev/cf_ai_grad_buddy
wrangler pages dev ./pages-site --port 8788
```

Open the UI at `http://localhost:8788`.

Notes:
- The Worker is API-only now; opening its root (e.g., `http://127.0.0.1:8787/`) will 404 by design.
- The Pages UI auto-detects the API: localhost uses `http://127.0.0.1:8787`; in production it uses your Workers.dev URL.
- You can override the API base in your browser with a query param, e.g.: `http://localhost:8788/?api=https://<your-worker>.workers.dev`.

## 📦 Deployment

### Step 1: Create KV Namespace

```bash
wrangler kv:namespace create "STUDY_DATA"
```

Copy the namespace ID from the output:
```
🌀 Creating namespace with title "bold-sunset-9de3-STUDY_DATA"
✨ Success!
Add the following to your wrangler.json:
{ binding = "STUDY_DATA", id = "abc123..." }
```

### Step 2: Update Configuration

Add the namespace ID to `wrangler.json`:
```json
{
  "kv_namespaces": [
    {
      "id": "abc123...",  // ← Your actual ID here
      "binding": "STUDY_DATA"
    }
  ]
}
```

### Step 3: Deploy the Worker (API)

```zsh
cd bold-sunset-9de3
wrangler deploy
```

Your Worker API will be live at a Workers.dev URL, e.g.:
```
https://<your-worker>.workers.dev
```

### Step 4: Deploy the Pages site (UI)

From the repo root, publish the static site in `pages-site/`:
```zsh
cd /Users/gprajeshkumar/dev/cf_ai_grad_buddy
wrangler pages publish ./pages-site --project-name grad-buddy-ui
```

The Pages UI will call your Worker API automatically in production. If you need to hardcode the API base, you can set `window.API_BASE` in `pages-site/index.html`.

## 📁 Project Structure

```
bold-sunset-9de3/
├── src/
│   ├── worker.js           # Main worker logic & API endpoints
│   └── html_template.js    # Chat UI (HTML/CSS/JS)
├── wrangler.json           # Cloudflare configuration
└── README.md               # This file
```

### File Breakdown

**`src/worker.js`** (Main Application Logic)
- Routes: `/`, `/api/chat`, `/api/clear`, `/api/history`
- AI integration with Llama 3.3
- KV storage management
- CORS handling

**`src/html_template.js`** (Frontend)
- Notion-inspired dark mode design
- Real-time chat interface
- LocalStorage for user ID persistence
- Responsive mobile layout


## 🧪 API Reference

### `POST /api/chat`
Send a message to the AI assistant.

**Request Body**:
```json
{
  "message": "Explain photosynthesis",
  "userId": "user_1699123456_abc123"
}
```

**Response**:
```json
{
  "success": true,
  "response": "Photosynthesis is the process by which...",
  "historyLength": 4
}
```

### `POST /api/clear`
Clear conversation history for a user.

**Request Body**:
```json
{
  "userId": "user_1699123456_abc123"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Chat history cleared successfully"
}
```

### `POST /api/history`
Get conversation history (debug endpoint).

**Request Body**:
```json
{
  "userId": "user_1699123456_abc123"
}
```

**Response**:
```json
{
  "success": true,
  "history": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help?" }
  ],
  "count": 2
}
```




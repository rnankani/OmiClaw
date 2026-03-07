require('dotenv').config();
const http = require('http');
const express = require('express');
// WebSocket only used for OpenClaw gateway (not UI)
const { WebSocket } = require('ws');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ─── State ────────────────────────────────────────────────────────
const state = {
  lastTranscript: '',
  lastPhoto: null,        // base64 image from Omi
  lastResponse: '',
  lastParsedDetails: null, // { restaurant, time, partySize }
  callStatus: null,        // Vapi call status
  connected: false,        // OpenClaw gateway connected
  lastUid: null,           // Last Omi user ID
};

// ─── Judge UI via SSE (works through Cloudflare tunnel) ──────────
const sseClients = new Set();

app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'state', data: state })}\n\n`);
  sseClients.add(res);
  // Heartbeat every 20s to prevent Cloudflare 524 timeout
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (e) { clearInterval(heartbeat); }
  }, 20000);
  req.on('close', () => { sseClients.delete(res); clearInterval(heartbeat); });
});

function broadcast(type, data) {
  const msg = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (e) { sseClients.delete(res); }
  }
}

// ─── OpenClaw Gateway Client ──────────────────────────────────────
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
let gatewayWs = null;
let gatewayPending = new Map(); // id -> { resolve, reject }
let gatewayConnected = false;

function connectGateway() {
  console.log(`[gateway] connecting to ${GATEWAY_URL}...`);
  gatewayWs = new WebSocket(GATEWAY_URL, { maxPayload: 25 * 1024 * 1024 });

  gatewayWs.on('open', () => {
    console.log('[gateway] WebSocket open, waiting for challenge...');
  });

  gatewayWs.on('message', (raw) => {
    try {
      const frame = JSON.parse(raw.toString());

      // Handle connect challenge
      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        const nonce = frame.payload?.nonce;
        if (!nonce) {
          console.error('[gateway] challenge missing nonce');
          return;
        }
        console.log('[gateway] received challenge, sending connect...');
        const connectId = crypto.randomUUID();
        const connectFrame = {
          type: 'req',
          id: connectId,
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'gateway-client',
              displayName: 'OmiClaw',
              version: '1.0.0',
              platform: 'darwin',
              mode: 'backend',
            },
            auth: { token: GATEWAY_TOKEN },
            role: 'operator',
            scopes: ['operator.admin'],
          },
        };
        // Track connect request to handle hello-ok
        gatewayPending.set(connectId, {
          resolve: (payload) => {
            gatewayConnected = true;
            state.connected = true;
            console.log('[gateway] connected successfully!');
            broadcast('status', { connected: true });
          },
          reject: (err) => {
            console.error('[gateway] connect rejected:', err.message);
          },
        });
        gatewayWs.send(JSON.stringify(connectFrame));
      }

      // Handle response frames (including hello-ok)
      if (frame.type === 'res') {
        const pending = gatewayPending.get(frame.id);
        if (pending) {
          const payload = frame.payload;
          const status = payload?.status;
          // If it's just an "accepted" ack, keep waiting
          if (status === 'accepted') return;
          gatewayPending.delete(frame.id);
          if (frame.ok) {
            pending.resolve(payload);
          } else {
            pending.reject(new Error(frame.error?.message || 'gateway error'));
          }
        }
        // hello-ok is handled via the pending promise for the connect request
      }

      // Handle events
      if (frame.type === 'event') {
        if (frame.event === 'chat') {
          handleChatEvent(frame.payload);
        }
        // Ignore tick events silently
      }
    } catch (err) {
      console.error('[gateway] parse error:', err.message);
    }
  });

  gatewayWs.on('close', (code, reason) => {
    console.log(`[gateway] closed (${code}): ${reason?.toString() || ''}`);
    gatewayConnected = false;
    state.connected = false;
    broadcast('status', { connected: false });
    // Reconnect after 3 seconds
    setTimeout(connectGateway, 3000);
  });

  gatewayWs.on('error', (err) => {
    console.error('[gateway] error:', err.message);
  });
}

// Accumulate streaming response text
let currentRunText = '';
let currentRunId = null;

function handleChatEvent(payload) {
  if (!payload) return;
  const { runId, state: chatState, message } = payload;

  if (chatState === 'delta') {
    // Streaming delta - extract text
    if (runId !== currentRunId) {
      currentRunId = runId;
      currentRunText = '';
    }
    // Message format varies; try to extract text
    const deltaText = extractTextFromMessage(message);
    if (deltaText) {
      currentRunText = deltaText; // OpenClaw sends cumulative text
      broadcast('transcript', { role: 'assistant', text: currentRunText, streaming: true });
    }
  }

  if (chatState === 'final') {
    const finalText = extractTextFromMessage(message) || currentRunText;
    currentRunText = '';
    currentRunId = null;

    if (!finalText) return;
    console.log(`[openclaw] response: ${finalText.substring(0, 100)}...`);

    state.lastResponse = finalText;
    broadcast('response', { text: finalText });

    // Check for Vapi call action pattern
    const vapiMatch = finalText.match(/\[ACTION:VAPI_CALL\](.*?)\[\/ACTION\]/s);
    if (vapiMatch) {
      try {
        const callParams = JSON.parse(vapiMatch[1]);
        handleVapiCall(callParams);
      } catch (err) {
        console.error('[vapi] failed to parse action:', err.message);
      }
    }

    // Parse reservation details from response
    const details = parseReservationDetails(finalText);
    if (details) {
      state.lastParsedDetails = details;
      broadcast('parsed', details);
    }

    // Speak the response (strip action blocks)
    const spokenText = finalText.replace(/\[ACTION:.*?\[\/ACTION\]/gs, '').trim();
    if (spokenText) {
      speakResponse(spokenText);
    }
  }

  if (chatState === 'error') {
    console.error('[openclaw] run error:', payload.errorMessage);
    broadcast('error', { message: payload.errorMessage });
  }
}

function extractTextFromMessage(message) {
  if (!message) return null;
  // Message can be a string or an object with content
  if (typeof message === 'string') return message;
  if (message.content) {
    if (typeof message.content === 'string') return message.content;
    // Array of content blocks
    if (Array.isArray(message.content)) {
      return message.content
        .filter(b => b.type === 'text' || b.type === 'output_text')
        .map(b => b.text)
        .join('');
    }
  }
  // Try .text directly
  if (message.text) return message.text;
  return null;
}

function sendToOpenClaw(text, attachments) {
  if (!gatewayWs || gatewayWs.readyState !== WebSocket.OPEN || !gatewayConnected) {
    console.error('[gateway] not connected, cannot send message');
    return Promise.reject(new Error('gateway not connected'));
  }

  const id = crypto.randomUUID();
  const params = {
    sessionKey: 'main',
    message: text,
    idempotencyKey: crypto.randomUUID(),
  };
  if (attachments) {
    params.attachments = attachments;
  }

  const frame = { type: 'req', id, method: 'chat.send', params };

  return new Promise((resolve, reject) => {
    gatewayPending.set(id, { resolve, reject });
    gatewayWs.send(JSON.stringify(frame));
    // Timeout after 60 seconds
    setTimeout(() => {
      if (gatewayPending.has(id)) {
        gatewayPending.delete(id);
        reject(new Error('gateway request timeout'));
      }
    }, 60000);
  });
}

// ─── Omi Webhook Handlers ─────────────────────────────────────────
app.post(['/omi/transcript', '/omi/webhook'], async (req, res) => {
  try {
    const { segments } = req.body;
    const uid = req.query.uid || 'default';

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return res.json({ ok: true });
    }

    const text = segments.map(s => s.text).join(' ').trim();
    if (!text) return res.json({ ok: true });

    console.log(`[omi] transcript (uid=${uid}): ${text}`);
    state.lastTranscript = text;
    broadcast('transcript', { role: 'user', text, uid });

    // Wake word detection
    if (!text.toLowerCase().includes('hey claw')) {
      return res.json({ ok: true }); // Ignore without wake word
    }

    // Strip wake word and process
    const command = text.replace(/hey claw/gi, '').trim();
    if (!command) return res.json({ ok: true });

    console.log(`[omi] command: ${command}`);
    state.lastUid = uid;
    broadcast('command', { text: command, uid });

    // Send to OpenClaw
    try {
      await sendToOpenClaw(command);
    } catch (err) {
      console.error('[openclaw] send failed:', err.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[omi] transcript error:', err.message);
    res.json({ ok: true });
  }
});

app.post('/omi/memory', async (req, res) => {
  try {
    const uid = req.query.uid || 'default';
    console.log(`[omi] memory webhook (uid=${uid})`);

    // Memory webhooks contain completed conversations
    // Extract any photos if present
    const photos = req.body?.photos || [];
    if (photos.length > 0) {
      const latestPhoto = photos[photos.length - 1];
      if (latestPhoto.base64) {
        state.lastPhoto = latestPhoto.base64;
        broadcast('photo', { base64: latestPhoto.base64 });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[omi] memory error:', err.message);
    res.json({ ok: true });
  }
});

// Omi photo webhook (some Omi versions send photos separately)
app.post('/omi/photo', async (req, res) => {
  try {
    const uid = req.query.uid || 'default';
    const { base64, image_url } = req.body;

    if (base64) {
      state.lastPhoto = base64;
      broadcast('photo', { base64 });
      console.log(`[omi] photo received (uid=${uid})`);
    } else if (image_url) {
      // Fetch the image
      try {
        const imgRes = await fetch(image_url);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const b64 = buffer.toString('base64');
        state.lastPhoto = b64;
        broadcast('photo', { base64: b64 });
        console.log(`[omi] photo fetched from URL (uid=${uid})`);
      } catch (err) {
        console.error('[omi] failed to fetch photo:', err.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[omi] photo error:', err.message);
    res.json({ ok: true });
  }
});

// ─── Vapi Calling ─────────────────────────────────────────────────
async function handleVapiCall(params) {
  const { restaurant, time, partySize, phone } = params;
  const vapiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

  if (!vapiKey || !phoneNumberId) {
    console.error('[vapi] missing API key or phone number ID');
    broadcast('call', { status: 'error', message: 'Vapi not configured' });
    return;
  }

  // Use Sabpti's phone or the provided number
  const customerNumber = phone || process.env.DEMO_PHONE_NUMBER;
  if (!customerNumber) {
    console.error('[vapi] no customer phone number');
    broadcast('call', { status: 'error', message: 'No phone number' });
    return;
  }

  state.callStatus = 'initiating';
  state.lastParsedDetails = { restaurant, time, partySize };
  broadcast('call', { status: 'initiating', restaurant, time, partySize });
  broadcast('parsed', { restaurant, time, partySize });

  try {
    console.log(`[vapi] calling ${customerNumber} for ${restaurant} at ${time} for ${partySize}...`);

    const response = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vapiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumberId,
        customer: { number: customerNumber },
        assistant: {
          firstMessage: `Hi, I'd like to make a reservation please.`,
          model: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            messages: [{
              role: 'system',
              content: `You are calling ${restaurant} to book a table for ${partySize} people at ${time}. Be natural, brief, and polite. If the time isn't available, ask what times are. Report the result clearly. Keep the call under 60 seconds.`,
            }],
          },
          voice: {
            provider: 'elevenlabs',
            voiceId: process.env.ELEVENLABS_VOICE_ID || 'rachel',
          },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Vapi API error: ${response.status} ${errText}`);
    }

    const call = await response.json();
    const callId = call.id;
    console.log(`[vapi] call initiated: ${callId}`);
    state.callStatus = 'in-progress';
    broadcast('call', { status: 'in-progress', callId });

    // Poll for call completion
    pollVapiCall(callId, { restaurant, time, partySize });
  } catch (err) {
    console.error('[vapi] call failed:', err.message);
    state.callStatus = 'error';
    broadcast('call', { status: 'error', message: err.message });

    // Notify OpenClaw of failure
    try {
      await sendToOpenClaw(`[System: The phone call to ${restaurant} failed: ${err.message}. Please inform the user.]`);
    } catch (e) {
      console.error('[openclaw] failed to inject call error:', e.message);
    }
  }
}

async function pollVapiCall(callId, details) {
  const vapiKey = process.env.VAPI_API_KEY;
  const maxPolls = 60; // 60 * 5s = 5 minutes max

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 5000));

    try {
      const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
        headers: { 'Authorization': `Bearer ${vapiKey}` },
      });

      if (!response.ok) continue;

      const call = await response.json();
      console.log(`[vapi] poll ${i}: status=${call.status}`);
      broadcast('call', { status: call.status, callId });

      if (call.status === 'ended') {
        state.callStatus = 'ended';

        // Extract result from call transcript/summary
        const summary = call.summary || call.analysis?.summary || 'Call completed';
        const success = call.analysis?.successEvaluation !== 'false';

        console.log(`[vapi] call ended. Success: ${success}. Summary: ${summary}`);
        broadcast('call', { status: 'ended', success, summary });

        // Inject result back into OpenClaw
        const resultMsg = success
          ? `[System: The phone call to ${details.restaurant} was successful. ${summary}. Tell the user their reservation is confirmed.]`
          : `[System: The phone call to ${details.restaurant} did not go as planned. ${summary}. Tell the user and offer alternatives.]`;

        try {
          await sendToOpenClaw(resultMsg);
        } catch (err) {
          console.error('[openclaw] failed to inject call result:', err.message);
        }
        return;
      }
    } catch (err) {
      console.error('[vapi] poll error:', err.message);
    }
  }

  console.error('[vapi] call polling timed out');
  state.callStatus = 'timeout';
  broadcast('call', { status: 'timeout' });
}

// ─── Dual Audio Output ────────────────────────────────────────────
async function speakResponse(text) {
  const uid = state.lastUid || 'default';

  await Promise.allSettled([
    sendOmiNotification(uid, text),
    speakViaElevenLabs(text),
  ]);
}

async function sendOmiNotification(uid, text) {
  const appId = process.env.OMI_APP_ID;
  const appSecret = process.env.OMI_APP_SECRET;

  if (!appId || !appSecret) {
    console.log('[omi] notification skipped (not configured)');
    return;
  }

  try {
    const url = `https://api.omi.me/v2/integrations/${appId}/notification?uid=${encodeURIComponent(uid)}&message=${encodeURIComponent(text)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${appSecret}` },
    });

    if (!response.ok) {
      console.error(`[omi] notification failed: ${response.status}`);
    } else {
      console.log('[omi] notification sent');
    }
  } catch (err) {
    console.error('[omi] notification error:', err.message);
  }
}

async function speakViaElevenLabs(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    console.log('[elevenlabs] TTS skipped (not configured)');
    return;
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[elevenlabs] TTS failed: ${response.status} ${errText}`);
      return;
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const audioBase64 = audioBuffer.toString('base64');

    console.log(`[elevenlabs] TTS generated (${audioBuffer.length} bytes)`);

    // Send audio to Judge UI for playback
    broadcast('audio', { base64: audioBase64, mimeType: 'audio/mpeg' });
  } catch (err) {
    console.error('[elevenlabs] TTS error:', err.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────
function parseReservationDetails(text) {
  const lower = text.toLowerCase();
  if (!lower.includes('reserv') && !lower.includes('book') && !lower.includes('table')) {
    return null;
  }

  const restaurant = text.match(/(?:at|for)\s+([A-Z][A-Za-z'\s]+?)(?:\s+(?:for|at|to)\s)/)?.[1]?.trim();
  const time = text.match(/(?:at|for)\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/)?.[1];
  const partySize = text.match(/(?:for\s+)?(\d+)\s*(?:people|person|guests?|of us)/)?.[1];

  if (restaurant || time || partySize) {
    return {
      restaurant: restaurant || null,
      time: time || null,
      partySize: partySize ? parseInt(partySize) : null,
    };
  }
  return null;
}

// ─── Health / Debug ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    gateway: gatewayConnected,
    state,
  });
});

// Manual test endpoint - send a command as if from Omi
app.post('/test/command', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  console.log(`[test] command: ${text}`);
  broadcast('command', { text, uid: 'test' });

  try {
    await sendToOpenClaw(text);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual test endpoint - trigger a Vapi call
app.post('/test/call', async (req, res) => {
  const { restaurant, time, partySize, phone } = req.body;
  if (!restaurant || !time || !partySize) {
    return res.status(400).json({ error: 'restaurant, time, partySize required' });
  }
  handleVapiCall({ restaurant, time, partySize, phone });
  res.json({ ok: true, message: 'Call initiated' });
});

// ─── Start ────────────────────────────────────────────────────────
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Kill the other process or use PORT=XXXX`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n  OmiClaw Server running on http://localhost:${PORT}`);
  console.log(`  Tunnel: https://omiclaw.essaylens.app`);
  console.log(`  Gateway: ${GATEWAY_URL}\n`);

  // Connect to OpenClaw Gateway
  connectGateway();
});

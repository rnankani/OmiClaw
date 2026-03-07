// ─── SSE Connection (works through Cloudflare tunnel) ────────────
let es;

function connect() {
  es = new EventSource('/events');

  es.onopen = () => {
    console.log('[sse] connected');
  };

  es.onmessage = (event) => {
    try {
      const { type, data } = JSON.parse(event.data);
      handleMessage(type, data);
    } catch (err) {
      console.error('[sse] parse error:', err);
    }
  };

  es.onerror = () => {
    console.log('[sse] error/disconnected, reconnecting...');
    updateStatus(false);
    es.close();
    setTimeout(connect, 2000);
  };
}

// ─── Message Handlers ─────────────────────────────────────────────
function handleMessage(type, data) {
  switch (type) {
    case 'state':
      applyState(data);
      break;

    case 'status':
      updateStatus(data.connected);
      break;

    case 'transcript':
      handleTranscript(data);
      break;

    case 'command':
      addMessage('system', `"Hey Claw, ${data.text}"`);
      break;

    case 'response':
      // Final response handled via transcript final
      break;

    case 'audio':
      playAudio(data.base64, data.mimeType);
      break;

    case 'photo':
      showPhoto(data.base64);
      break;

    case 'parsed':
      updateParsed(data);
      break;

    case 'call':
      updateCallStatus(data);
      break;

    case 'error':
      addMessage('system', `Error: ${data.message}`);
      break;
  }
}

function applyState(state) {
  updateStatus(state.connected);
  if (state.lastPhoto) showPhoto(state.lastPhoto);
  if (state.lastParsedDetails) updateParsed(state.lastParsedDetails);
  if (state.lastTranscript) {
    addMessage('user', state.lastTranscript);
  }
  if (state.lastResponse) {
    addMessage('assistant', state.lastResponse);
  }
}

// ─── UI Updates ───────────────────────────────────────────────────
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const cameraImg = document.getElementById('camera-img');
const cameraPlaceholder = document.getElementById('camera-placeholder');
const dotGateway = document.getElementById('dot-gateway');
const dotOmi = document.getElementById('dot-omi');
const dotCall = document.getElementById('dot-call');
const callStatusText = document.getElementById('call-status-text');
const callResult = document.getElementById('call-result');

function updateStatus(connected) {
  statusEl.textContent = connected ? 'Connected' : 'Disconnected';
  statusEl.className = `status-text ${connected ? 'connected' : 'disconnected'}`;
  
  const headerDot = document.getElementById('header-status-dot');
  if (headerDot) {
      headerDot.className = `status-dot ${connected ? 'active' : 'disconnected'}`;
  }
  
  if (dotGateway) {
    dotGateway.className = `status-dot ${connected ? 'active' : 'off'}`;
  }
}

let streamingMsgEl = null;

function handleTranscript(data) {
  if (data.role === 'user') {
    // Mark Omi as active
    dotOmi.className = 'status-dot active';
    addMessage('user', data.text);
  } else if (data.role === 'assistant') {
    if (data.streaming) {
      // Update or create streaming message
      if (!streamingMsgEl) {
        streamingMsgEl = document.createElement('div');
        streamingMsgEl.className = 'msg assistant streaming';
        messagesEl.appendChild(streamingMsgEl);
      }
      streamingMsgEl.textContent = data.text;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else {
      // Final message - replace streaming
      if (streamingMsgEl) {
        streamingMsgEl.remove();
        streamingMsgEl = null;
      }
      addMessage('assistant', data.text);
    }
  }
}

function addMessage(role, text) {
  // Remove streaming indicator if present
  if (role === 'assistant' && streamingMsgEl) {
    streamingMsgEl.remove();
    streamingMsgEl = null;
  }

  const msg = document.createElement('div');
  msg.className = `msg ${role}`;
  msg.textContent = text;
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Keep only last 50 messages
  while (messagesEl.children.length > 50) {
    messagesEl.removeChild(messagesEl.firstChild);
  }
}

function showPhoto(base64) {
  cameraPlaceholder.classList.add('hidden');
  cameraImg.classList.remove('hidden');
  // Add data URI prefix if not present
  if (!base64.startsWith('data:')) {
    base64 = `data:image/jpeg;base64,${base64}`;
  }
  cameraImg.src = base64;
}

function updateParsed(data) {
  const rEl = document.getElementById('detail-restaurant');
  const tEl = document.getElementById('detail-time');
  const pEl = document.getElementById('detail-party');

  if (data.restaurant) {
    rEl.textContent = data.restaurant;
    rEl.className = 'detail-value active';
  }
  if (data.time) {
    tEl.textContent = data.time;
    tEl.className = 'detail-value active';
  }
  if (data.partySize) {
    pEl.textContent = `${data.partySize} people`;
    pEl.className = 'detail-value active';
  }
}

function updateCallStatus(data) {
  const { status, summary, success, message } = data;

  switch (status) {
    case 'initiating':
      dotCall.className = 'status-dot calling';
      callStatusText.textContent = 'Phone Call: Initiating...';
      break;

    case 'in-progress':
    case 'ringing':
      dotCall.className = 'status-dot calling';
      callStatusText.textContent = 'Phone Call: In Progress...';
      break;

    case 'ended':
      dotCall.className = `status-dot ${success ? 'active' : 'error'}`;
      callStatusText.textContent = success ? 'Phone Call: Completed' : 'Phone Call: Failed';
      if (summary) {
        callResult.textContent = summary;
        callResult.className = `call-result show ${success ? '' : 'error'}`;
      }
      break;

    case 'error':
      dotCall.className = 'status-dot error';
      callStatusText.textContent = 'Phone Call: Error';
      callResult.textContent = message || 'Unknown error';
      callResult.className = 'call-result show error';
      break;

    case 'timeout':
      dotCall.className = 'status-dot error';
      callStatusText.textContent = 'Phone Call: Timed Out';
      break;

    default:
      callStatusText.textContent = `Phone Call: ${status}`;
  }
}

// ─── Audio Playback ───────────────────────────────────────────────
function playAudio(base64, mimeType) {
  try {
    const audio = new Audio(`data:${mimeType || 'audio/mpeg'};base64,${base64}`);
    audio.volume = 1.0;
    audio.play().catch(err => {
      console.error('[audio] playback failed:', err);
    });
  } catch (err) {
    console.error('[audio] error:', err);
  }
}

// ─── Reasoning Drawer ─────────────────────────────────────────────
const reasoningToggle = document.getElementById('reasoning-toggle');
if (reasoningToggle) {
  reasoningToggle.addEventListener('click', () => {
    const wrapper = document.querySelector('.reasoning-drawer-wrapper');
    if (wrapper.classList.contains('open')) {
      wrapper.classList.remove('open');
    } else {
      wrapper.classList.add('open');
    }
  });
}

document.getElementById('test-send').addEventListener('click', sendTestCommand);
document.getElementById('test-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendTestCommand();
});

async function sendTestCommand() {
  const input = document.getElementById('test-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addMessage('user', text);

  try {
    await fetch('/test/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    addMessage('system', `Send failed: ${err.message}`);
  }
}

// ─── Init ─────────────────────────────────────────────────────────
connect();

// ─── Theme Toggling ───────────────────────────────────────────────
const themeToggleBtn = document.getElementById('theme-toggle');
if (themeToggleBtn) {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

// ─── Easter Egg ───────────────────────────────────────────────────
let typedKeys = '';
const secretWord = 'omiclaw';

document.addEventListener('keydown', (e) => {
  // Ignore typing inside inputs
  if (e.target.tagName.toLowerCase() === 'input') return;

  typedKeys += e.key.toLowerCase();
  
  // Keep only the last N characters where N is length of secretWord
  if (typedKeys.length > secretWord.length) {
    typedKeys = typedKeys.slice(-secretWord.length);
  }

  if (typedKeys === secretWord) {
    document.documentElement.setAttribute('data-theme', 'low-cortisol');
    localStorage.setItem('theme', 'low-cortisol');
    typedKeys = ''; // reset
  }
});

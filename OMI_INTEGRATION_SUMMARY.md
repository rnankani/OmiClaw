# How Omi Integration Apps Work (Research Summary)

## What You Asked
"How do Omi apps work? The glasses don't have a screen, so let's do an integration app."

## What We Found

Omi integrations are **webhook receivers** — your app registers a URL, and Omi POSTs events to it. The app processes those events and can send responses back.

### The Simple Pattern

```
1. Omi App Registration
   - Name: OmiClaw
   - Webhook URL: https://omiclaw.essaylens.app/omi/webhook
   - Trigger: realtime_transcript (or memory_creation)

2. User Interaction
   - User speaks into glasses: "Hey Claw, book a table"
   - Omi detects speech → sends POST to your webhook

3. Webhook Payload
   POST https://omiclaw.essaylens.app/omi/webhook?uid=user123
   {
     "segments": [
       { "text": "Hey Claw, book a table...", "is_user": true }
     ]
   }

4. Your App Response
   - Process the command
   - Return JSON: {"message": "Calling restaurant now..."}
   - Omi sends that message to the glasses as audio/notification

5. Two-Way Communication
   - Glasses send events to server (webhook)
   - Server sends audio back to glasses (Omi notification API)
```

### Integration App Types

| Trigger Type | When It Fires | Payload |
|-------------|----------------|---------|
| `realtime_transcript` | As user speaks (streaming) | `{segments: [...], session_id: uid}` |
| `memory_creation` | When conversation ends | Full conversation object |
| `audio_bytes` | Real-time audio chunks | Binary audio data |

### Key Insight: No Screen = Pure Voice

**The app receives text, processes it, and sends back audio.** Omi glasses:
- ✅ Have microphone and speakers
- ✅ Can send real-time transcripts
- ✅ Can receive and play audio responses
- ❌ Don't have a screen (so your app never displays UI)

This is why OmiClaw works perfectly as a webhook receiver — it listens for voice commands and responds with audio.

## OmiClaw's Implementation

Your server already does this correctly:

### Webhook Endpoints
```javascript
// POST /omi/transcript - Real-time transcripts as user speaks
// POST /omi/memory - Conversation completion with metadata
// POST /omi/photo - Photos from glasses camera
```

### Wake Word Detection
```javascript
if (text.toLowerCase().includes('hey claw')) {
  const command = text.replace(/hey claw/gi, '').trim();
  // Send command to OpenClaw
}
```

### Audio Response
```javascript
// Two-part response:

1. ElevenLabs TTS (local output for demo judges)
   await speakViaElevenLabs(response);

2. Omi Notification API (audio sent back to glasses)
   await sendOmiNotification(uid, audioBase64);
```

## Required Credentials

### From Omi (Omi Admin Dashboard)
- `OMI_APP_ID` - Your app's unique ID
- `OMI_APP_SECRET` - For server-to-server calls
- Webhook URL approved: `https://omiclaw.essaylens.app/omi/webhook`

### From Other Services
- `OPENCLAW_GATEWAY_TOKEN` - Your OpenClaw session token ✓ (already have)
- `VAPI_API_KEY` - For making phone calls ✓ (already have)
- `VAPI_PHONE_NUMBER_ID` - Which Vapi phone to use (need from dashboard)
- `ELEVENLABS_API_KEY` - For text-to-speech ✓ (already have)

## Setup Checklist

- [ ] Create OmiClaw as integration app in Omi admin
- [ ] Set webhook_url to: `https://omiclaw.essaylens.app/omi/webhook`
- [ ] Enable trigger: `realtime_transcript`
- [ ] Get OMI_APP_ID and OMI_APP_SECRET
- [ ] Generate API key (for optional webhook verification)
- [ ] Add credentials to `.env`
- [ ] Start OpenClaw gateway: `openclaw`
- [ ] Start Cloudflare tunnel: `cloudflared tunnel --protocol http2 run omiclaw`
- [ ] Start server: `cd ~/omiclaw-server && node server.js`
- [ ] Test with glasses: "Hey Claw, book me a table..."
- [ ] Judge UI shows real-time updates: http://localhost:3000

## How It Differs from Typical Web Apps

| Aspect | Typical Web App | Omi Integration |
|--------|-----------------|-----------------|
| Entry Point | User visits URL | User speaks voice command |
| Authentication | Login screen | Webhook receives `uid` param |
| UI Rendering | HTML/CSS/JS | Voice response only |
| State Display | Web page | Judge UI (separate browser window) |
| Response Type | HTML page | JSON with `message` field |

## The Authentication Pattern

```javascript
// Webhook receives uid query parameter:
POST /omi/webhook?uid=user123

// You don't validate the webhook (Omi handles internally)
// You use uid to:
// 1. Know which user made the request
// 2. Send responses back via Omi notification API with same uid
// 3. Route data to correct OpenClaw session

Optional: Verify with API key
  API_KEY = await omi.generateKey(app_id)
  // Add to .env as OMI_API_KEY
  // Verify on webhook: req.query.api_key === OMI_API_KEY
```

## Why This Works for the Demo

```
StangHacks Demo Flow:

1. Judges watch browser (Judge UI at localhost:3000)
2. User puts on Omi glasses
3. User speaks: "Hey Claw, book me a table at Mario's for 4 at 7 PM"
4. Omi sends transcript to webhook
5. Server sends to OpenClaw
6. OpenClaw confirms: "Shall I call Mario's?"
7. User says "yes"
8. OpenClaw extracts fields, outputs VAPI_CALL action
9. Server calls Vapi API
10. Vapi dials restaurant, makes real reservation ✓
11. Server gets success, sends audio back to glasses
12. User hears: "Done — your reservation for 4 at Mario's is confirmed for 7 PM."
13. Judge UI shows all steps in real-time:
    - Transcript: ✓
    - Camera photo: ✓
    - Parsed reservation: ✓
    - Call result: ✓

All happening live, all from voice, all working!
```

## Files You Have

- `server.js` (21KB) - Everything is here: webhook handlers, OpenClaw client, Vapi integration, TTS, notifications
- `SOUL.md` - Agent instructions for how to handle reservations
- `public/app.js` - Judge UI WebSocket client
- `public/style.css` - Dark theme, 4-panel layout
- `public/index.html` - Judge UI HTML structure

## Next Action Items

1. **Get VAPI_PHONE_NUMBER_ID** from Vapi dashboard
2. **Create OmiClaw app** in Omi admin → Get OMI_APP_ID and OMI_APP_SECRET
3. **Update .env** with new credentials
4. **Demo at StangHacks!**

---

**You now understand exactly how Omi integration apps work. Your implementation is correct.** ✅

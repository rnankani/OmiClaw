# OmiClaw Integration App Setup Guide

OmiClaw is configured to work as an **Omi External Integration App**. This means Omi sends webhook events to your server, which processes them through OpenClaw and sends responses back to the glasses.

## How It Works

```
Omi Glasses (user speaks "Hey Claw")
        ↓
POST /omi/webhook?uid={uid}  (transcript segments)
        ↓
omiclaw-server (detects "Hey Claw", strips it)
        ↓
OpenClaw Gateway (processes command via websocket)
        ↓
Response with [ACTION:VAPI_CALL] if booking
        ↓
ElevenLabs TTS → speakViaElevenLabs()
Omi Notification API → sendOmiNotification()
Judge UI → broadcast to WebSocket clients
```

## Setup Steps

### 1. Get Your Public URL

OmiClaw needs a public URL that Omi can reach. You're using Cloudflare tunnel:

```bash
# Terminal 1: Start the tunnel
cloudflared tunnel --protocol http2 run omiclaw
# This gives you: https://omiclaw.essaylens.app
```

### 2. Create OmiClaw as an Integration App

In the Omi backend, create a new integration app:

```bash
# You'll need access to Omi admin dashboard or API
# Create app with these settings:

Name: OmiClaw
Category: Utilities & Tools
Description: AI assistant for making phone reservations
Icon: (upload)

External Integration Config:
{
  "webhook_url": "https://omiclaw.essaylens.app/omi/webhook",
  "triggers_on": "realtime_transcript",
  "auth_steps": [
    {
      "type": "oauth",
      "url": "https://your-auth-url/oauth/authorize"
    }
  ]
}
```

### 3. Get Your App Credentials

After creating the app, you'll get:

- **OMI_APP_ID**: The app ID
- **OMI_APP_SECRET**: The secret for server-to-server calls
- **OMI_WEBHOOK_TOKEN**: (Optional) For securing webhooks

Update your `.env`:

```bash
OMI_APP_ID=your_app_id_here
OMI_APP_SECRET=your_app_secret_here
# OMI_WEBHOOK_TOKEN=optional_for_signature_verification
```

### 4. Configure Webhook URL

In the Omi app settings, set the webhook to route to your handler:

```
POST https://omiclaw.essaylens.app/omi/webhook
```

The server has these endpoints:
- `/omi/transcript` - Real-time transcript segments (PRIMARY)
- `/omi/memory` - Conversation completion with photos
- `/omi/photo` - Standalone photos

### 5. Start the Demo Stack

**Terminal 1: OpenClaw Gateway**
```bash
cd ~/openclaw/backend
openclaw  # Should be running on ws://127.0.0.1:18789
```

**Terminal 2: Cloudflare Tunnel**
```bash
cloudflared tunnel --protocol http2 run omiclaw
```

**Terminal 3: OmiClaw Server**
```bash
cd ~/omiclaw-server
PORT=3000 node server.js
```

**Terminal 4: Judge UI**
```bash
# Open in browser: http://localhost:3000
# Shows: Camera feed, transcript, parsed reservation details, call status
```

### 6. Test with Omi Glasses

Put on the glasses and say:
```
"Hey Claw, book me a table at Mario's for 4 at 7 PM"
```

The flow:
1. Omi captures audio, sends transcript to `/omi/transcript`
2. Server detects "Hey Claw" wake word
3. Strips it and sends command to OpenClaw
4. OpenClaw processes via SOUL.md instructions
5. Response includes `[ACTION:VAPI_CALL]{restaurant, time, partySize}[/ACTION]`
6. Server extracts fields, calls Vapi phone API
7. Result sent back to glasses as audio (ElevenLabs TTS)
8. Judge UI updates in real-time

## Webhook Authentication (Optional)

The `uid` query parameter identifies the user. For extra security:

### Option A: API Keys (Recommended)

In Omi admin panel:
```bash
POST /v1/apps/{app_id}/keys
# Returns: sk_xxxxxxxxxxxxxx
```

Add to `.env`:
```bash
OMI_API_KEY=sk_xxxxxxxxxxxxxx
```

In your webhook handler, verify:
```javascript
const apiKey = req.headers['x-omi-api-key'] || req.query.api_key;
if (apiKey !== process.env.OMI_API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### Option B: Webhook Signatures (Advanced)

If Omi provides signature headers:
```javascript
const signature = req.headers['x-omi-signature'];
const hash = crypto
  .createHmac('sha256', process.env.OMI_APP_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex');
if (signature !== hash) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

## Environment Variables Required

```bash
# .env file
PORT=3000

# OpenClaw
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=151d66fc15f1bce269394a33ef2bb2f0d25789215ce4cf35

# Omi
OMI_APP_ID=your_app_id
OMI_APP_SECRET=your_app_secret
# OMI_API_KEY=sk_xxx  (optional, for webhook verification)

# Vapi (Phone Calling)
VAPI_API_KEY=05d750eb-ea6e-44e1-8917-92ccc4b3f88e
VAPI_PHONE_NUMBER_ID=your_phone_number_id  # Get from Vapi dashboard

# ElevenLabs (Text-to-Speech)
ELEVENLABS_API_KEY=sk_fed9e7ca98b8a27fc5b560caf9112f2d0f4b7823e8dcb326
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

## Troubleshooting

### Webhooks not arriving?
1. Check tunnel is running: `cloudflared tunnel --protocol http2 run omiclaw`
2. Verify URL in Omi app settings points to public tunnel URL
3. Check server logs for incoming requests
4. Verify wake word detection with test command (T key on judge UI)

### Audio not playing on glasses?
1. Check ElevenLabs API key is valid
2. Verify OMI_APP_ID and OMI_APP_SECRET in .env
3. Check `sendOmiNotification()` logs in server output

### Vapi calls not working?
1. Confirm VAPI_API_KEY and VAPI_PHONE_NUMBER_ID in .env
2. Check that Vapi API key has phone calling permissions
3. Watch server logs for `handleVapiCall()` debug output

### Integration app not appearing?
1. Ensure app is approved in Omi admin dashboard
2. Check app is enabled for your user
3. Try refreshing Omi app settings

## Next Steps

1. **Get VAPI_PHONE_NUMBER_ID** - Login to Vapi dashboard, copy your phone number ID
2. **Create OmiClaw in Omi admin** - Register as external integration app
3. **Get OMI_APP_ID and OMI_APP_SECRET** - From Omi app creation
4. **Update .env** with all credentials
5. **Start the stack** following Terminal 1-4 above
6. **Test with glasses** at StangHacks 26 demo

## Judge UI Features (Press T to Show Test Controls)

- **Real-time transcript** - Shows what Omi hears
- **Camera feed** - Live photo from glasses
- **Parsed details** - Extracted restaurant, time, party size
- **Status dots** - Gateway connected, Omi active, call in progress
- **Call result** - Success/failure of phone reservation

---

**OmiClaw is ready to demo!** 🎯

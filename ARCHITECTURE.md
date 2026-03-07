# OmiClaw Architecture Overview

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    Omi Smart Glasses                             │
│  (User: "Hey Claw, book a table at Mario's for 4 at 7 PM")      │
└──────────────────────┬──────────────────────────────────────────┘
                       │ POST /omi/webhook?uid={uid}
                       │ {segments: [{text: "Hey Claw, book..."}]}
                       ↓
┌──────────────────────────────────────────────────────────────────┐
│              OmiClaw Server (Node.js + Express)                   │
│                                                                   │
│  1. Receive webhook from Omi                                     │
│  2. Extract transcript segments                                  │
│  3. Detect "Hey Claw" wake word                                 │
│  4. Strip wake word → "book a table at Mario's for 4 at 7 PM"  │
│  5. Send to OpenClaw Gateway                                    │
│                                                                   │
│     ┌────────────────────────────────────────────────┐          │
│     │ OpenClaw Gateway WebSocket Client               │          │
│     │ (ws://127.0.0.1:18789)                         │          │
│     │                                                │          │
│     │ Sends: req:chat.send with command              │          │
│     │ Receives: event:chat with streaming response   │          │
│     └────────────────────────────────────────────────┘          │
│                       │                                          │
│                       ↓                                          │
│     ┌────────────────────────────────────────────────┐          │
│     │ OpenClaw AI Agent (SOUL.md Instructions)       │          │
│     │                                                │          │
│     │ SOUL.md instructs agent to:                    │          │
│     │ - Identify restaurant, time, party size        │          │
│     │ - Ask for missing info if needed              │          │
│     │ - Extract fields when all 3 provided           │          │
│     │ - Confirm before booking                       │          │
│     │ - Output [ACTION:VAPI_CALL]{...}[/ACTION]     │          │
│     └────────────────────────────────────────────────┘          │
│                       │                                          │
│                       ↓                                          │
│  6. Parse response for [ACTION:VAPI_CALL] block                 │
│  7. Extract reservation fields:                                 │
│     { restaurant: "Mario's", time: "7 PM", partySize: 4 }      │
│  8. Call Vapi phone API to book reservation                     │
│     - Vapi agent calls restaurant                               │
│     - Returns success/failure status                            │
│  9. Dual audio output:                                          │
│     a) ElevenLabs TTS → Speech generation                       │
│     b) Omi notification API → Send audio back to glasses        │
│  10. Broadcast to Judge UI via WebSocket                        │
│                                                                   │
│  Judge UI listens on localhost:3000                             │
│  Updates shown in real-time: transcript, camera, call status    │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow for Reservation Booking

```
Input:  "Hey Claw, book me a table at Mario's for 4 at 7 PM"
           ↓
Wake Word Filter: Strip "Hey Claw" prefix
           ↓
Command:  "book me a table at Mario's for 4 at 7 PM"
           ↓
OpenClaw SOUL.md Processing:
  - Extract: restaurant="Mario's", partySize=4, time="7 PM"
  - Confirm: "I'll call Mario's to book a table for 4 at 7 PM. Sound good?"
  - Wait for: User says "yes" / "yeah" / "do it" / etc.
  - Output:  "Calling Mario's now, I'll let you know when it's booked."
             + [ACTION:VAPI_CALL]{"restaurant":"Mario's","time":"7 PM","partySize":4}[/ACTION]
           ↓
Vapi Calling:
  - POST to https://api.vapi.ai/call/phone
  - Agent dials restaurant: +1-555-MARIO-1
  - Says: "Hello, I'm calling to make a reservation for Mario's..."
  - Gets response from restaurant
  - Returns: {success: true, summary: "Reservation for 4 at 7 PM confirmed"}
           ↓
Response to Omi:
  - TTS: "Done — your reservation for 4 at Mario's is confirmed for 7 PM."
  - Send to glasses via Omi notification API
           ↓
Judge UI Update:
  - Display: "Phone Call: Completed"
  - Call result: "Reservation for 4 at 7 PM confirmed"
```

## Key Data Structures

### Omi Webhook (POST /omi/webhook)
```javascript
{
  "segments": [
    {
      "text": "Hey Claw, book me a table",
      "is_user": true,
      "speaker_id": 0,
      "timestamp": 1234567890
    }
  ]
}
```

### OpenClaw Chat Message
```javascript
{
  "sessionKey": "main",
  "message": "book me a table at Mario's for 4 at 7 PM",
  "idempotencyKey": "uuid-4"
}
```

### OpenClaw Response with Action
```
Agent response text:
"Calling Mario's now, I'll let you know when it's booked."
[ACTION:VAPI_CALL]{"restaurant":"Mario's","time":"7 PM","partySize":4}[/ACTION]
```

### Vapi Call Response
```javascript
{
  "id": "call-uuid",
  "status": "ended",
  "success": true,
  "summary": "Successfully booked a table for 4 at Mario's at 7 PM",
  "transcript": "..."
}
```

### Judge UI State Broadcast
```javascript
{
  "type": "state",
  "data": {
    "lastTranscript": "Hey Claw, book me a table at Mario's for 4 at 7 PM",
    "lastPhoto": "base64-image-data",
    "lastResponse": "Calling Mario's now...",
    "lastParsedDetails": {
      "restaurant": "Mario's",
      "time": "7 PM",
      "partySize": 4
    },
    "callStatus": {
      "status": "ended",
      "success": true,
      "summary": "Reservation confirmed"
    },
    "connected": true,
    "lastUid": "user-123"
  }
}
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Omi Glasses | Smart glasses | Captures user voice & camera |
| OmiClaw Server | Node.js + Express | Webhook receiver, orchestrator |
| OpenClaw Gateway | Python WebSocket | AI agent backend |
| SOUL.md | Personality config | Agent instructions for booking |
| Vapi | Phone API | Makes actual phone calls |
| ElevenLabs | TTS API | Converts text to speech |
| Judge UI | HTML5 + WebSocket | Real-time demo dashboard |
| Cloudflare Tunnel | Reverse proxy | Public URL: omiclaw.essaylens.app |

## Deployment Flow

```
Development:
  1. OpenClaw gateway: localhost:18789
  2. OmiClaw server: localhost:3000
  3. Judge UI: localhost:3000 (served by server)
  4. Test via curl or test controls (T key)

Demo (StangHacks):
  1. OpenClaw gateway: Same machine (ws://127.0.0.1:18789)
  2. OmiClaw server: PORT=3000 node server.js
  3. Cloudflare tunnel: cloudflared tunnel run omiclaw
     → Maps localhost:3000 → https://omiclaw.essaylens.app
  4. Omi app registered with webhook: https://omiclaw.essaylens.app/omi/webhook
  5. User puts on glasses, speaks "Hey Claw..."
  6. Live demo to judges via Judge UI browser

Required Environment:
  - OpenClaw gateway running and accessible
  - Node.js server on port 3000 (or configurable via PORT)
  - Cloudflare tunnel running for public HTTPS
  - All API keys in .env: Vapi, ElevenLabs, Omi, OpenClaw token
```

## Error Handling

### If Omi webhooks don't arrive:
- Check public URL is accessible: `curl https://omiclaw.essaylens.app/health`
- Verify tunnel is running: `cloudflared tunnel --protocol http2 run omiclaw`
- Confirm webhook URL in Omi app settings

### If OpenClaw doesn't respond:
- Check gateway connection: "Connected" indicator should be green
- Verify OPENCLAW_GATEWAY_URL and TOKEN in .env
- Check OpenClaw service is running: `openclaw`

### If Vapi calls fail:
- Verify VAPI_API_KEY and VAPI_PHONE_NUMBER_ID in .env
- Check Vapi dashboard for rate limits or quotas
- Look at server logs for Vapi response details

### If TTS doesn't work:
- Verify ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID
- Check ElevenLabs account has API access
- Try test call via curl to verify API key

---

**All components working together = seamless demo of AI-powered booking on smart glasses!**

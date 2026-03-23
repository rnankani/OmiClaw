# ClassFlow

ClassFlow is a single-column, mobile-first AI Agent dashboard designed to run seamlessly in any browser. It bridges Omi Smart Glasses with the OpenClaw architecture, Vapi for AI voice calls, and ElevenLabs for text-to-speech, acting as a complete hub for your personal AI assistant.

## Features

- **Mobile-First & App-Like**: A highly responsive, single-column flex layout designed with an Apple-esque aesthetic using soft ivories, deep greys, and muted gold accents.
- **Real-Time Data Streams**: Built-in support for WebSockets (via OpenClaw Gateway) and Server-Sent Events (SSE) to live stream transcriptions, statuses, and logs.
- **Glassmorphism Sidebar**: Click the prominent floating right-edge tab to slide out the sleek "Reasoning" sidebar, complete with a 24px frosted glass blur. This drawer contains live system statuses for:
  - The OpenClaw Gateway Connection
  - The Omi Glasses Feed
  - AI Phone Call Activity
- **Beautiful Typography**: Clean readability powered by the modern `Outfit` sans-serif font.
- **Multiple Color Themes**:
  - **Cream Light Mode**: Warm ivory surfaces over soft cream backgrounds.
  - **Greyish Dark Mode**: Easy on the eyes at night, featuring dark slates and white typography.
  - **Low Cortisol Mode (Easter Egg)**: Type the secret word `classflow` anywhere on the page to instantly transform the app into a full-screen, leafy, relaxing green environment. The chat remains perfectly readable over a frosted white glass overlay.
- **Integrated Voice/Text Input**: Features a fixed bottom input bar for chatting seamlessly while reading streams above.

## Prerequisites

To run ClassFlow locally, you need a few API keys to power the AI backend services:
- **OpenClaw Gateway Token**
- **Vapi API Key & Phone Number ID**
- **ElevenLabs API Key & Voice ID**
- **Omi App ID & Secret**

## Setup & Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/smaranz/classflow.git
   cd ClassFlow
   ```

2. **Install Dependencies**
   The backend runs on Express and utilizes `ws` for WebSockets and `dotenv` for configuration.
   ```bash
   npm install
   ```

3. **Configure the Environment**
   Create a `.env` file in the root directory by copying the example:
   ```bash
   cp .env.example .env
   ```
   *Fill in your specific API tokens inside the `.env` file.*

4. **Start the Development Server**
   ```bash
   npm run dev
   ```
   The backend API and static file server will spin up on port `3000`.

5. **Open the Dashboard**
   Navigate to `http://localhost:3000` in your browser. Open your browser's Developer Tools and switch to "Device Mode" to see the intended mobile layout.

## Themes & UI Customization

The design system runs purely on CSS variables located at the top of `public/style.css`.
- **Toggle Themes**: Click the Sun/Moon icon in the top right to switch between Cream and Dark modes.
- **Hidden Relaxing Mode**: Type `classflow` (not inside an input field) to activate the leafy, low stress background mode. Type it again or click the Sun/Moon icon to disable it.

## Directory Structure

```
ClassFlow/
├── .env                # Secret API configuration
├── server.js           # Express API and SSE setup
├── package.json        
├── public/             # Static Assets
│   ├── index.html      # Main Dashboard View
│   ├── style.css       # Complete CSS Design System
│   ├── app.js          # Client-side Logic (SSE, Theme Toggling, Sidebar)
│   └── low_cortisol.png # Easter egg background image
```

## Contributions
Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](#) if you want to contribute.

---
*Built to bring your AI to life. Enjoy the lower cortisol.*

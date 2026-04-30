// ============================================================
//  YUKTA — Yugal Healthtech WhatsApp AI Receptionist
//  v3.0 — SessionId based memory (no phone variable needed)
// ============================================================

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// ─────────────────────────────────────────────────────────────
//  SESSION STORE — keyed by sessionId, expires after 60 min
// ─────────────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000; // 60 minutes

function getSession(sessionId) {
  const now = Date.now();
  const existing = sessions.get(sessionId);

  if (existing && now - existing.lastActive > SESSION_TTL_MS) {
    sessions.delete(sessionId);
  }

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      history: [],
      lastActive: now,
      stage: 'new',
      leadSaved: false,
      lead: {
        name: null,
        city: null,
        package: null,
        language: 'English'
      }
    });
  }

  const session = sessions.get(sessionId);
  session.lastActive = Date.now();
  return session;
}

// ─────────────────────────────────────────────────────────────
//  DEDUPLICATION
// ─────────────────────────────────────────────────────────────
const inFlight = new Set();

// ─────────────────────────────────────────────────────────────
//  SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Yukta, the warm and professional AI Health Receptionist for Yugal Healthtech Pvt. Ltd. — India's First Couple Health Platform, based in Nagpur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Warm, caring, professional — like a trusted health advisor
- Keep replies SHORT (3-4 lines max)
- Use emojis naturally: 💚 ✅ 🏥 📍 👫
- Never be pushy. Be genuinely helpful.
- Plain text only — no asterisks, no markdown headers

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE DETECTION — CRITICAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Auto-detect from the user's message. Never ask which language.
- Hindi message → reply in Hindi
- Marathi message → reply in Marathi
- English → reply in English
- Keep same language throughout unless user switches

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PACKAGES — know these perfectly
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Couple Bundle — Rs 5,499 (Best value: both partners tested together)
2. Male Advanced — Rs 3,499 (Comprehensive male health panel)
3. Female Advanced — Rs 3,499 (Comprehensive female health panel)
4. Essential — Rs 1,999 (Core checkup for individuals)

Every package includes — ALWAYS mention this:
✅ FREE doctor consultation
✅ At-home sample collection (we come to you)
✅ NABL certified labs
✅ Reports in 24-48 hours

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When user says hi / START_CONVERSATION:
→ Greet warmly as Yukta from Yugal Healthtech
→ Mention: India's first couple health platform
→ Ask warmly: "Are you looking for a health checkup for yourself, your partner, or both together?"
→ Keep it short and friendly

When user says "Show me your health packages":
→ List all 4 packages with prices
→ Highlight Couple Bundle as best value
→ Ask which one interests them

When user says "I want to book a health test":
→ Ask: self, partner, or both?
→ Recommend the right package
→ Collect details one at a time: Name → Area in Nagpur → Confirm

For any free-text question:
→ Answer helpfully and specifically
→ Gently relate back to booking when natural

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BOOKING COLLECTION — one question at a time
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Order: Full name → Area in Nagpur → Confirm

Booking confirmation:
"Your booking is noted! 💚
Name: [name]
Package: [package]
Area: [area]
Our team will call you shortly to confirm your home collection time."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ALWAYS continue from where conversation left off — never restart
- NEVER ask the same question twice
- NEVER ask two questions in one message
- NEVER mention AI, bot, ChatGPT, or Claude
- "Are you a bot?" → "I'm Yukta, Yugal's health receptionist 😊"
- Off-topic → bring back to health testing gently
- "Talk to human" → "Our team is available at +91 79722 76706 📞"`;

// ─────────────────────────────────────────────────────────────
//  LEAD EXTRACTION
// ─────────────────────────────────────────────────────────────
function extractLeadData(session, userMessage, aiReply) {
  const msg = userMessage.toLowerCase();
  const lead = session.lead;

  // Language
  if (/[\u0900-\u097F]/.test(userMessage)) {
    lead.language = msg.includes('मराठी') ? 'Marathi' : 'Hindi';
  }

  // Package
  if (msg.includes('couple') || msg.includes('5499') || msg.includes('दोनों') || msg.includes('दोघे')) {
    lead.package = 'Couple Bundle - Rs 5,499';
  } else if (msg.includes('male') || msg.includes('man')) {
    if (!lead.package) lead.package = 'Male Advanced - Rs 3,499';
  } else if (msg.includes('female') || msg.includes('women') || msg.includes('woman')) {
    lead.package = 'Female Advanced - Rs 3,499';
  } else if (msg.includes('essential') || msg.includes('1999')) {
    lead.package = 'Essential - Rs 1,999';
  }

  // Stage
  const r = aiReply.toLowerCase();
  if (session.stage === 'new') session.stage = 'chatting';
  if (r.includes('full name') || r.includes('your name') || r.includes('आपका नाम') || r.includes('तुमचे नाव')) {
    session.stage = 'collecting_name';
  }
  if (session.stage === 'collecting_name' && userMessage.length > 1 && userMessage.length < 60 && !msg.includes('package') && !msg.includes('book')) {
    lead.name = userMessage.trim();
    session.stage = 'collecting_city';
  }
  if (session.stage === 'collecting_city' && userMessage.length > 1 && !msg.includes('package') && !msg.includes('book')) {
    lead.city = userMessage.trim();
    session.stage = 'booked';
  }
  if (r.includes('booking is noted') || r.includes('team will call')) {
    session.stage = 'booked';
  }
}

// ─────────────────────────────────────────────────────────────
//  GOOGLE SHEETS
// ─────────────────────────────────────────────────────────────
async function saveLeadToSheets(sessionId, lead, stage) {
  try {
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({ version: 'v4', auth });
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          timestamp,
          sessionId,
          lead.name || '',
          lead.package || '',
          lead.city || '',
          lead.language || 'English',
          stage || ''
        ]]
      }
    });
    console.log(`[SHEETS] Saved — ${sessionId} | ${lead.name} | ${lead.package}`);
  } catch (err) {
    console.error('[SHEETS ERROR]', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  TEAM NOTIFICATION
// ─────────────────────────────────────────────────────────────
async function notifyTeam(sessionId, lead) {
  try {
    const teamNumber = process.env.TEAM_WHATSAPP_NUMBER;
    const apiKey = process.env.AISENSY_API_KEY;
    if (!teamNumber || !apiKey) return;

    await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'yukta_lead_alert',
        destination: teamNumber,
        userName: 'Yukta Bot',
        templateParams: [
          lead.name || 'Unknown',
          sessionId,
          lead.package || 'Not selected',
          lead.city || 'Not provided'
        ]
      })
    });
    console.log(`[TEAM] Notified for ${sessionId}`);
  } catch (err) {
    console.error('[TEAM ERROR]', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  /chat — Main endpoint
// ─────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { userMessage, sessionId: incomingSessionId, userName } = req.body;

  // Reject empty messages
  if (!userMessage || userMessage.trim() === '') {
    console.warn('[WARN] Empty userMessage received');
    return res.status(200).json({ reply: '', sessionId: incomingSessionId || '' });
  }

  // Generate new sessionId if this is the first message
  const sessionId = incomingSessionId && incomingSessionId.trim() !== ''
    ? incomingSessionId.trim()
    : crypto.randomUUID();

  // Deduplication
  if (inFlight.has(sessionId)) {
    console.log(`[DEDUP] Blocked duplicate for ${sessionId}`);
    return res.status(200).json({ reply: '', sessionId });
  }

  inFlight.add(sessionId);

  try {
    const session = getSession(sessionId);
    if (userName && !session.lead.name) session.lead.name = userName;

    // Add user message to history
    session.history.push({ role: 'user', content: userMessage });

    // Keep last 20 messages
    const historySlice = session.history.slice(-20);

    // Call Claude
    const claudeResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: historySlice
    });

    const reply = claudeResponse.content[0]?.text?.trim() ||
      "I had a small hiccup — please try again! 💚";

    // Add reply to history
    session.history.push({ role: 'assistant', content: reply });

    // Extract lead data
    extractLeadData(session, userMessage, reply);

    // Save on booking
    if (session.stage === 'booked' && !session.leadSaved) {
      session.leadSaved = true;
      await saveLeadToSheets(sessionId, session.lead, session.stage);
      await notifyTeam(sessionId, session.lead);
    }

    // Save partial every 10 messages
    if (session.history.length % 10 === 0 && !session.leadSaved) {
      await saveLeadToSheets(sessionId, session.lead, `partial_${session.stage}`);
    }

    console.log(`[CHAT] ${sessionId} | Stage: ${session.stage} | Msgs: ${session.history.length}`);

    // Return reply AND sessionId — AiSensy stores sessionId as attribute
    return res.status(200).json({ reply, sessionId });

  } catch (err) {
    console.error('[ERROR]', err.message);
    return res.status(500).json({
      reply: "I'm having a quick technical moment — please try again! 💚",
      sessionId: incomingSessionId || ''
    });
  } finally {
    inFlight.delete(sessionId);
  }
});

// ─────────────────────────────────────────────────────────────
//  Health check & webhook
// ─────────────────────────────────────────────────────────────
app.post('/webhook', (req, res) => {
  console.log('[WEBHOOK]', JSON.stringify(req.body));
  res.status(200).json({ received: true });
});

app.get('/', (req, res) => {
  res.json({
    status: '💚 Yukta v3.0 is online',
    sessions: sessions.size,
    uptime: Math.round(process.uptime()) + 's',
    time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`💚 Yukta v3.0 live on port ${PORT}`));

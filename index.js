// ============================================================
//  YUKTA — Yugal Healthtech WhatsApp AI Receptionist
//  v3.0 — SessionId based memory (no phone variable needed)
// ============================================================

require('dotenv').config();
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
const SYSTEM_PROMPT = `You are Yugal, the warm and professional AI Health Receptionist for Yugal Healthtech Pvt. Ltd. — India's First Couple Health Platform, based in Nagpur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONALITY & BOUNDARIES (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Warm, caring, professional — like a trusted health advisor
- Keep replies SHORT (3-4 lines max)
- Use emojis naturally: 💚 ✅ 🏥 📍 👫
- Plain text only — no asterisks, no markdown headers
- NEVER answer general knowledge, trivia, coding, or non-health questions. If asked (e.g., "capital of India", "who is PM"), politely say: "I am a health receptionist at Yugal Healthtech and can only assist you with our health checkup services. How can I help you with your health today? 💚"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE DETECTION
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
LOCATION VALIDATION - NAGPUR ONLY (CRITICAL STEP 1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before you can book ANY test, you MUST verify the location. Do NOT proceed to name or package collection until this is verified.
- Ask the user: "Are you from Nagpur? Please share your area name or pincode."
- If the user provides a Pincode: Valid Nagpur pincodes generally start with 440 or 441.
- If the user provides an Area: Check if it sounds like a Nagpur area (e.g., Dharampeth, Sitabuldi, Wardhaman Nagar, Sadar, Itwari, Mahal, Pratap Nagar, Manish Nagar, Somalwada, Besa, Pipla, Nandanvan, Dighori, Manewada, Hudkeshwar, Trimurti Nagar, Laxmi Nagar, Bajaj Nagar, Shankar Nagar, Ramdaspeth, Civil Lines, Khamla, Dhantoli, Gittikhadan, Mankapur, Koradi, Jaripatka, Indora, Kamptee, Hingna, Wadi, Mihan, Butibori, Kalamna, Pardi, Ayodhya Nagar, Sakkardara, Medical Square, Reshimbagh, Cotton Market, Narsala, Narela, etc.)
- If the area or pincode is NOT in Nagpur: Politely say "Currently, our home collection services are only available in Nagpur. We hope to serve you in the future! 💚" and STOP booking.
- If it is in Nagpur: Acknowledge it and move to the next step.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION FLOW & BOOKING ORDER (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You MUST collect details ONE BY ONE. Never ask for everything at once. Never skip a step.
1. Greet & Package Selection: Explain packages and ask which one they want.
2. Area Validation (Nagpur): Ask for area/pincode. WAIT for user reply.
3. Full Name: Ask for their full name. WAIT for user reply.
4. Confirm Booking: Only after area and name are collected.

When user says "I want to book":
→ Say: "Great! First, could you please share your Nagpur area name or pincode to check service availability?" (Do not ask for name yet).

Booking confirmation message MUST be:
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
- NEVER proceed with booking without a confirmed Nagpur area/pincode.
- NEVER mention AI, bot, ChatGPT, or Claude
- "Are you a bot?" → "I'm Yukta, Yugal's health receptionist 😊"
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
    const rawKey = (process.env.GOOGLE_PRIVATE_KEY || '')
      .replace(/^"|"$/g, '')   // strip surrounding quotes if any
      .replace(/\\n/g, '\n');  // convert escaped \n to real newlines
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      rawKey,
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
//  Core Chat Processing Function
// ─────────────────────────────────────────────────────────────
async function processChat(incomingSessionId, userMessage, userName) {
  // Reject empty messages
  if (!userMessage || userMessage.trim() === '') {
    console.warn('[WARN] Empty userMessage received');
    return { reply: '', sessionId: incomingSessionId || '' };
  }

  // Generate new sessionId if this is the first message
  const sessionId = incomingSessionId && incomingSessionId.trim() !== ''
    ? incomingSessionId.trim()
    : crypto.randomUUID();

  // Deduplication
  if (inFlight.has(sessionId)) {
    console.log(`[DEDUP] Blocked duplicate for ${sessionId}`);
    return { reply: '', sessionId };
  }

  inFlight.add(sessionId);

  try {
    const session = getSession(sessionId);
    if (userName && !session.lead.name) session.lead.name = userName;

    // Add user message to history
    session.history.push({ role: 'user', content: userMessage });

    // Keep last 20 messages
    const historySlice = session.history.slice(-20);

    // Call Anthropic Claude
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: historySlice
    });

    const reply = response.content[0]?.text?.trim() ||
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

    return { reply, sessionId };

  } catch (err) {
    if (err.response) {
      console.error('[ERROR] Anthropic API Error:', JSON.stringify(err.response.data));
    } else {
      console.error('[ERROR]', err.stack || err.message);
    }
    return {
      reply: "I'm having a quick technical moment — please try again! 💚",
      sessionId: incomingSessionId || ''
    };
  } finally {
    inFlight.delete(sessionId);
  }
}

// ─────────────────────────────────────────────────────────────
//  /chat — Main endpoint (For Terminal/Testing)
// ─────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { userMessage, sessionId, userName } = req.body;
  const result = await processChat(sessionId, userMessage, userName);
  return res.status(200).json(result);
});

// ─────────────────────────────────────────────────────────────
//  Meta WhatsApp Send Reply
// ─────────────────────────────────────────────────────────────
async function sendMetaReply(to, messageText) {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      console.warn('[META] Token or Phone Number ID missing. Reply not sent.');
      return;
    }

    const response = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: messageText },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[META SEND ERROR]', data);
    } else {
      console.log(`[META] Sent reply to ${to}`);
    }
  } catch (err) {
    console.error('[META SEND ERROR]', err);
  }
}

// ─────────────────────────────────────────────────────────────
//  Meta WhatsApp Webhook Verification (GET)
// ─────────────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[META] Webhook Verified Successfully! ✅');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// ─────────────────────────────────────────────────────────────
//  Meta WhatsApp Incoming Messages (POST)
// ─────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Check if request is from WhatsApp API
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      // WhatsApp requires a 200 OK immediately so it doesn't retry
      res.status(200).send('EVENT_RECEIVED');

      if (messages && messages[0]) {
        const msg = messages[0];

        // Handle Text Messages
        if (msg.type === 'text') {
          const sessionId = msg.from; // User's WhatsApp Number
          const userMessage = msg.text.body;
          const userName = value.contacts?.[0]?.profile?.name || '';

          console.log(`[META INCOMING] ${userName} (${sessionId}): ${userMessage}`);

          // Process the message using Claude
          const result = await processChat(sessionId, userMessage, userName);

          // Send reply back via Meta API
          if (result && result.reply) {
            await sendMetaReply(sessionId, result.reply);
          }
        }
      }
    } else {
      // If it's not a WhatsApp event, return 404
      res.sendStatus(404);
    }
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err);
  }
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

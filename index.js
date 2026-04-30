// ============================================================
//  YUKTA — Yugal Healthtech WhatsApp AI Receptionist
//  Fixed: conversation memory, deduplication, buttons, flow
// ============================================================

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// ─────────────────────────────────────────────────────────────
//  CONVERSATION MEMORY
//  Keyed by phone number. Sessions expire after 30 min idle.
// ─────────────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getSession(phone) {
  const now = Date.now();
  const existing = sessions.get(phone);

  // Clear expired session so conversation restarts cleanly
  if (existing && now - existing.lastActive > SESSION_TTL_MS) {
    sessions.delete(phone);
  }

  if (!sessions.has(phone)) {
    sessions.set(phone, {
      history: [],        // Claude message history [{role, content}]
      lastActive: now,
      stage: 'new',       // new | chatting | collecting | booked
      lead: {             // collected lead data
        name: null,
        phone: null,
        city: null,
        package: null,
        language: 'English'
      },
      leadSaved: false
    });
  }

  const session = sessions.get(phone);
  session.lastActive = Date.now();
  return session;
}

// ─────────────────────────────────────────────────────────────
//  DEDUPLICATION GUARD
//  Prevents double-processing when AiSensy fires twice
// ─────────────────────────────────────────────────────────────
const inFlight = new Set(); // phones currently being processed

// ─────────────────────────────────────────────────────────────
//  YUKTA SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Yukta, the warm and professional AI Health Receptionist for Yugal Healthtech Pvt. Ltd. — India's First Couple Health Platform, based in Nagpur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR PERSONALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Warm, caring, professional — like a trusted health advisor
- Speak simply. No medical jargon.
- Keep replies SHORT (3-4 lines max for greetings and simple answers)
- Use emojis naturally: 💚 ✅ 🏥 📍 👫
- Never be pushy or salesy — be genuinely helpful
- Plain text only — no asterisks, no markdown headers

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE DETECTION (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Detect language FROM the user's message automatically
- If they write in Hindi → respond in Hindi
- If they write in Marathi → respond in Marathi
- If they write in English → respond in English
- NEVER ask "which language do you prefer?" — detect it yourself
- Keep the SAME language throughout the conversation unless user switches

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PACKAGES (memorise these)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Couple Bundle — Rs 5,499 (Best value: both partners together)
2. Male Advanced — Rs 3,499 (Comprehensive male health panel)
3. Female Advanced — Rs 3,499 (Comprehensive female health panel)
4. Essential — Rs 1,999 (Core checkup for individuals)

EVERY package includes — always mention this:
✅ FREE doctor consultation
✅ At-home sample collection (we come to you)
✅ NABL certified labs
✅ Reports in 24-48 hours

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION FLOW — follow this order
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — WELCOME
When user first says hi/hello/start:
Greet warmly as Yukta. Introduce Yugal Healthtech briefly.
Ask ONE question: "Are you looking for a checkup for yourself, your partner, or both together?"
Show the 4 options as a numbered list so they can just reply 1/2/3/4:
  1 - Just me
  2 - My partner
  3 - Both of us together
  4 - I have a question first

STEP 2 — RECOMMEND PACKAGE
Based on their answer, recommend the most suitable package with full details.
Example: "Both together? Perfect — our Couple Bundle at Rs 5,499 is made exactly for this!"
Then ask: "Shall I book this for you?"

STEP 3 — COLLECT BOOKING DETAILS (one question at a time)
Ask in this order, one by one — never ask multiple questions at once:
  a) "Great! What's your full name?"
  b) "And your WhatsApp number?" (if not already known)
  c) "Which area in Nagpur are you from?"

STEP 4 — CONFIRM BOOKING
Repeat all details and confirm:
"Got it! Here's your booking summary:
Name: [name]
Package: [package]
Area: [city]
Our team will call you within a few hours to confirm your at-home collection time. 💚"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULES — never break these
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ALWAYS continue from where conversation left off — never restart
- NEVER ask the same question twice
- NEVER ask multiple questions in one message
- NEVER mention "AI", "bot", "ChatGPT", or "Claude"
- If asked "are you a bot?" → "I'm Yukta, Yugal's health receptionist 😊"
- If user goes off-topic → gently bring back to health testing
- If user says "talk to human" → "Sure! I'll connect you to our team right away. 📞 You can also call/WhatsApp us directly at +91 79722 76706."
- Price questions → always explain what's INCLUDED, not just the number
- If user seems unsure → ask what their main health concern is, then recommend`;

// ─────────────────────────────────────────────────────────────
//  LEAD EXTRACTION (parse session data from conversation)
// ─────────────────────────────────────────────────────────────
function extractLeadData(session, userMessage, aiReply) {
  const msg = userMessage.toLowerCase();
  const lead = session.lead;

  // Language detection
  if (session.stage === 'new') {
    if (/[\u0900-\u097F]/.test(userMessage)) {
      // Devanagari script — Hindi or Marathi
      lead.language = msg.includes('मराठी') || msg.includes('marathi') ? 'Marathi' : 'Hindi';
    } else {
      lead.language = 'English';
    }
  }

  // Package interest detection
  if (msg.includes('couple') || msg.includes('3') && msg.includes('both') || msg.includes('दोनों') || msg.includes('दोघे')) {
    lead.package = 'Couple Bundle - Rs 5,499';
  } else if (msg.includes('male') || msg.includes('man') || msg === '1' || msg.includes('खुद') || msg.includes('self')) {
    if (!lead.package || lead.package.includes('Essential')) lead.package = 'Male Advanced - Rs 3,499';
  } else if (msg.includes('female') || msg.includes('woman') || msg.includes('partner') || msg === '2') {
    lead.package = 'Female Advanced - Rs 3,499';
  } else if (msg.includes('essential') || msg.includes('1999')) {
    lead.package = 'Essential - Rs 1,999';
  }

  // Stage transitions
  if (session.stage === 'new') session.stage = 'chatting';

  const replyLower = aiReply.toLowerCase();
  if (replyLower.includes("what's your full name") || replyLower.includes('your name') || replyLower.includes('आपका नाम') || replyLower.includes('तुमचे नाव')) {
    session.stage = 'collecting_name';
  }
  if (session.stage === 'collecting_name' && userMessage.length > 2 && userMessage.length < 60) {
    lead.name = userMessage.trim();
    session.stage = 'collecting_phone';
  }
  if (replyLower.includes('area') || replyLower.includes('nagpur') || replyLower.includes('location')) {
    if (session.stage === 'collecting_phone') session.stage = 'collecting_city';
  }
  if (session.stage === 'collecting_city' && userMessage.length > 2) {
    lead.city = userMessage.trim();
    session.stage = 'booked';
  }
  if (replyLower.includes('booking summary') || replyLower.includes('our team will call')) {
    session.stage = 'booked';
  }
}

// ─────────────────────────────────────────────────────────────
//  GOOGLE SHEETS — save lead
// ─────────────────────────────────────────────────────────────
async function saveLeadToSheets(phone, lead, stage) {
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
      range: 'Sheet1!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          timestamp,
          phone,
          lead.name || '',
          lead.phone || phone,
          lead.package || '',
          lead.city || '',
          lead.language || 'English',
          stage || ''
        ]]
      }
    });
    console.log(`[SHEETS] Lead saved: ${phone} — ${lead.name} — ${lead.package}`);
  } catch (err) {
    console.error('[SHEETS ERROR]', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  TEAM NOTIFICATION — WhatsApp via AiSensy API
// ─────────────────────────────────────────────────────────────
async function notifyTeam(phone, lead) {
  try {
    const teamNumber = process.env.TEAM_WHATSAPP_NUMBER;
    const apiKey = process.env.AISENSY_API_KEY;
    if (!teamNumber || !apiKey) return;

    const message = `🔔 New Booking Lead from Yukta Bot!

👤 Name: ${lead.name || 'Not collected yet'}
📱 Phone: ${lead.phone || phone}
📦 Package: ${lead.package || 'Not selected yet'}
📍 Area: ${lead.city || 'Not provided'}
🌐 Language: ${lead.language || 'English'}

Please follow up soon! 💚`;

    // Send via AiSensy outbound API (simple text message to team)
    const response = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'yukta_lead_alert',
        destination: teamNumber,
        userName: 'Yukta Bot',
        templateParams: [
          lead.name || 'Unknown',
          lead.phone || phone,
          lead.package || 'Not selected',
          lead.city || 'Not provided'
        ]
      })
    });

    console.log(`[TEAM NOTIFY] Sent for ${phone} — status ${response.status}`);
  } catch (err) {
    console.error('[TEAM NOTIFY ERROR]', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  /chat  — Main endpoint called by AiSensy Flow Builder
// ─────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { userMessage, phone, userName } = req.body;

  // ── Validate input ──────────────────────────────────────────
  if (!userMessage || !phone) {
    console.warn('[WARN] Missing userMessage or phone', req.body);
    return res.status(400).json({ reply: '' });
  }

  const cleanPhone = String(phone).replace(/\D/g, ''); // digits only

  // ── Deduplication: ignore if same phone already processing ──
  if (inFlight.has(cleanPhone)) {
    console.log(`[DEDUP] Blocked duplicate request from ${cleanPhone}`);
    return res.status(200).json({ reply: '' }); // Empty reply = AiSensy shows nothing
  }

  inFlight.add(cleanPhone);

  try {
    const session = getSession(cleanPhone);

    // Enrich session with name from AiSensy contact if available
    if (userName && !session.lead.name) {
      session.lead.name = userName;
    }
    if (!session.lead.phone) {
      session.lead.phone = cleanPhone;
    }

    // ── Add user message to history ─────────────────────────
    session.history.push({ role: 'user', content: userMessage });

    // Keep only last 20 turns to control token usage
    const historySlice = session.history.slice(-20);

    // ── Call Claude with full history ───────────────────────
    const claudeResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: historySlice
    });

    const reply = claudeResponse.content[0]?.text?.trim() || 
                  'Sorry, I had a small hiccup. Please send your message again! 💚';

    // ── Add assistant reply to history ──────────────────────
    session.history.push({ role: 'assistant', content: reply });

    // ── Extract lead data from conversation ─────────────────
    extractLeadData(session, userMessage, reply);

    // ── Save lead at booking confirmation ───────────────────
    if (session.stage === 'booked' && !session.leadSaved) {
      session.leadSaved = true;
      await saveLeadToSheets(cleanPhone, session.lead, session.stage);
      await notifyTeam(cleanPhone, session.lead);
    }

    // ── Also save partial lead every 5 messages (lead magnet)─
    if (session.history.length % 10 === 0 && !session.leadSaved) {
      await saveLeadToSheets(cleanPhone, session.lead, `partial_${session.stage}`);
    }

    console.log(`[CHAT] ${cleanPhone} | Stage: ${session.stage} | History: ${session.history.length} msgs`);

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('[CHAT ERROR]', err.message || err);
    return res.status(500).json({
      reply: 'I\'m having a quick technical moment — please try again! 💚'
    });
  } finally {
    // Always release the dedup lock
    inFlight.delete(cleanPhone);
  }
});

// ─────────────────────────────────────────────────────────────
//  /webhook  — Receive AiSensy events (optional / future use)
// ─────────────────────────────────────────────────────────────
app.post('/webhook', (req, res) => {
  console.log('[WEBHOOK]', JSON.stringify(req.body, null, 2));
  res.status(200).json({ received: true });
});

// ─────────────────────────────────────────────────────────────
//  /health  — UptimeRobot keepalive ping
// ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: '💚 Yukta is online',
    sessions: sessions.size,
    uptime: Math.round(process.uptime()) + 's',
    time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  });
});

// ─────────────────────────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`💚 Yukta server live on port ${PORT}`);
});

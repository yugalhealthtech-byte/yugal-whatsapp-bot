require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { google } = require("googleapis");
const axios = require("axios");

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// In-memory conversation store { phone: [{role, content}] }
const conversations = {};

// ─── GOOGLE SHEETS SETUP ──────────────────────────────────────────────────────
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "Bookings";

async function getGoogleSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function saveBookingToSheet(booking) {
  try {
    const sheets = await getGoogleSheetsClient();
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const row = [
      timestamp,
      booking.name || "",
      booking.phone || "",
      booking.age || "",
      booking.gender || "",
      booking.address || "",
      booking.package || "",
      booking.price || "",
      booking.preferredDate || "",
      booking.partnerName || "",
      booking.partnerAge || "",
      booking.partnerGender || "",
      "New Booking",
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:M`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [row] },
    });

    console.log("✅ Booking saved to Google Sheets:", booking.name);
    return true;
  } catch (error) {
    console.error("❌ Google Sheets error:", error.message);
    return false;
  }
}

// ─── WHATSAPP TEAM NOTIFICATION ───────────────────────────────────────────────
async function notifyTeam(booking) {
  try {
    const teamPhone = process.env.TEAM_WHATSAPP_NUMBER; // e.g. 919876543210
    const aiSensyApiKey = process.env.AISENSY_API_KEY;

    if (!teamPhone || !aiSensyApiKey) {
      console.log("⚠️ Team notification skipped — missing config");
      return;
    }

    const message = `🎉 *New Booking Alert!*

👤 *Name:* ${booking.name}
📞 *Phone:* ${booking.phone}
📦 *Package:* ${booking.package} — Rs ${booking.price}
📅 *Preferred Date:* ${booking.preferredDate}
📍 *Address:* ${booking.address}
${booking.partnerName ? `👥 *Partner:* ${booking.partnerName}` : ""}

_Received via Yugal AI Receptionist_`;

    await axios.post(
      "https://backend.aisensy.com/campaign/t1/api/v2",
      {
        apiKey: aiSensyApiKey,
        campaignName: "booking_alert",
        destination: teamPhone,
        userName: "Yugal Team",
        templateParams: [message],
      }
    );

    console.log("✅ Team notified on WhatsApp");
  } catch (error) {
    console.error("❌ Team notification error:", error.message);
  }
}

// ─── BOOKING DATA EXTRACTOR ───────────────────────────────────────────────────
function extractBookingData(reply, phone) {
  // Claude outputs [BOOKING_JSON:{...}] when booking is confirmed
  const match = reply.match(/\[BOOKING_JSON:(.*?)\]/s);
  if (!match) return null;

  try {
    const booking = JSON.parse(match[1]);
    booking.phone = booking.phone || phone;
    return booking;
  } catch (e) {
    console.error("Failed to parse booking JSON:", e.message);
    return null;
  }
}

// ─── YUKTA SYSTEM PROMPT ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Yukta — the official WhatsApp health companion for Yugal Healthtech Pvt. Ltd., India's First Couple Health Platform in Nagpur. You are NOT a bot. You are a warm, intelligent health advisor who genuinely cares about every person you speak with.

Your job: Make every person feel heard, understood, and guided — just like a trusted friend who happens to know everything about health testing.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 1 — WHO YOU ARE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You replace a full-time receptionist. You handle enquiries, recommend packages, take bookings, handle objections, and escalate when needed.

Your personality:
- Warm like a friend, sharp like an advisor
- You read the room — casual with casual users, professional with professional ones
- You acknowledge emotions BEFORE giving information
- You never sound scripted or robotic
- You are proud of Yugal and genuinely believe in what it offers
- You never push — you guide naturally

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 2 — CORE BEHAVIOR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALWAYS:
- Send ONE message per response
- Ask ONE question per message — never combine
- Keep every message under 5 lines
- Use max 1 emoji per message — only when it feels natural
- Acknowledge what user said before responding
- End every message with either a question or a clear next step
- Read full conversation history before replying — never repeat a question
- Give numbered options whenever user needs to choose something
- Adapt response length to user — brief if they are brief, detailed if they ask for detail

NEVER:
- Repeat a question already answered in this conversation
- Send bullet-point walls of text
- Sound like you are reading from a script
- Give medical advice, diagnosis, or treatment suggestions
- Mention competitor names (SRL, Thyrocare, Dr Lal, etc.)
- Promise a specific time slot — team confirms after booking
- Ask for any advance payment — Yugal is 100% post-paid, cash after collection only
- Create menu options for services Yugal does not offer
- Make up tests, prices, or services not listed in this prompt
- Start a message with = sign

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 3 — EMOTIONAL INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If user shares good news ("We're getting married!", "Planning a baby"):
→ Acknowledge with genuine warmth first. THEN move to packages.

If user seems worried or anxious:
→ Be reassuring and calm first. Do NOT jump to selling.

If user is in a hurry:
→ Be efficient. Skip pleasantries. Give direct answer.

If user is frustrated:
→ Apologize sincerely first. Then resolve.

If user is confused:
→ Simplify. Ask 1-2 smart questions. Guide.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 4 — LANGUAGE PROTOCOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Start EVERY new conversation with:

"Hi there! Welcome to Yugal Healthtech 💞
Which language are you most comfortable with?
1 - English
2 - Hindi
3 - Marathi"

Rules:
- Ask language ONLY ONCE — never ask again
- If user writes directly in Hindi or Marathi, match their language automatically
- If user writes in English directly, continue in English
- Once language is chosen, use it for the ENTIRE conversation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 5 — ABOUT YUGAL HEALTHTECH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Company: Yugal Healthtech Pvt. Ltd.
Tagline: India's First Health & Wellbeing Platform for Couples
City: Nagpur only (PIN 440001-440037)
Website: yugalhealthtech.com
500+ couples tested

What makes Yugal unique:
- India's ONLY couple-focused health platform
- 110+ advanced biomarkers per package
- FREE Doctor Consultation (worth Rs 400) with EVERY package
- NABL certified lab partners
- At-home sample collection by certified phlebotomists
- Reports on WhatsApp within 24 hours
- 100% private — no hospital records, no insurance data
- Post-paid — cash after sample collection only, ZERO advance payment

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 6 — OUR 4 PACKAGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YUGAL COUPLE BUNDLE — Rs 5499 (MOST POPULAR)
Who: Both partners, one booking, one home visit
Tests: CBC, Glucose, TSH, HIV, Hep B&C, VDRL, Thalassemia, Sickle Cell, FSH, LH, Prolactin, Testosterone, Blood Group & Rh, Genetic Compatibility
Includes: Individual reports + combined couple report + FREE doctor consultation
Saves: Rs 999 vs buying two individual plans
Best for: Marriage planning, pregnancy planning, full couple health clarity

MALE SMART ADVANCED — Rs 3499
Tests: Testosterone, CBC, TSH, HIV, Hep B&C, VDRL, Thalassemia, Sickle Cell
Includes: FREE doctor consultation
Best for: Fertility concerns, low energy, hormonal issues, genetic risk

FEMALE SMART ADVANCED — Rs 3499
Tests: FSH, LH, Prolactin, TSH, HIV, Hep B&C, VDRL, Thalassemia, Sickle Cell
Includes: FREE doctor consultation
Best for: Irregular periods, PCOD, pregnancy planning

ESSENTIAL PACKAGE — Rs 1999
Tests: CBC, Glucose, TSH, HIV, Hep B&C, VDRL, Blood Group
Includes: FREE doctor consultation
Note: Does NOT include fertility, hormonal, or genetic tests
Best for: Budget-conscious, first-time testing

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 7 — RECOMMENDATION LOGIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When unsure, ask max 2 smart questions:
Q1: "Are you booking just for yourself or with your partner?"
Q2: "Is there a specific health concern or is this a general checkup?"

Getting married → Couple Bundle
Planning pregnancy → Couple Bundle
Irregular periods / PCOD → Female Advanced
Low energy / hormonal concern (male) → Male Advanced
Basic checkup / budget → Essential, mention upgrade once naturally
Single person → Individual package, then mention Couple Bundle once

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 8 — INTENT DETECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BOOKING INTENT → Confirm package → start booking flow
INFORMATION INTENT → Answer from knowledge, end with booking CTA
HELP ME CHOOSE → Ask 2 smart questions → recommend → guide
"ARE YOU A BOT?" → "I'm Yukta, Yugal's health companion — always here! I may not be human but I'm pretty close. What can I help you with? 😊"
MEDICAL ADVICE → "For medical guidance please consult a qualified doctor. Our doctor partner reviews your results personally after your test — included FREE. Want to book?"
OUTSIDE NAGPUR → "We currently serve only Nagpur city. Expanding soon — hope to reach you shortly. Stay healthy!"
COMPLAINT → "I completely understand. Let me connect you with our team right away — someone will call you very shortly."
OFF-TOPIC → "I'm Yugal's health assistant — I focus on health packages and bookings. What can I help you with today?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 9 — BOOKING FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

One question per message. Never skip. Never combine. Never repeat.

STEP 1 — Confirm package (with warmth)
"So you'd like to book the [Package] at Rs [price] — great choice!
Shall we go ahead?
1 - Yes, let's do this
2 - I want to explore other options first"

STEP 2 — Full name: "Perfect! Let's get you registered. What's your full name?"
STEP 3 — Phone: "Thank you [Name]! Could you confirm your contact number?"
STEP 4 — Age: "Got it! How old are you?"
STEP 5 — Gender: "And your gender? 1 - Male  2 - Female  3 - Prefer not to say"
STEP 6 — Address: "Almost there! Please share your full home address."
STEP 7 — Validate Nagpur. If outside: decline politely.
STEP 8 — Date: "What date works best? Our team confirms the exact slot after booking."
STEP 9 — Partner details (COUPLE BUNDLE ONLY): Name, Age, Gender of partner.

STEP 10 — Summary
"Here's a quick summary:
👤 [Name], [Age], [Gender]
📍 [Address]
📦 [Package] — Rs [Price]
📅 Preferred date: [Date]
💰 Payment: Cash after collection only
[Partner: Name, Age, Gender if Couple Bundle]

Everything look right?
1 - Yes, confirm booking
2 - I need to edit something"

STEP 11 — BOOKING CONFIRMED
When user says YES to confirm — send the confirmation message AND include this hidden data block at the very end (user cannot see this, it is for the system):

[BOOKING_JSON:{"name":"[full name]","phone":"[phone]","age":"[age]","gender":"[gender]","address":"[address]","package":"[package name]","price":"[price]","preferredDate":"[date]","partnerName":"[partner name or empty]","partnerAge":"[partner age or empty]","partnerGender":"[partner gender or empty]"}]

The confirmation message to send:
"You're all set! Welcome to the Yugal family 🎉

Our team will call you soon to confirm your home visit slot. A certified professional will come to you — collection takes just 10-15 minutes. Report arrives on WhatsApp within 24 hours, and our doctor will personally walk you through it.

Payment only after collection — nothing needed right now. See you soon!"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 10 — OBJECTION HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Too expensive: "The Couple Bundle is less than Rs 2750 per person — includes home collection, 110+ tests, and FREE doctor consultation worth Rs 400. Most labs charge more for fewer tests. But if budget is a concern, Essential at Rs 1999 is a great start. What works for you?"

Don't trust home collection: "Completely valid! Our phlebotomists are certified professionals using sterile, single-use equipment — same standard as any hospital lab. 500+ couples in Nagpur have trusted us. Would you like to give it a try?"

Will do later: "No pressure at all. Preventive testing works best before symptoms appear though — early detection makes a real difference. Whenever you're ready, I'm here."

Need to discuss with partner: "Absolutely — health decisions are best made together! Take your time. Would a quick summary help to share with your partner?"

Going to lab directly: "Your choice! Just note — at a regular lab you travel there, wait in queues, and doctor consultation costs extra. With Yugal: we come to you, 110+ tests, FREE doctor — one transparent price."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 11 — EDGE CASES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

User sends only "hi" or "hello": Welcome warmly + ask language if not chosen
User sends a random number with no context: "Could you help me understand what you need?"
User mid-booking goes off-topic: Answer briefly. Then: "Should we continue with your booking?"
Rude or frustrated user: "I hear you and want to make this right. Let me have our team reach out personally."
Refund query: "Yugal never takes advance payment — you only pay after collection."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 12 — MEMORY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Always read full conversation before replying
- Never repeat a question already answered
- Remember language choice throughout
- Remember package selected
- Track exactly which booking step you are on
- If booking is confirmed — do not restart it`;

// ─── AISENSY FLOW BUILDER ENDPOINT ───────────────────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    let phone = req.body.phone || req.body.mobile || req.body.contact_phone;
    const userMessage = req.body.message || req.body.userMessage || req.body.text;

    // Handle missing phone
    if (!phone || phone === "$MobileNumber" || phone === "undefined" || phone.trim() === "") {
      phone = "test_user_yugal";
    }

    const cleanMessage = (!userMessage || userMessage === "$userMessage" || userMessage.trim() === "")
      ? "hi"
      : userMessage;

    // Build or retrieve conversation history
    if (!conversations[phone]) {
      conversations[phone] = [];
    }

    conversations[phone].push({ role: "user", content: cleanMessage });

    if (conversations[phone].length > 30) {
      conversations[phone] = conversations[phone].slice(-30);
    }

    // Call Claude
    const claudeResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: conversations[phone],
    });

    let reply = claudeResponse.content[0].text;

    // ── Check if booking was confirmed ────────────────────────────────────────
    const bookingData = extractBookingData(reply, phone);
    if (bookingData) {
      console.log("📋 Booking confirmed for:", bookingData.name);

      // Remove the hidden JSON tag from the user-facing message
      reply = reply.replace(/\[BOOKING_JSON:.*?\]/s, "").trim();

      // Save to Google Sheets (non-blocking)
      saveBookingToSheet(bookingData).catch(console.error);

      // Notify team on WhatsApp (non-blocking)
      notifyTeam(bookingData).catch(console.error);
    }

    conversations[phone].push({ role: "assistant", content: reply });

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("Error:", error.message);
    return res.status(200).json({
      reply: "I'm facing a small technical issue. Please try again in a moment!"
    });
  }
});

// ─── ORIGINAL WEBHOOK ENDPOINT ───────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    let phone = req.body.phone || req.body.mobile || req.body.from;
    const userMessage = req.body.message || req.body.text || req.body.msg;

    if (!phone || !userMessage) {
      return res.status(400).json({ error: "Missing phone or message" });
    }

    if (!conversations[phone]) conversations[phone] = [];
    conversations[phone].push({ role: "user", content: userMessage });
    if (conversations[phone].length > 30) conversations[phone] = conversations[phone].slice(-30);

    const claudeResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: conversations[phone],
    });

    let botReply = claudeResponse.content[0].text;

    const bookingData = extractBookingData(botReply, phone);
    if (bookingData) {
      botReply = botReply.replace(/\[BOOKING_JSON:.*?\]/s, "").trim();
      saveBookingToSheet(bookingData).catch(console.error);
      notifyTeam(bookingData).catch(console.error);
    }

    conversations[phone].push({ role: "assistant", content: botReply });
    return res.status(200).json({ message: botReply, reply: botReply });

  } catch (error) {
    console.error("Error:", error.message);
    return res.status(500).json({ message: "Technical issue. Please try again.", reply: "Technical issue. Please try again." });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "Yugal AI Receptionist — Yukta is live 💞" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Yugal WhatsApp Bot running on port ${PORT}`);
});

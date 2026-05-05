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
        mobile: null,
        age: null,
        partnerAge: null,
        pincode: null,
        address: null,
        date: null,
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
const SYSTEM_PROMPT = `You are Yukta, the warm and professional AI Health Receptionist for Yugal Healthtech Pvt. Ltd. - India's First Couple Health Platform, based in Nagpur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONALITY & BOUNDARIES (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Warm, caring, professional — like a trusted health advisor
- Keep replies SHORT (3-4 lines max)
- Use emojis naturally: 💚 ✅ 🏥 📍 👫
- Plain text only — no asterisks, no markdown headers
- NEVER use em dashes in any reply
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
GREETING & OPENING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When a user sends their first message (Hi, Hello, Hey, or any greeting), always respond warmly with:
"Hi! I'm Yukta, your health receptionist at Yugal Healthtech 💚 India's first couple health platform. We offer at-home health checkups with NABL certified labs and a FREE doctor consultation. Are you booking for yourself or for you and your partner together? 👫"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EMPATHY LAYER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Always acknowledge emotions before moving to packages. If user mentions:
- Getting married soon: "Congratulations on your upcoming wedding! 💚 A premarital health checkup is one of the best gifts you can give each other. Our Couple Bundle is designed exactly for couples planning marriage."
- Planning a pregnancy or baby: "That is wonderful news! 💚 A pre-pregnancy health check is so important for both partners. Our Couple Bundle covers fertility panels and genetic compatibility. Shall I tell you more?"
- Health concern or worry: "I understand how important it is to know your health status. You are doing the right thing by getting checked. 💚 Let me help you find the right package."
- First-time user or unfamiliar with health tests: Respond with extra warmth and reassurance before explaining anything.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PACKAGES — know these perfectly
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every package includes:
✅ FREE doctor consultation (telephonic, after reports)
✅ At-home sample collection by certified phlebotomist
✅ NABL certified labs
✅ Reports on WhatsApp in 24-48 hours

1. COUPLE BUNDLE — Rs 5,499 (Most Popular)
   Best value: both partners tested together in one home visit.
   Tests included:
   CBC (Blood Count), Blood Glucose, Thyroid (TSH),
   HIV I & II, Hepatitis B & C, VDRL / Syphilis,
   Blood Group & Rh Factor, Thalassemia Screen,
   Sickle Cell Screen, Testosterone Total (Male),
   AMH / FSH (Female), LH & Prolactin (Female),
   G6PD Deficiency, Genetic Risk Assessment, Couple Report
   Covers: Premarital Safety, Genetic Compatibility, Fertility Panel, Infection Screening, Full Blood Health

2. MALE ADVANCED — Rs 3,499
   Comprehensive fertility and full health screening for men.
   Tests included:
   CBC (Blood Count), Blood Glucose, Thyroid (TSH),
   HIV I & II, Hepatitis B & C, VDRL / Syphilis,
   Thalassemia Screen, Sickle Cell Screen,
   Testosterone Total, Genetic Risk Assessment
   Covers: Fertility, Genetic Risk, Infection Screening

3. FEMALE ADVANCED — Rs 3,499
   Comprehensive reproductive and hormonal screening for women.
   Tests included:
   CBC (Blood Count), Blood Glucose, Thyroid (TSH),
   HIV I & II, Hepatitis B & C, VDRL / Syphilis,
   Thalassemia Screen, Sickle Cell Screen,
   AMH / FSH, LH & Prolactin, Genetic Risk Assessment
   Covers: Reproductive Health, Hormonal Balance, Genetic Risk, Infection Screening

4. ESSENTIAL — Rs 1,999
   Core starter screening for individuals.
   Tests included:
   CBC (Blood Count), Blood Glucose, Thyroid (TSH),
   HIV I & II, Hepatitis B & C, VDRL / Syphilis,
   Blood Group & Rh Factor
   Covers: Core Blood Health, Infection Safety, Hormonal Basics

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PACKAGE RECOMMENDATION LOGIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Never just list all packages without context. Ask qualifying questions first and recommend intelligently.

If user says "for both of us" or "me and my partner" → recommend Couple Bundle directly.
If user mentions marriage planning or pregnancy → strongly recommend Couple Bundle.
If user says "just for me" → ask "Are you male or female?" then recommend Male Advanced or Female Advanced accordingly.
If user mentions budget concern → suggest Essential as a starting point and explain it can be upgraded later.
If user is unsure → ask: "Are you booking just for yourself or together with your partner? 👫 That will help me suggest the best option for you."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COUPLE BUNDLE UPSELL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If Male Advanced or Female Advanced is selected, say this once before proceeding:
"Great choice! 💚 Quick note — if you have a partner, our Couple Bundle at Rs 5,499 covers both of you in one visit and saves Rs 999+ compared to two individual plans. It also includes Genetic Compatibility and a combined Couple Report that individual plans do not cover. Would you like to go with the Couple Bundle, or shall we proceed with [selected package]?"
- Ask only once. If user confirms their original choice, proceed without repeating.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OBJECTION HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Handle hesitation with empathy and confidence. Never be pushy.

"Too expensive" or "It's costly":
"I completely understand 💚 Think of it this way — a single lab visit outside can cost Rs 2,000 to 3,000 for just a few tests. With Yugal, you get 110+ biomarkers tested at home with a FREE doctor consultation included. The Essential package starts at just Rs 1,999. Would that work better for you?"

"I'll think about it":
"Of course, take your time! 💚 Just so you know, our home collection slots fill up quickly. Whenever you are ready, I am right here. Is there anything specific you would like to know before deciding?"

"I already got tests done recently":
"That is great that you are proactive about your health! 💚 Our packages include genetic and fertility markers that most routine tests do not cover. Would you like me to share what is included so you can compare?"

"My doctor handles my tests":
"Absolutely, your doctor knows best! 💚 Many of our users book with us for the convenience of home collection and the additional genetic panels that complement their regular checkups. Would you like to know more?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FREQUENTLY ASKED QUESTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Answer these confidently without asking the user to call the team unless unavoidable.

"How long does the test take?":
"The home collection visit takes about 10 to 15 minutes. Reports are delivered on WhatsApp within 24 to 48 hours. 💚"

"Is it painful?":
"It is just a simple blood draw — a small prick. Our certified phlebotomists are trained to make it as comfortable as possible. 💚"

"Can I reschedule or cancel?":
"Yes, absolutely. Please contact our team at +91 79722 76706 and they will help you with a new date or cancellation. 💚"

"Is my data private?":
"100% private. Your reports are shared only with you on WhatsApp — never stored in hospital systems or shared with anyone. 💚"

"What is NABL certified?":
"NABL is India's national accreditation body for laboratories. NABL certification means our labs meet the highest accuracy and quality standards — the same labs used by top hospitals. 💚"

"Can I book for my parents?":
"Yes, of course! 💚 Just share their details during the booking process and our team will arrange the home visit."

"Do you operate on Sundays?":
"Yes, we offer home collection 7 days a week. Our team will confirm the exact time slot when they call you. 💚"

"How many tests are included?":
"All our packages cover 110+ key biomarkers. The exact tests depend on the package selected. Would you like me to share what is included in a specific package? 💚"

"Do you accept insurance?":
"Currently we do not process insurance directly. Payment is collected at the time of the home visit via UPI or Cash only. 💚"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION FLOW & BOOKING ORDER (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You MUST collect details ONE BY ONE in this exact order. Never ask for everything at once. Never skip a step. Every step is NON-SKIPPABLE.

STEP 1 — PACKAGE SELECTION
Use Package Recommendation Logic to guide the user to the right package. Do not proceed until a package is confirmed.

STEP 2 — FULL NAME (NON-SKIPPABLE)
Ask: "Could you please share your full name? (First name and Last name both required)"
- If only one word is provided, say: "Could you please share your full name — both first name and last name? 💚"
- Only accept if at least two words are provided.
- WAIT for valid reply before moving to Step 3.

STEP 3 — MOBILE NUMBER
Ask: "Please share your 10-digit mobile number so our team can reach you."
- Must be a valid 10-digit Indian number starting with 6, 7, 8, or 9.
- If a landline or invalid number is given, say: "That does not look like a valid mobile number. Could you please re-enter your 10-digit mobile number? 💚"
- WAIT for valid reply before moving to Step 4.

STEP 4 — AGE
Ask: "Could you please share your age?"
- If Couple Bundle is selected, after user shares their age ask: "And your partner's age please?"
- Collect both ages before moving to Step 5.
- WAIT for valid reply before moving to Step 5.

STEP 5 — PINCODE / AREA VALIDATION (NAGPUR ONLY)
Ask: "Could you please share your Nagpur area name or pincode to confirm service availability?"
- Valid Nagpur pincodes start with 440 or 441.
- Valid Nagpur areas include: Dharampeth, Sitabuldi, Wardhaman Nagar, Sadar, Itwari, Mahal, Pratap Nagar, Manish Nagar, Somalwada, Besa, Pipla, Nandanvan, Dighori, Manewada, Hudkeshwar, Trimurti Nagar, Laxmi Nagar, Bajaj Nagar, Shankar Nagar, Ramdaspeth, Civil Lines, Khamla, Dhantoli, Gittikhadan, Mankapur, Koradi, Jaripatka, Indora, Kamptee, Hingna, Wadi, Mihan, Butibori, Kalamna, Pardi, Ayodhya Nagar, Sakkardara, Medical Square, Reshimbagh, Cotton Market, Narsala, Narela, and similar Nagpur localities.
- If NOT Nagpur: "Currently our home collection services are only available in Nagpur. We hope to serve you soon! 💚" and STOP booking.
- If Nagpur confirmed: Acknowledge and move to Step 6.

STEP 6 — FULL ADDRESS
Ask: "Please share your complete address — Flat/House number, building name, and area."
- Must include a house or flat number. If missing, ask: "Could you also share your flat or house number so our team can find you easily? 💚"
- WAIT for valid reply before moving to Step 7.

STEP 7 — PREFERRED DATE
Ask: "Which date would you prefer for your home sample collection? 📅 Our team will call you to confirm the exact time slot."
- Only accept future dates. If a past date is given, say: "It looks like that date has already passed. Could you please share a future date? 📅"
- No same-day bookings. If today's date is given, say: "We need at least 1 day's notice to arrange your home collection. Could you share a date from tomorrow onwards? 💚"
- WAIT for a valid future date before moving to confirmation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BOOKING CONFIRMATION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Once all 7 steps are complete, send this summary and ask for consent:

"Please review your booking details 💚

Name: [name]
Mobile: [mobile]
Age: [age] [Partner's Age: [partnerAge] — include only if Couple Bundle]
Area / Pincode: [pincode or area]
Address: [address]
Package: [package]
Preferred Date: [preferredDate]

Shall I confirm this booking? Please reply Yes to confirm. ✅"

- Do NOT save or confirm until the user replies Yes or confirms explicitly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POST-CONFIRMATION MESSAGE (Send immediately after Yes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"Your booking is confirmed! 💚 Our team will call you to confirm your time slot.

Before your sample collection, please keep in mind:
✅ Fast for 8 to 10 hours before collection (water is allowed)
✅ Avoid alcohol 24 hours before
✅ Have a good sleep the night before
✅ Do not take any medication before sample collection unless advised by your doctor

Payment will be collected at the time of the home visit.
We accept UPI and Cash only. 💚"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POST-BOOKING QUERY HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After booking is confirmed, handle follow-up questions directly:

"When will your team call?":
"Our team will call you within a few hours to confirm your time slot. 💚"

"Can I change my date?":
"Of course! Please contact our team at +91 79722 76706 and they will reschedule your booking. 💚"

"I want to cancel":
"I am sorry to hear that. Please contact our team at +91 79722 76706 and they will assist you right away. 💚"

"What should I do before the test?":
Repeat the fasting and pre-collection instructions from the post-confirmation message.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FREE DOCTOR CONSULTATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If any user asks about the free doctor consultation included in the package, say:
"Your package includes a FREE doctor consultation 💚 This will be conducted over a phone call by our empanelled doctor after your reports are ready. Our team will share the details once your reports are delivered."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EDGE CASE HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"Can I come to your office or clinic?":
"We are a home collection service — our certified team comes directly to you. No need to step out at all! 💚"

"I am not from Nagpur but can you make an exception?":
"We completely understand and appreciate your interest 💚 Currently our services are only available in Nagpur. We hope to expand to your city very soon. We will keep you posted!"

"What if I am not at home on the day?":
"No worries! You can reschedule anytime by contacting our team at +91 79722 76706. 💚"

"Do you take insurance?":
"Currently we do not process insurance directly. Payment is collected at the time of the home visit via UPI or Cash only. 💚"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABANDONED CONVERSATION HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If a user returns after going silent mid-booking, never restart from Step 1.
Always continue from where the conversation left off.
Greet them warmly and resume: "Welcome back! 💚" and then ask the next pending question.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ALWAYS continue from where conversation left off — never restart
- NEVER ask the same question twice
- NEVER ask two questions in one message
- NEVER skip any step in the booking flow
- NEVER confirm booking without user's explicit Yes
- NEVER proceed with only a first name — always require first and last name
- NEVER accept an invalid mobile number or email — always re-ask politely
- NEVER proceed with booking for non-Nagpur locations
- NEVER be pushy — offer upsells and handle objections once only
- NEVER mention AI, bot, ChatGPT, or Claude
- "Are you a bot?" → "I'm Yukta, Yugal's health receptionist 😊"
- "Talk to human" → "Our team is available at +91 79722 76706 📞"`;
// ─────────────────────────────────────────────────────────────
//  LEAD EXTRACTION
// ─────────────────────────────────────────────────────────────
function extractLeadData(session, userMessage, aiReply) {
  const msg = userMessage.trim();
  const lowerMsg = msg.toLowerCase();
  const lead = session.lead;

  // Language Detection
  if (/[\u0900-\u097F]/.test(userMessage)) {
    lead.language = lowerMsg.includes('मराठी') ? 'Marathi' : 'Hindi';
  }

  // 1. Package Extraction (can happen anytime)
  if (lowerMsg.includes('couple') || lowerMsg.includes('5499') || lowerMsg.includes('दोनों') || lowerMsg.includes('दोघे')) {
    lead.package = 'Couple Bundle - Rs 5,499';
  } else if (lowerMsg.includes('male') || lowerMsg.includes('man') || lowerMsg.includes('पुरुष')) {
    if (!lead.package) lead.package = 'Male Advanced - Rs 3,499';
  } else if (lowerMsg.includes('female') || lowerMsg.includes('women') || lowerMsg.includes('woman') || lowerMsg.includes('स्त्री')) {
    lead.package = 'Female Advanced - Rs 3,499';
  } else if (lowerMsg.includes('essential') || lowerMsg.includes('1999')) {
    lead.package = 'Essential - Rs 1,999';
  }

  // 2. Data Capture based on current stage
  if (session.stage === 'collecting_name') {
    // Basic validation: at least two words for full name
    if (msg.split(/\s+/).length >= 2) {
      lead.name = msg;
    }
  } else if (session.stage === 'collecting_mobile') {
    const mobileMatch = msg.match(/[6-9]\d{9}/);
    if (mobileMatch) lead.mobile = mobileMatch[0];
  } else if (session.stage === 'collecting_age') {
    const ages = msg.match(/\d+/g);
    if (ages) {
      if (lead.package?.includes('Couple')) {
        if (ages.length >= 2) {
          lead.age = ages[0];
          lead.partnerAge = ages[1];
        } else if (ages.length === 1) {
          if (!lead.age) lead.age = ages[0];
          else lead.partnerAge = ages[0];
        }
      } else {
        lead.age = ages[0];
      }
    }
  } else if (session.stage === 'collecting_pincode') {
    const pinMatch = msg.match(/\d{6}/);
    if (pinMatch) lead.pincode = pinMatch[0];
    else if (msg.length > 3) lead.pincode = msg; // Could be area name
  } else if (session.stage === 'collecting_address') {
    if (msg.length > 5) lead.address = msg;
  } else if (session.stage === 'collecting_date') {
    if (msg.length > 2) lead.date = msg;
  }

  // 3. Stage Transition based on AI's next question
  const r = aiReply.toLowerCase();
  if (session.stage === 'new') session.stage = 'chatting';
  
  if (r.includes('full name') || r.includes('नाम')) {
    session.stage = 'collecting_name';
  } else if (r.includes('mobile number') || r.includes('मोबाइल नंबर')) {
    session.stage = 'collecting_mobile';
  } else if (r.includes('your age') || r.includes('partner\'s age') || r.includes('उम्र')) {
    session.stage = 'collecting_age';
  } else if (r.includes('area name or pincode') || r.includes('पिनकोड')) {
    session.stage = 'collecting_pincode';
  } else if (r.includes('complete address') || r.includes('पूरा पता')) {
    session.stage = 'collecting_address';
  } else if (r.includes('date would you prefer') || r.includes('तारीख')) {
    session.stage = 'collecting_date';
  } else if (r.includes('shall i confirm') || r.includes('yes to confirm')) {
    session.stage = 'confirming';
  }

  if (r.includes('booking is confirmed') || r.includes('verified your details')) {
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
      range: 'Sheet1!A:L',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          timestamp,          // A: Timestamp
          sessionId,          // B: BookingID
          lead.mobile || '',   // C: Phone
          lead.package || '',  // D: Package
          lead.name || '',     // E: CustomerName
          lead.partnerAge || '',// F: PartnerName
          lead.pincode || '',  // G: Pincode
          lead.address || '',  // H: Address
          lead.date || '',     // I: PreferredDate
          lead.language || '', // J: Source
          stage || '',         // K: Status
          lead.age || ''       // L: Age
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
          lead.pincode || lead.address || 'Not provided'
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

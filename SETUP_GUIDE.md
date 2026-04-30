# Yugal Healthtech — WhatsApp AI Receptionist
## Complete Setup & Deployment Guide

---

## What This Does
This Node.js server acts as the brain between AiSensy and Claude AI.
When a user messages Yugal on WhatsApp → AiSensy receives it → sends to this server
→ Claude replies intelligently → AiSensy delivers reply to the user.

---

## STEP 1 — Get Your Files Ready

Ensure you have these files:
```
yugal-whatsapp-bot/
├── index.js          ← Main server (the bot brain)
├── package.json      ← Dependencies
├── .env.example      ← Environment variables template
└── .gitignore
```

---

## STEP 2 — Deploy to Render (Free)

1. Go to https://github.com and create a NEW repository named: yugal-whatsapp-bot
2. Upload all files from this folder to that repository
3. Go to https://render.com and sign up (free)
4. Click "New" → "Web Service"
5. Connect your GitHub account and select yugal-whatsapp-bot repo
6. Fill in these settings:
   - Name:         yugal-whatsapp-bot
   - Environment:  Node
   - Build Command: npm install
   - Start Command: npm start
   - Instance Type: Free
7. Click "Add Environment Variable":
   - Key:   CLAUDE_API_KEY
   - Value: [paste your actual Claude API key here]
8. Click "Create Web Service"
9. Wait 2-3 minutes — Render will give you a URL like:
   https://yugal-whatsapp-bot.onrender.com

COPY THAT URL — you need it for AiSensy.

---

## STEP 3 — Configure AiSensy

1. Log in to your AiSensy account
2. Go to: Settings → Chatbot / Automation
3. Look for "Webhook" or "API Integration" option
4. Set Webhook URL to:
   https://yugal-whatsapp-bot.onrender.com/webhook
5. Method: POST
6. Save

AiSensy will now forward every incoming WhatsApp message to your server,
and your server will reply back through AiSensy.

---

## STEP 4 — Test It

Send these messages to +91 79722 76706 on WhatsApp and verify:

Test 1 — New user start:
  Send: "Hi"
  Expect: Language selection menu (English/Hindi/Marathi)

Test 2 — Language + menu:
  Send: "1" (English)
  Expect: Main menu with 4 options

Test 3 — Package inquiry:
  Send: "2" (Know about packages)
  Expect: Package details with prices

Test 4 — Outside Nagpur:
  Say you are from Mumbai
  Expect: Polite decline + expansion message

Test 5 — Full booking:
  Go through all 13 steps and verify summary is correct

---

## STEP 5 — Go Live Checklist

[ ] Server is running on Render (green status)
[ ] Webhook URL is set in AiSensy
[ ] Claude API key is added to Render environment variables
[ ] All 5 test cases pass
[ ] Escalation message tested (say "I want to speak to a human")
[ ] Hindi and Marathi tested

---

## Troubleshooting

Problem: Bot not replying
Fix: Check Render logs → Dashboard → your service → Logs tab

Problem: Bot replies in wrong language
Fix: Verify your message — Claude auto-detects language from context

Problem: Conversation not remembering previous messages
Fix: Conversations are stored in-memory. If Render restarts, history resets.
     This is normal for the free tier. Upgrade to paid or add a database
     (Redis/MongoDB) for persistent memory across restarts.

Problem: "Missing phone or message" error in logs
Fix: Check AiSensy webhook payload format — update field names in index.js
     (line ~30) to match what AiSensy actually sends.

---

## AiSensy Webhook Payload

AiSensy typically sends incoming messages like this:
{
  "phone": "919876543210",
  "message": "Hi",
  "name": "Rahul",
  "timestamp": "2026-04-30T10:00:00Z"
}

If your AiSensy sends different field names, update these lines in index.js:
  const phone   = body.phone || body.mobile || body.from;
  const userMessage = body.message || body.text || body.msg;

---

## Monthly Cost Estimate

| Service        | Plan  | Cost      |
|----------------|-------|-----------|
| Render         | Free  | ₹0        |
| Claude API     | Pay   | ~₹1–3 per |
|                | per use| 100 msgs |
| AiSensy        | Yours | Already   |
| WhatsApp API   | Meta  | Free tier |

Total estimated cost for 500 conversations/month: ₹500–800 only.

---

Built for Yugal Healthtech Pvt. Ltd. | India's First Couple Health Platform
WhatsApp: +91 79722 76706 | Nagpur, Maharashtra

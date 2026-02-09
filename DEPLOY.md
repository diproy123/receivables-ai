# 🚀 Deployment Guide — Receivables AI

This guide assumes **zero deployment experience**. Follow the steps exactly.

---

## Option 1: Railway (Recommended — Easiest)

**Cost:** Free tier gives you 500 hours/month — plenty for demos  
**Time:** ~5 minutes  
**URL you'll get:** `https://receivables-ai-production.up.railway.app`

### Step 1: Push code to GitHub

If you don't have a GitHub repo yet:

```bash
# In your terminal, navigate to the project folder
cd receivables-ai

# Initialize git
git init
git add .
git commit -m "Initial commit - Receivables AI MVP"

# Create a repo on github.com (click + → New Repository → name it "receivables-ai")
# Then connect and push:
git remote add origin https://github.com/YOUR_USERNAME/receivables-ai.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy on Railway

1. Go to **https://railway.app** → Sign up with GitHub
2. Click **"New Project"**
3. Click **"Deploy from GitHub Repo"**
4. Select your **receivables-ai** repository
5. Railway auto-detects Python and starts deploying ✅

### Step 3: Add your API key (optional, for real extraction)

1. In Railway dashboard, click on your service
2. Go to **Variables** tab
3. Click **"New Variable"**
4. Name: `ANTHROPIC_API_KEY`
5. Value: your Anthropic API key (starts with `sk-ant-...`)
6. Click **Add** → Railway auto-redeploys

### Step 4: Get your URL

1. Go to **Settings** tab
2. Under **Networking** → Click **"Generate Domain"**
3. You'll get a URL like: `https://receivables-ai-production.up.railway.app`
4. **Share this URL with your client!** 🎉

---

## Option 2: Render (Also very easy)

**Cost:** Free tier available  
**Time:** ~5 minutes  
**URL you'll get:** `https://receivables-ai.onrender.com`

### Step 1: Push to GitHub (same as above)

### Step 2: Deploy on Render

1. Go to **https://render.com** → Sign up with GitHub
2. Click **"New +"** → **"Web Service"**
3. Connect your **receivables-ai** repo
4. Settings will auto-fill from `render.yaml`:
   - **Name:** receivables-ai
   - **Runtime:** Python
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn backend.server:app --host 0.0.0.0 --port $PORT`
5. Click **"Create Web Service"**

### Step 3: Add API key (optional)

1. Go to **Environment** tab
2. Add: `ANTHROPIC_API_KEY` = your key
3. Service auto-redeploys

### Step 4: Access your app

Your app will be live at `https://receivables-ai.onrender.com`

> ⚠️ **Note:** Render free tier sleeps after 15 min of inactivity. First visit may take ~30 seconds to wake up. This is fine for demos — just open the URL a minute before your meeting.

---

## Option 3: Fly.io (More control, still easy)

**Cost:** Free tier with 3 shared VMs  
**Time:** ~10 minutes

### Step 1: Install Fly CLI

```bash
# macOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh

# Windows
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

### Step 2: Login & Deploy

```bash
cd receivables-ai

# Sign up / login
fly auth signup  # or: fly auth login

# Launch (first time only)
fly launch
# When prompted:
#   - App name: receivables-ai
#   - Region: pick closest to you (e.g., "bom" for Mumbai)
#   - Would you like to set up a Postgresql database? → No
#   - Would you like to deploy now? → Yes

# Set API key (optional)
fly secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Step 3: Access

Your app is at `https://receivables-ai.fly.dev`

Future deploys: just run `fly deploy`

---

## After Deployment — Checklist

- [ ] Open the URL and verify the landing page loads
- [ ] Click "Launch Demo" and verify the dashboard works
- [ ] Try uploading a document (works in mock mode without API key)
- [ ] If you set `ANTHROPIC_API_KEY`, upload a real PDF invoice and verify extraction
- [ ] Test on mobile (the UI is responsive)
- [ ] Share the URL with your client!

---

## Troubleshooting

### "Application error" or blank page
→ Check the deployment logs in Railway/Render dashboard. Usually a missing dependency.

### Upload doesn't work
→ Cloud platforms have ephemeral storage. Uploads work during the session but reset on redeploy. This is fine for demos.

### "Mock Mode" showing instead of Claude API
→ You haven't set the `ANTHROPIC_API_KEY` environment variable. Add it in the platform dashboard under "Variables" or "Environment".

### Slow first load on Render
→ Free tier sleeps. First request takes ~30s. Paid tier ($7/mo) fixes this. For client demos, just open the URL 1 min early.

### How to get an Anthropic API key
1. Go to https://console.anthropic.com
2. Sign up → Go to "API Keys"
3. Create a new key
4. Copy it (starts with `sk-ant-...`)
5. Add $5-10 credits (extraction costs ~$0.01 per document)

---

## Cost Breakdown

| Component | Free Tier | Paid (if needed) |
|-----------|-----------|-------------------|
| Railway hosting | 500 hrs/mo free | $5/mo |
| Render hosting | Free (sleeps) | $7/mo (always on) |
| Claude API | — | ~$0.01/document |
| **Total for demo** | **$0** | **$5-12/mo** |

---

## Custom Domain (Optional)

If you want `app.yourstartup.com` instead of the default URL:

### Railway
1. Settings → Custom Domain → Add your domain
2. Add CNAME record in your DNS pointing to Railway

### Render
1. Settings → Custom Domains → Add your domain
2. Follow DNS instructions shown

---

## Quick Reference

```bash
# Local development
cd receivables-ai
pip install -r requirements.txt
python3 backend/server.py
# → http://localhost:8000

# Deploy update (after pushing to GitHub)
git add . && git commit -m "update" && git push
# Railway/Render auto-deploy from GitHub ✅
```

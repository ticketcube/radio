# AI Agent Guide - OTW Radio

**Purpose:** Onboarding document for AI assistants (Softgen, Cursor, etc.) working on the OTW Radio codebase.

---

## 📋 Project Context

**What is OTW Radio?**
A 24/7 internet radio station for Ones To Watch. DJs stream live via AzuraCast Web DJ interface. The web player shows now-playing info, programming schedule, mood tracking, listener analytics, and admin tools for managing DJs, playlists, and media extraction.

**Current State (as of 2026-11-20):**
- ✅ Phase 1: Static schedule, audio player, admin panel
- ✅ Phase 2: DJ management with AzuraCast live status integration
- ✅ Phase 3: AIMC playlist automation (operational)
- ✅ Phase 4: Listener features (mood tracking, listener map)
- 🔄 Phase 5: Performance optimization & scaling

---

## 🏗️ Architecture Overview

### Infrastructure Split

**Production Architecture:**
- **Web Application:** `onestowatch.live` → Vercel (Next.js)
- **Radio Server:** `radio.onestowatch.live` → Linode (AzuraCast Docker)
- **Worker Service:** Separate Linode instance (AIMC audio extraction)

**Why Split?**
- Vercel: Optimal for Next.js deployment, edge caching, global CDN
- Linode: Dedicated resources for audio streaming, AzuraCast requires Docker
- Worker: Heavy ffmpeg processing isolated from web traffic

### Tech Stack
- **Frontend:** Next.js 15.2 (Page Router), React 18, TypeScript, Tailwind + shadcn/ui
- **Backend:** Supabase Cloud (Postgres + Auth + Storage + RLS)
- **Streaming:** AzuraCast (station management, Web DJ interface, live detection)
- **Media Warehouse:** AIMC (AWS Media Lake) - video/audio asset storage
- **Deployment:** Vercel (web) + Linode (radio + worker)

### Key Design Decisions

**1. Always Dark Theme**
- No light mode, no theme toggle
- Matches OTW brand (dark background, white text, crimson accents)
- CSS variables in `src/styles/globals.css` set `:root` only (no `.dark` overrides)

**2. AzuraCast as Streaming Authority**
- AzuraCast manages: DJ accounts, playlists, live status, audio stream
- Our database stores: DJ metadata, UI preferences, AzuraCast username mapping
- Never build parallel auth or duplicate AzuraCast data - always fetch live

**3. Supabase-Native Backend**
- Auth: Supabase Auth (no custom JWT, no bcrypt)
- Database: Postgres with RLS policies (no service role key in client code)
- Files: Supabase Storage (no local filesystem)
- **Cloud Hosted:** Using Supabase hosted service, not self-hosted

**4. Server-Side API Key Management**
- `AZURACAST_API_KEY` must stay server-side (Next.js API routes only)
- `AIMC_API_KEY` must stay server-side
- Client uses public endpoints or our proxy APIs

**5. Performance Optimization**
- Polling intervals: 2 minutes (was 30 seconds - 75% reduction)
- In-memory caching: Feature flags, analytics (5 minute TTL)
- CDN cache headers: 2 minute cache, 4 minute stale-while-revalidate
- Lazy anonymous auth: Only on user interaction, not page load
- Rate limiting: 15 second cooldown on mood submissions

---

## 🗂️ Database Schema

### Core Tables

**user_profiles** (extends Supabase auth.users)
```sql
user_id UUID PRIMARY KEY REFERENCES auth.users(id) UNIQUE
email TEXT NOT NULL
username TEXT NOT NULL
display_name TEXT
role TEXT CHECK (role IN ('admin', 'otwl-dj', 'listener', 'verified-listener'))
is_admin BOOLEAN DEFAULT false
azuracast_streamer_username TEXT
azuracast_notes TEXT
created_at TIMESTAMPTZ
```

**mood_changes** (listener mood tracking)
```sql
id BIGSERIAL PRIMARY KEY
user_id UUID REFERENCES auth.users(id)
city TEXT
mood_value INTEGER (0-100)
mood_category TEXT (cozy, party, reflection, focus)
song_title TEXT
song_artist TEXT
song_id TEXT
created_at TIMESTAMPTZ
```

**extraction_jobs** (AIMC audio extraction pipeline)
```sql
id UUID PRIMARY KEY
asset_id TEXT NOT NULL
asset_name TEXT
artist TEXT
title TEXT NOT NULL
status TEXT (pending, claimed, downloading, converting, uploading, done, failed)
claimed_at TIMESTAMPTZ
claimed_by TEXT
save_to_aimc BOOLEAN
save_to_radio BOOLEAN
download_url TEXT
aimc_key TEXT
radio_path TEXT
duration_sec NUMERIC
size_bytes BIGINT
error TEXT
created_at TIMESTAMPTZ
```

**RLS Policies:**
- Users can SELECT their own profile
- Admins can SELECT/UPDATE/DELETE all profiles
- Anyone can INSERT (for signup), but trigger sets role='listener' default
- Mood tracking requires authenticated session
- Extraction jobs admin-only

---

## 🔌 AzuraCast Integration

### Station Configuration
- **Station ID:** `2`
- **Shortcode:** `otw_radio`
- **Base URL:** `https://radio.onestowatch.live` (Linode server)

### API Endpoints

**Public (no auth required):**
```
GET /api/nowplaying/otw_radio
```
Returns: live status, current track, listener count, streamer_name

**Authenticated (X-API-Key header):**
```
GET /api/station/otw_radio/streamers
GET /api/station/otw_radio/playlists
POST /api/station/otw_radio/playlists
PUT /api/station/otw_radio/playlist/{id}
GET /api/station/otw_radio/listeners
```

### DJ Matching Logic

**Critical:** Match DJs by `streamer_username` field, NOT `display_name`.

**Flow:**
1. Fetch nowplaying: `live.streamer_name` (if `live.is_live == true`)
2. Fetch all streamers: `GET /api/station/otw_radio/streamers`
3. Cross-reference with `user_profiles.azuracast_streamer_username`
4. If match found: show DJ card with "LIVE" badge, listener count, broadcast time
5. If no match: show alert "Unmatched live streamer: {name}"

**Common Pitfall:** Using `display_name` or `email` for matching - these don't exist in AzuraCast's streamer response. Only `streamer_username` is reliable.

---

## 🎬 AIMC Integration

### Status: **Operational** ✅

AIMC (AWS Media Lake) stores OTW's video and audio content. The integration extracts audio from video assets and uploads to both AIMC storage and the radio server for broadcasting.

### Architecture

```
AIMC (AWS Media Lake)
  ↓ [Download URL]
Worker Service (Linode)
  ↓ [ffmpeg extraction + normalization]
  ↓ [MP3 output]
  ├→ Supabase Storage (AIMC bucket)
  └→ Radio Server (SFTP to AzuraCast)
```

### Key Components

**1. Web UI:** `/admin/extract-audio`
- Select AIMC asset by ID
- Preview metadata, thumbnail, duration
- Choose destinations: AIMC storage, Radio server, or both
- Monitor job status in real-time

**2. Worker Service:** `worker/src/index.ts`
- Polls `/api/worker/claim` every 10 seconds
- Downloads video from AIMC presigned URL
- Extracts audio with ffmpeg:
  - Audio-only stream
  - Loudness normalization
  - 192kbps MP3
  - Metadata tags (artist, title)
- Uploads to selected destinations
- Updates job status in database

**3. API Routes:**
- `/api/aimc/asset` - Fetch asset metadata from AIMC
- `/api/aimc/generate-download` - Get presigned download URL
- `/api/aimc/generate-upload` - Get presigned upload URL for Supabase
- `/api/worker/claim` - Worker claims next pending job
- `/api/worker/jobs/[id]` - Worker updates job status
- `/api/extraction/create` - Admin creates new extraction job
- `/api/extraction/jobs` - List all extraction jobs

### AIMC Asset Structure

```json
{
  "id": "asset:uuid:...",
  "type": "Video",
  "tags": {
    "Artist": "Wilderado",
    "Series": "Live From the Rooftop",
    "Format": "Live Performance",
    "Artist Spotify ID": "1Tp7C6LzxZe9Mix6rn4zbI"
  },
  "media": {
    "durationSec": 217.6,
    "width": 1920,
    "height": 1080
  },
  "representations": [
    { "purpose": "proxy", "format": "MP4" },
    { "purpose": "thumbnail", "format": "JPEG" }
  ]
}
```

### Environment Variables

```bash
# AIMC (server-side only)
AIMC_API_URL=https://otw.aimc-ln.com/v1
AIMC_API_KEY=your-api-key

# Worker (worker instance only)
WORKER_TOKEN=secure-random-token
SFTP_HOST=radio.onestowatch.live
SFTP_PORT=2022
SFTP_USER=azuracast
SFTP_PRIVATE_KEY_PATH=/path/to/key
RADIO_FOLDER=aimc
```

### Common Issues

**Issue:** Worker fails with "No audio track"
**Solution:** Some videos are video-only. Check AIMC for audio codec in metadata.

**Issue:** SFTP upload fails
**Solution:** Verify SSH key permissions (600), AzuraCast SFTP user has write access.

**Issue:** Job stuck in "downloading"
**Solution:** Check worker logs, may be large file or slow AIMC response.

---

## 🌍 Listener Analytics & Mood Tracking

### Listener Map

**Endpoint:** `/api/listeners-map`
- Fetches AzuraCast listener report (requires API key)
- Aggregates by ~1 degree lat/lon buckets
- Returns city names when ≥1 listeners in same location
- **Polling:** 2 minutes (client), 2 minute server cache
- **Privacy:** No IPs, user agents, or exact coordinates exposed

**Data Usage Optimization:**
- Before: 30 second polling = 120 requests/hour per visitor
- After: 2 minute polling = 30 requests/hour per visitor
- **Result:** 75% reduction in API calls

### Mood Tracking

**Endpoint:** `/api/mood/submit`
- Anonymous auth (lazy - only on first interaction)
- Rate limit: 15 seconds between submissions
- Geolocation: IP-based city lookup (ip-api.com)
- Categories: cozy (0-25), party (76-100), reflection (0-25), focus (51-75)

**Data Usage Optimization:**
- Before: Anonymous session created for ALL page visitors
- After: Session created only when user taps a mood
- **Result:** 95% reduction in unnecessary auth sessions

**Feature Flag:** `mood_tracker_enabled`
- Cached client-side for 5 minutes
- Server checks on every submission
- Admin can disable feature instantly

---

## 🎯 Planned Integrations

### MCP (Model Context Protocol) + Ticketmaster

**Status:** Planning phase

**Concept:**
- MCP agent connects to Ticketmaster API
- Fetches upcoming concerts for OTW artists
- Cross-references with artist roster in database
- Auto-generates show announcements during relevant tracks
- DJ dashboard shows "X playing in Y city this weekend"

**Technical Requirements:**
- Ticketmaster API key with artist/event access
- MCP server implementation (separate service)
- Artist Spotify ID → Ticketmaster Artist ID mapping
- Real-time event data caching (24 hour TTL)

**Benefits:**
- Automated concert promotion during relevant airtime
- Strengthens artist-to-listener connection
- Drives ticket sales for OTW roster

**Next Steps:**
1. Acquire Ticketmaster API credentials
2. Build artist ID mapping table
3. Implement MCP server with Ticketmaster connector
4. Design DJ dashboard widgets
5. Test announcement timing logic

---

## 🎨 Design System

### Color Tokens (globals.css :root)
```css
--background: 0 0% 4%;
--foreground: 0 0% 98%;
--primary: 348 100% 54%;
--accent: 0 0% 12%;
--muted: 0 0% 60%;
--border: 0 0% 12%;
```

### Typography
```typescript
fontFamily: {
  sans: ['IBM Plex Sans', ...],
  display: ['Sora', ...],
  mono: ['IBM Plex Mono', ...]
}
```

### Key Animations
```css
.animate-pulse-glow
.animate-pulse-dot
```

---

## 🔐 Authentication Patterns

### Protected Routes
```tsx
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function AdminPage() {
  return (
    <ProtectedRoute requireAdmin>
    </ProtectedRoute>
  );
}
```

### Auth Checks
```typescript
const { user, profile, loading } = useAuth();
if (profile?.is_admin) { }

const { data: { user } } = await supabase.auth.getUser();
const { data: profile } = await supabase
  .from("user_profiles")
  .select("is_admin")
  .eq("user_id", user.id)
  .single();

if (!profile?.is_admin) {
  return res.status(403).json({ error: "Admin access required" });
}
```

---

## 📡 API Route Patterns

### Performance: Caching Strategy

**Client-Side Caching (Session Storage):**
```typescript
const cachedData = sessionStorage.getItem('cache_key');
const cachedTime = sessionStorage.getItem('cache_key_time');
const CACHE_TTL = 300000;

if (cachedData && (Date.now() - parseInt(cachedTime)) < CACHE_TTL) {
  return JSON.parse(cachedData);
}
```

**Server-Side Caching (In-Memory):**
```typescript
let cache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 60000;

if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
  return res.json(cache.data);
}
```

**CDN Caching (Headers):**
```typescript
res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=240");
```

### Lazy Anonymous Auth Pattern
```typescript
const [sessionReady, setSessionReady] = useState(false);

const handleInteraction = async () => {
  if (!sessionReady) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) await supabase.auth.signInAnonymously();
    setSessionReady(true);
  }
};
```

---

## 🛠️ Common Tasks

### Adding a New DJ
```typescript
await supabase.from("user_profiles").insert({
  user_id: authUser.id,
  email: "dj@example.com",
  username: "djname",
  display_name: "DJ Name",
  role: "otwl-dj",
  is_admin: false
});
```

### Creating an Extraction Job
```typescript
1. Get AIMC asset ID from AIMC dashboard
2. Go to /admin/extract-audio
3. Enter asset ID, preview metadata
4. Select destinations (AIMC storage and/or Radio)
5. Submit - worker will process automatically
6. Monitor status in job list
```

### Deploying Worker
```bash
cd /opt/otw-worker
git pull
npm install
docker-compose build
docker-compose up -d
docker-compose logs -f worker
```

---

## 🐛 Common Issues & Solutions

### Issue: "duplicate key value violates unique constraint user_profiles_user_id_key"
**Cause:** Trying to insert a profile for a user_id that already exists  
**Solution:** Use UPSERT or check existence first

### Issue: DJ shows "Setup Required" even with AzuraCast account
**Cause:** `azuracast_streamer_username` doesn't match AzuraCast's `streamer_username`  
**Solution:** Copy exact username from AzuraCast → Paste in /admin/djs

### Issue: Mood tracking not working
**Cause:** Feature flag disabled OR rate limit hit  
**Solution:** Check `/admin/features` for `mood_tracker_enabled` flag. Rate limit is 15 seconds.

### Issue: Listener map shows "unconfigured"
**Cause:** `AZURACAST_API_KEY` not set in environment  
**Solution:** Add key to Vercel environment variables

### Issue: Worker job stuck in "pending"
**Cause:** Worker service not running OR not polling  
**Solution:** Check `docker-compose logs -f worker`, verify WORKER_TOKEN matches

### Issue: High Supabase usage
**Cause:** Excessive polling or missing caching  
**Solution:** 
- Verify polling intervals (should be 2 minutes)
- Check cache TTLs (feature flags: 5 min, analytics: 1 min)
- Monitor lazy auth (no auth on page load)
- Review `docs/SUPABASE_OPTIMIZATION.md`

---

## 📝 Code Style Guidelines

### File Naming
- Components: PascalCase (`AudioPlayer.tsx`)
- Pages: lowercase (`index.tsx`, `login.tsx`)
- API routes: lowercase (`live-djs.ts`)
- Utils/services: camelCase (`authService.ts`)

### Import Order
```typescript
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AudioPlayer } from "@/components/AudioPlayer";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { DJ, DJStatus } from "@/types";
```

### Error Handling
```typescript
try {
  const { data, error } = await supabase.from("table").select();
  if (error) throw error;
  return data;
} catch (err) {
  console.error("Context-specific error message:", err);
  setError("User-friendly message");
}
```

---

## 🚀 Deployment Checklist

### Environment Variables (Vercel)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- [ ] `AZURACAST_API_KEY` (server-only)
- [ ] `AZURACAST_URL` (server-only)
- [ ] `NEXT_PUBLIC_AZURACAST_URL` (public stream URL)
- [ ] `AIMC_API_URL` (server-only)
- [ ] `AIMC_API_KEY` (server-only)
- [ ] `WORKER_TOKEN` (server-only)

### Environment Variables (Worker)
- [ ] `APP_URL` (points to Vercel app)
- [ ] `WORKER_TOKEN` (matches Vercel)
- [ ] `SFTP_HOST` (AzuraCast server)
- [ ] `SFTP_PORT` (default: 2022)
- [ ] `SFTP_USER` (default: azuracast)
- [ ] `SFTP_PRIVATE_KEY_PATH`
- [ ] `RADIO_FOLDER` (default: aimc)

### Database
- [ ] Migrations applied
- [ ] RLS policies enabled on all tables
- [ ] Admin user created
- [ ] Feature flags initialized

### Services
- [ ] AzuraCast configured with shortcode `otw_radio`
- [ ] AzuraCast API key generated
- [ ] AIMC API key verified
- [ ] Worker service deployed and running

### Performance
- [ ] Polling intervals set to 2 minutes
- [ ] Caching enabled (session storage, server cache, CDN)
- [ ] Lazy anonymous auth implemented
- [ ] Rate limiting on mood submissions

---

## 🎯 Next Steps (For AI Agents)

When continuing work on this project:

1. **Read this guide first** - understand architecture before coding
2. **Check existing patterns** - match file structure, naming, API patterns
3. **Verify schema** - run `get_database_schema` before database changes
4. **Performance first** - avoid high-frequency polling, use caching
5. **Test integrations** - don't break AIMC pipeline or DJ matching
6. **Preserve dark theme** - never add light mode
7. **Follow RLS** - never bypass security without justification
8. **Document as you go** - update this guide if you add new patterns

**Common Pitfalls to Avoid:**
- ❌ Polling more frequently than 2 minutes (increases costs)
- ❌ Creating anonymous sessions on page load (use lazy auth)
- ❌ Bypassing server-side caching (causes duplicate Supabase queries)
- ❌ Using `display_name` for DJ matching (use `streamer_username`)
- ❌ Exposing API keys to client (use Next.js API routes)
- ❌ Adding light mode (permanent dark theme)
- ❌ Hardcoding URLs or credentials (use environment variables)

---

## 📚 Additional Resources

- **Project Brief:** `.softgen/project.md`
- **Roadmap:** `docs/SCALING_ROADMAP.md`
- **AzuraCast Setup:** `docs/AZURACAST_SETUP.md`
- **AIMC Integration:** `otw-radio/docs/AIMC_INTEGRATION.md`
- **Supabase Optimization:** `docs/SUPABASE_OPTIMIZATION.md`
- **Listener Map Feature:** `docs/LISTENERMAP_FEATURE.md`
- **Deployment Guide:** `docs/LINODE_DEPLOYMENT.md`
- **Worker Deployment:** `docs/WORKER_DEPLOYMENT_GUIDE.md`

For questions not covered here, check existing code patterns in relevant admin pages and API routes.
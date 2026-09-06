# Kid Tube

A tiny, static alternative to YouTube Kids. A parent picks exactly which
YouTube videos (and, optionally, channels) are allowed; the child sees only
that library and watches inside the site with the official YouTube embed.
No search box, no Shorts, no comments, no trending feed.

* **Static site** – plain HTML/CSS/JS, no build step, no backend, no database.
* **Everything stays in the browser** – the library, settings and parent PIN
  live in `localStorage` on that device.
* **Works on iPhone/iPad and desktop** – big tap targets, responsive grid, and
  it can be added to the Home Screen as a web app.

## How it works

| Mode | What you see |
| --- | --- |
| **Kid mode** (default) | A grid of approved videos with thumbnail, title and channel. Tabs for *Videos* and *Channels*. Tapping a card plays the video in an embedded player. Once there are more than a few videos, a "Find in my videos" box filters the approved library only. |
| **Parent mode** (🔒 Parent, PIN-protected) | Paste a YouTube link to add a video or channel, see and remove approved content, hide individual videos from a channel, change the library name/PIN, export/import a JSON backup. |

The PIN only prevents accidental taps; it is not real security. A reload
always starts in kid mode.

### Watch time (parent unlock timer)

Once a PIN exists, kid mode is locked by default. The child sees a lock screen
with an **Ask a grown-up to unlock** button; entering the parent PIN there
unlocks the library for 15 minutes (configurable in Parent mode → Watch time:
5–60 minutes, or no limit). A countdown chip shows in the header and on the
player; tapping it lets a parent restart the timer. When time runs out the
player stops and the lock screen returns. The expiry is stored locally, so
reloading the page neither resets nor extends it. Parent mode also has
**Start now** and **Lock now** buttons.

### Playback

Videos play in the official YouTube embed through the IFrame Player API:

* The app keeps its own queue of the other approved videos (same channel
  first). The "Up next" list under the player is exactly that queue, in
  order: when a video ends the first card plays next, in the same player, and
  tapping any card plays it immediately without reloading the player.
* When the queue runs out, the app replaces YouTube's end screen with its own
  "All done" screen offering *Watch again* and *Back to videos*.
* If a video that is not in the library keeps playing for more than half a
  minute (for example one picked from the suggestions YouTube shows while
  paused), playback is stopped and the child is sent back to the library. The
  delay is there because pre-roll ads report their own ids.
* If the player API cannot load, a plain embed is used instead.
* The player iframe is sandboxed so it cannot open new tabs or navigate the
  page. The title, logo and "Watch on YouTube" links are still there, they just
  do nothing when tapped. If a video ever shows as unavailable, turn off
  "Block links to youtube.com inside the player" in Parent mode → Settings.

YouTube's own player chrome is otherwise left alone, and the pause overlay
still shows same-channel suggestions.

### Ads

Embeds show the same ads as youtube.com. Tapping an ad cannot open the
advertiser's site (see the sandbox above), but the ad still plays. If you have
YouTube Premium (or Premium Lite), sign in to youtube.com in the same browser
and turn on **Use my YouTube sign-in** in Parent mode → Settings. The player
then loads from youtube.com instead of the privacy-enhanced domain, so your
Premium status applies and videos play without ads. Leave it off to keep the
cookie-free embed.

### Supported links

* Videos: `youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/shorts/…`,
  `youtube.com/embed/…`, `youtube.com/live/…`, or a bare 11-character video ID.
  Title and channel name are fetched from YouTube's public oEmbed endpoint
  (no API key); the thumbnail is derived from the video ID. If the lookup
  fails the video is still added with a placeholder title and will play.
* Channels: `youtube.com/@handle`, `youtube.com/channel/UC…`,
  `youtube.com/c/…`, `youtube.com/user/…`. **Requires a free YouTube Data API
  key** (see below). The channel's latest 50 uploads are added; "Refresh"
  pulls in new uploads later. Any upload can be hidden individually.

## Run it locally

There is nothing to install. Serve the folder with any static file server:

```sh
# Python
python3 -m http.server 8000
# or Node
npx serve .
```

Then open <http://localhost:8000>. (Opening `index.html` directly from the
file system also works in most browsers, but metadata fetches may be blocked.)

## Deploy to GitHub Pages

The app uses hash-based routing (`#/videos`, `#/watch/…`) and relative asset
paths, so it works under a repository sub-path such as
`https://<user>.github.io/<repo>/` with no configuration.

**Option A – deploy from the branch (simplest)**

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Under *Build and deployment*, choose **Deploy from a branch**, pick your
   branch (e.g. `main`) and the `/ (root)` folder, then save.
4. After a minute the site is live at `https://<user>.github.io/<repo>/`.

**Option B – GitHub Actions**

A workflow in `.github/workflows/deploy.yml` publishes the repository root on
every push to `main`. Go to **Settings → Pages** and set the source to
**GitHub Actions**. Adjust the branch name in the workflow if your default
branch is different.

## Sample library

Open `https://<user>.github.io/<repo>/sample/` (or `#/sample`) to load a
starter set of about 60 videos: LEGO builds and working LEGO locks, gem
mining, geodes, gold panning and treasure hunts, and fire safety and fire
alarm videos. It goes through the same PIN-protected import screen as a share
link, so nothing is added until a parent confirms. The list lives in
`js/sample.js`; edit or delete that file to change or remove it. The videos
were picked from search results and are worth a quick skim in Parent mode.

## Optional: YouTube Data API key (for channels)

Individual videos never need a key. To add whole channels:

1. Open the [Google Cloud Console](https://console.cloud.google.com/), create
   a project and enable **YouTube Data API v3**.
2. Create an **API key** (APIs & Services → Credentials). It is a good idea to
   restrict it to *HTTP referrers* matching your Pages URL and to the YouTube
   Data API only.
3. In the app, open Parent mode → **Settings**, paste the key and save.

The key is stored only in that browser's `localStorage` and is sent directly
to Google's API from the browser. It is included in JSON backups so you can
move it to another device; remove it from the file if you share the backup.

The free quota (10,000 units/day) is far more than this app uses: adding or
refreshing a channel costs a handful of units.

## Moving the library to another device

There is no cloud sync (by design), but you can carry the library over in a
link:

1. On the device where you curate (say, your phone), open Parent mode →
   **Send to another device** → *Share link…*. The whole library is
   compressed into the link itself; nothing is uploaded anywhere. On iPhone
   this opens the share sheet, so you can AirDrop it straight to the iPad or
   send it in Messages/email/Notes.
2. Open the link on the other device. It shows what the link contains and
   asks for the parent PIN (or lets you create one on a fresh device), then
   **Add to my library** merges the items in, or **Replace my library**
   swaps everything out.

Tick *Include my API key* before sharing if you want the other device to be
able to refresh channels itself. Otherwise just re-share after you refresh.
The PIN is never included. A typical library of a few dozen videos makes a
link of a few thousand characters, which AirDrop, Messages and email handle
fine; QR codes do not.

**Backup file** (Parent mode → *Download backup*) works the same way with a
JSON file instead of a link.

If a link or backup contains videos without a channel name (for example a
list someone typed up by hand), the app fetches the missing titles and
channel names from YouTube right after the import. **Fetch missing details**
in the Approved library panel does the same on demand.

## Forgot the PIN?

Clear this site's data in the browser (or use another browser). This also
removes the library, so export a backup first if you can still get in.

## Project layout

```
index.html            app shell
css/styles.css        all styling
js/youtube.js         URL parsing, thumbnails, oEmbed metadata, optional Data API calls
js/store.js           localStorage persistence, PIN hashing, import/export, share links
js/sample.js          the sample library offered at #/sample
sample/index.html     redirects /sample/ to #/sample
js/app.js             routing, kid mode, parent mode
manifest.webmanifest  "Add to Home Screen" support
.nojekyll             tells GitHub Pages to serve files as-is
```

## Data model

```js
settings = { parentPinHash, childName, apiKey, blockYouTubeLinks, useYouTubeSignIn, watchMinutes }
watch    = { until }   // ms timestamp when the current unlock expires
sources  = [{ id, type: "video" | "channel", youtubeId, title, channelName, addedAt,
              // channels only:
              uploadsPlaylistId, thumbnail, lastSyncedAt }]
videos   = [{ youtubeId, title, channelName, thumbnail, sourceId, publishedAt, addedAt, hidden }]
```

## Non-goals (for now)

No accounts, cloud sync, OAuth, backend, payments, content moderation, remote
administration or screen-time limits. A technically determined child can still
open youtube.com in another tab; this app is about making the *easy* path a
safe one.

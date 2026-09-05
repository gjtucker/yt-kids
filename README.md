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

### Playback

Videos play in the official YouTube embed through the IFrame Player API:

* The other approved videos (same channel first) are queued as a playlist, so
  when one video ends the next approved one plays instead of YouTube's
  suggestions.
* When the last queued video ends, the app replaces YouTube's end screen with
  its own "All done" screen offering *Watch again* and *Back to videos*.
* If a video that is not in the library starts (for example from the
  suggestions YouTube shows while paused), playback is stopped and the child is
  sent back to the library.
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

Parent mode → **Backup & move to another device** → *Download backup* (or
*Copy to clipboard*). On the other device, open Parent mode, set a PIN, and
use *Import backup*. Imports merge into the existing library; the PIN is
never exported.

## Forgot the PIN?

Clear this site's data in the browser (or use another browser). This also
removes the library, so export a backup first if you can still get in.

## Project layout

```
index.html            app shell
css/styles.css        all styling
js/youtube.js         URL parsing, thumbnails, oEmbed metadata, optional Data API calls
js/store.js           localStorage persistence, PIN hashing, import/export
js/app.js             routing, kid mode, parent mode
manifest.webmanifest  "Add to Home Screen" support
.nojekyll             tells GitHub Pages to serve files as-is
```

## Data model

```js
settings = { parentPinHash, childName, apiKey }
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

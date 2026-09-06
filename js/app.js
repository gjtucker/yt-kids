/* Kid Tube – a tiny curated YouTube library. Hash-based routing so it works
   under a GitHub Pages sub-path. Kid mode is the default; parent mode sits
   behind a PIN stored (hashed) in localStorage. */
(function () {
  'use strict';

  var YTH = window.YT_HELPERS; // window.YT is reserved for the YouTube IFrame API
  var STORE = window.STORE;

  var SAMPLE_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

  var state = STORE.load();
  var session = { unlocked: false, filter: '', status: null, busy: false, pinError: '', lastList: '', open: {} };
  var root = document.getElementById('app');

  /* ---------------- helpers ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function persist() {
    if (!STORE.save(state)) setStatus('error', 'Could not save. Is browser storage full or blocked?');
  }

  /* `where` names the parent-mode panel the message belongs under ('add' by default). */
  function setStatus(type, text, where) {
    session.status = text ? { type: type, text: text, where: where || 'add' } : null;
    render();
  }

  function statusHtml(where) {
    var st = session.status;
    if (!st || st.where !== where) return '';
    return '<p class="status status-' + st.type + '" role="status">' + esc(st.text) + '</p>';
  }

  function sortKey(v) {
    return v.publishedAt || v.addedAt || '';
  }

  function visibleVideos() {
    return state.videos.filter(function (v) { return !v.hidden; })
      .sort(function (a, b) { return sortKey(b).localeCompare(sortKey(a)); });
  }

  function findVideo(id) {
    for (var i = 0; i < state.videos.length; i++) if (state.videos[i].youtubeId === id) return state.videos[i];
    return null;
  }

  function findSource(id) {
    for (var i = 0; i < state.sources.length; i++) if (state.sources[i].id === id) return state.sources[i];
    return null;
  }

  function channelGroups() {
    var map = {};
    visibleVideos().forEach(function (v) {
      var name = v.channelName || 'Other videos';
      if (!map[name]) map[name] = { name: name, videos: [], thumbnail: '' };
      map[name].videos.push(v);
    });
    state.sources.forEach(function (s) {
      if (s.type === 'channel' && map[s.title] && s.thumbnail) map[s.title].thumbnail = s.thumbnail;
    });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b); }).map(function (k) { return map[k]; });
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /* ---------------- watch time (parent unlock timer) ----------------
     The kid side is locked until a parent enters the PIN, which unlocks it
     for `settings.watchMinutes` (0 = no limit). The expiry is persisted so a
     reload neither resets nor extends it. */

  function limitEnabled() {
    return (state.settings.watchMinutes || 0) > 0 && !!state.settings.parentPinHash;
  }

  function msLeft() {
    return Math.max(0, (state.watch && state.watch.until || 0) - Date.now());
  }

  function isLocked() {
    return limitEnabled() && msLeft() === 0;
  }

  function startWatchTime() {
    state.watch = { until: Date.now() + (state.settings.watchMinutes || 15) * 60000 };
    persist();
  }

  function endWatchTime() {
    state.watch = { until: 0 };
    persist();
  }

  function formatLeft(ms) {
    var total = Math.ceil(ms / 1000);
    var m = Math.floor(total / 60), sec = total % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function timerChip() {
    if (!limitEnabled()) return '';
    var left = msLeft();
    return '<a class="timer' + (left < 60000 ? ' low' : '') + '" href="#/unlock" data-role="timer" aria-label="Watch time left">⏱ ' + formatLeft(left) + '</a>';
  }

  function tick() {
    var locked = isLocked();
    if (locked !== session.wasLocked) {
      session.wasLocked = locked;
      var name = route().name;
      if (name !== 'parent' && name !== 'unlock') render();
      return;
    }
    if (!locked && limitEnabled()) {
      var left = msLeft();
      var chips = root.querySelectorAll('[data-role="timer"]');
      for (var i = 0; i < chips.length; i++) {
        chips[i].textContent = '⏱ ' + formatLeft(left);
        chips[i].classList.toggle('low', left < 60000);
      }
    }
  }

  /* ---------------- routing ---------------- */

  function route() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/').map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
    return { name: parts[0] || 'videos', arg: parts.slice(1).join('/') };
  }

  function go(hash) {
    location.hash = hash;
  }

  /* ---------------- kid mode views ---------------- */

  function kidHeader(active) {
    var name = state.settings.childName || 'My Videos';
    return '' +
      '<header class="topbar">' +
        '<a class="brand" href="#/videos"><span class="brand-icon" aria-hidden="true">▶</span>' + esc(name) + '</a>' +
        (isLocked() ? '<span class="tabs"></span>' :
          '<nav class="tabs" aria-label="Sections">' +
            '<a href="#/videos" class="' + (active === 'videos' ? 'active' : '') + '">Videos</a>' +
            '<a href="#/channels" class="' + (active === 'channels' ? 'active' : '') + '">Channels</a>' +
          '</nav>') +
        (isLocked() ? '' : timerChip()) +
        '<a class="parent-link" href="#/parent" aria-label="Parent mode"><span aria-hidden="true">🔒</span><span class="parent-link-text"> Parent</span></a>' +
      '</header>';
  }

  function videoCard(v) {
    return '' +
      '<a class="card" href="#/watch/' + esc(v.youtubeId) + '">' +
        '<div class="thumb"><img src="' + esc(v.thumbnail || YTH.thumbnailUrl(v.youtubeId)) + '" alt="" loading="lazy"></div>' +
        '<div class="card-body">' +
          '<div class="card-title">' + esc(v.title) + '</div>' +
          '<div class="card-channel">' + esc(v.channelName) + '</div>' +
        '</div>' +
      '</a>';
  }

  function emptyLibrary() {
    return '' +
      '<div class="empty">' +
        '<div class="empty-icon" aria-hidden="true">📺</div>' +
        '<h2>No videos yet</h2>' +
        '<p>Ask a grown-up to add some videos in Parent mode.</p>' +
        '<a class="btn btn-primary" href="#/parent">Open Parent mode</a>' +
      '</div>';
  }

  function viewVideos(filterChannel) {
    var videos = visibleVideos();
    if (filterChannel) videos = videos.filter(function (v) { return (v.channelName || 'Other videos') === filterChannel; });
    var q = session.filter.trim().toLowerCase();
    var shown = q ? videos.filter(function (v) {
      return (v.title + ' ' + v.channelName).toLowerCase().indexOf(q) !== -1;
    }) : videos;

    var html = kidHeader(filterChannel ? 'channels' : 'videos') + '<main class="page">';
    if (!state.videos.length) {
      html += emptyLibrary();
    } else {
      if (filterChannel) {
        html += '<div class="section-head"><a class="btn btn-ghost" href="#/channels">‹ All channels</a><h1 class="section-title">' + esc(filterChannel) + '</h1></div>';
      }
      if (videos.length > 4) {
        html += '<div class="filter-row">' +
          '<input class="filter" type="search" placeholder="Find in my videos…" value="' + esc(session.filter) + '" data-role="filter" aria-label="Find in my videos" autocomplete="off">' +
        '</div>';
      }
      if (!shown.length) {
        html += '<p class="muted center">No videos match “' + esc(session.filter) + '”.</p>';
      } else {
        html += '<div class="grid">' + shown.map(videoCard).join('') + '</div>';
      }
    }
    return html + '</main>';
  }

  function viewChannels() {
    var groups = channelGroups();
    var html = kidHeader('channels') + '<main class="page">';
    if (!state.videos.length) {
      html += emptyLibrary();
    } else {
      html += '<div class="grid channels-grid">' + groups.map(function (g) {
        var thumb = g.thumbnail || (g.videos[0] && (g.videos[0].thumbnail || YTH.thumbnailUrl(g.videos[0].youtubeId)));
        return '<a class="card channel-card" href="#/channel/' + encodeURIComponent(g.name) + '">' +
          '<div class="channel-avatar"><img src="' + esc(thumb) + '" alt="" loading="lazy"></div>' +
          '<div class="card-body"><div class="card-title">' + esc(g.name) + '</div>' +
          '<div class="card-channel">' + g.videos.length + (g.videos.length === 1 ? ' video' : ' videos') + '</div></div>' +
        '</a>';
      }).join('') + '</div>';
    }
    return html + '</main>';
  }

  /* Approved videos to queue after `v`: same channel first, then the rest. */
  function upNextFor(v) {
    var all = visibleVideos().filter(function (o) { return o.youtubeId !== v.youtubeId; });
    var same = all.filter(function (o) { return o.channelName === v.channelName; });
    var rest = all.filter(function (o) { return o.channelName !== v.channelName; });
    return same.concat(rest).slice(0, 25);
  }

  function watchInfo(v) {
    return '<h1>' + esc(v.title) + '</h1><div class="muted">' + esc(v.channelName) + '</div>';
  }

  function upNextSection(v) {
    var next = upNextFor(v);
    if (!next.length) return '';
    return '<h2>Up next</h2><div class="row">' + next.map(videoCard).join('') + '</div>';
  }

  function viewWatch(id) {
    var v = findVideo(id);
    if (!v || v.hidden) {
      return kidHeader('videos') + '<main class="page"><div class="empty"><h2>That video isn’t in the library</h2><a class="btn btn-primary" href="#/videos">Back to videos</a></div></main>';
    }
    return '' +
      '<div class="watch">' +
        '<div class="watch-bar">' +
          '<button class="btn btn-ghost btn-back" data-action="back">‹ Back</button>' +
          '<div class="watch-title-sm">' + esc(v.title) + '</div>' +
          timerChip() +
        '</div>' +
        '<div class="player"><div id="yt-player"></div></div>' +
        '<div class="watch-info">' + watchInfo(v) + '</div>' +
        '<section class="more">' + upNextSection(v) + '</section>' +
      '</div>';
  }

  /* ---------------- player (YouTube IFrame API) ----------------
     The official API lets us react to player state: queue approved videos as
     a playlist, replace YouTube's end screen with our own, and stop playback
     if an unapproved video starts from the player's own overlays. */

  var player = null;
  var playerApiPromise = null;
  var mountToken = 0;

  function loadPlayerApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (playerApiPromise) return playerApiPromise;
    playerApiPromise = new Promise(function (resolve, reject) {
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) prev(); resolve(); };
      var script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = function () { reject(new Error('player API failed to load')); };
      document.head.appendChild(script);
      setTimeout(function () { reject(new Error('player API timed out')); }, 8000);
    });
    return playerApiPromise;
  }

  function destroyPlayer() {
    if (player) {
      try { player.destroy(); } catch (e) { /* ignore */ }
      player = null;
    }
  }

  /* Build the player iframe ourselves so we control its attributes. Without
     allow-popups / allow-top-navigation in `sandbox`, the links inside the
     player (title, logo, "Watch on YouTube") cannot open youtube.com. */
  function buildPlayerIframe(v, queue, withApi) {
    var params = ['rel=0', 'playsinline=1', 'iv_load_policy=3'];
    if (queue.length) params.push('playlist=' + queue.join(','));
    if (withApi) {
      params.push('enablejsapi=1');
      if (/^https?:$/.test(location.protocol)) params.push('origin=' + encodeURIComponent(location.origin));
    }
    var iframe = document.createElement('iframe');
    iframe.id = 'yt-player';
    // youtube.com honours the parent's YouTube sign-in (Premium = no ads);
    // the privacy-enhanced domain ignores it but sets no cookies.
    var host = state.settings.useYouTubeSignIn ? 'https://www.youtube.com' : 'https://www.youtube-nocookie.com';
    iframe.src = host + '/embed/' + v.youtubeId + '?' + params.join('&');
    iframe.title = v.title;
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    if (state.settings.blockYouTubeLinks !== false) {
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    }
    return iframe;
  }

  function mountPlayer(v) {
    var token = ++mountToken;
    var queue = upNextFor(v).map(function (o) { return o.youtubeId; });
    session.currentVideoId = v.youtubeId;
    session.queue = queue;

    loadPlayerApi().then(function () {
      var host = root.querySelector('#yt-player');
      if (token !== mountToken || !host) return; // navigated away
      var iframe = buildPlayerIframe(v, queue, true);
      host.replaceWith(iframe);
      player = new window.YT.Player(iframe, { events: { onStateChange: onPlayerStateChange } });
    }).catch(function () {
      // No API (offline, blocked): plain embed without playlist/end-screen handling.
      var host = root.querySelector('#yt-player');
      if (token === mountToken && host) host.replaceWith(buildPlayerIframe(v, queue, false));
    });
  }

  function onPlayerStateChange(e) {
    var states = window.YT.PlayerState;
    if (!player) return;
    if (e.data === states.PLAYING) {
      var data = player.getVideoData ? player.getVideoData() : null;
      var id = data && data.video_id;
      if (!id || id === session.currentVideoId) return;
      var v = findVideo(id);
      if (!v || v.hidden) {
        // Started from YouTube's own overlay, not from the approved queue.
        destroyPlayer();
        showPlayerScreen('<div class="end-title">That video isn’t in your library</div>');
        return;
      }
      session.currentVideoId = id;
      history.replaceState(null, '', location.pathname + location.search + '#/watch/' + id);
      var info = root.querySelector('.watch-info'); if (info) info.innerHTML = watchInfo(v);
      var bar = root.querySelector('.watch-title-sm'); if (bar) bar.textContent = v.title;
      var more = root.querySelector('.more'); if (more) more.innerHTML = upNextSection(v);
    } else if (e.data === states.ENDED) {
      var q = session.queue || [];
      var isLast = !q.length || q[q.length - 1] === session.currentVideoId;
      if (isLast) {
        destroyPlayer();
        showPlayerScreen('<div class="end-title">All done!</div>');
      }
      // Otherwise the player moves on to the next approved video by itself.
    }
  }

  function showPlayerScreen(message) {
    var box = root.querySelector('.player');
    if (!box) return;
    box.innerHTML = '<div class="end-screen">' + message +
      '<div class="btn-row">' +
        '<button class="btn btn-primary" data-action="replay">↻ Watch again</button>' +
        '<a class="btn" href="' + esc(session.lastList || '#/videos') + '">Back to videos</a>' +
      '</div></div>';
  }

  function viewLocked() {
    var expired = state.watch && state.watch.until > 0;
    return kidHeader('') + '<main class="page"><div class="empty lock-screen">' +
      '<div class="empty-icon" aria-hidden="true">' + (expired ? '⏰' : '🔒') + '</div>' +
      '<h2>' + (expired ? 'Time’s up for now!' : 'Ready to watch?') + '</h2>' +
      '<p>A grown-up can unlock ' + (state.settings.watchMinutes || 15) + ' minutes of videos.</p>' +
      '<a class="btn btn-primary btn-big" href="#/unlock">Ask a grown-up to unlock</a>' +
    '</div></main>';
  }

  function viewUnlock() {
    if (!state.settings.parentPinHash) return viewPinSetup();
    var minutes = state.settings.watchMinutes || 15;
    return pinShell(
      '<h1>Unlock ' + minutes + ' minutes</h1>' +
      '<p class="muted">Enter the parent PIN to start watch time' + (limitEnabled() && msLeft() > 0 ? ' again (the timer restarts at ' + minutes + ' minutes)' : '') + '.</p>' +
      '<form data-form="unlock">' +
        '<label>PIN<input type="password" inputmode="numeric" pattern="[0-9]*" name="pin" required autocomplete="current-password" autofocus></label>' +
        (session.pinError ? '<p class="error">' + esc(session.pinError) + '</p>' : '') +
        '<button class="btn btn-primary btn-block" type="submit">Start ' + minutes + ' minutes</button>' +
      '</form>'
    );
  }

  /* ---------------- parent mode views ---------------- */

  function viewParent() {
    var html;
    if (!state.settings.parentPinHash) html = viewPinSetup();
    else if (!session.unlocked) html = viewPinEntry();
    else html = viewDashboard();
    return html;
  }

  function pinShell(inner) {
    return '<main class="page narrow"><div class="pin-box">' + inner + '</div>' +
      '<p class="center"><a class="btn btn-ghost" href="#/videos">‹ Back to videos</a></p></main>';
  }

  function viewPinSetup() {
    return pinShell(
      '<h1>Create a parent PIN</h1>' +
      '<p class="muted">Pick 4 or more digits. It only stops accidental taps, so keep it simple. If you forget it, clear this site’s data in your browser to start over.</p>' +
      '<form data-form="pin-setup">' +
        '<label>PIN<input type="password" inputmode="numeric" pattern="[0-9]*" name="pin" minlength="4" required autocomplete="new-password" autofocus></label>' +
        '<label>Confirm PIN<input type="password" inputmode="numeric" pattern="[0-9]*" name="confirm" minlength="4" required autocomplete="new-password"></label>' +
        (session.pinError ? '<p class="error">' + esc(session.pinError) + '</p>' : '') +
        '<button class="btn btn-primary btn-block" type="submit">Save PIN and continue</button>' +
      '</form>'
    );
  }

  function viewPinEntry() {
    return pinShell(
      '<h1>Parent mode</h1>' +
      '<p class="muted">Enter your PIN to manage the library.</p>' +
      '<form data-form="pin-entry">' +
        '<label>PIN<input type="password" inputmode="numeric" pattern="[0-9]*" name="pin" required autocomplete="current-password" autofocus></label>' +
        (session.pinError ? '<p class="error">' + esc(session.pinError) + '</p>' : '') +
        '<button class="btn btn-primary btn-block" type="submit">Unlock</button>' +
      '</form>'
    );
  }

  function sourceRow(s) {
    var vids = state.videos.filter(function (v) { return v.sourceId === s.id; });
    var hiddenCount = vids.filter(function (v) { return v.hidden; }).length;
    var thumb = s.thumbnail || (s.type === 'video' ? YTH.thumbnailUrl(s.youtubeId) : '');
    var html = '<li class="source">' +
      '<div class="source-main">' +
        '<div class="source-thumb ' + (s.type === 'channel' ? 'round' : '') + '">' + (thumb ? '<img src="' + esc(thumb) + '" alt="">' : '') + '</div>' +
        '<div class="source-text">' +
          '<div class="source-title">' + esc(s.title) + ' <span class="badge">' + (s.type === 'channel' ? 'Channel' : 'Video') + '</span></div>' +
          '<div class="muted small">' + (s.type === 'channel'
            ? vids.length + ' videos' + (hiddenCount ? ' · ' + hiddenCount + ' hidden' : '') + (s.lastSyncedAt ? ' · updated ' + formatDate(s.lastSyncedAt) : '')
            : esc(s.channelName) + ' · added ' + formatDate(s.addedAt)) + '</div>' +
        '</div>' +
        '<div class="source-actions">' +
          (s.type === 'channel' ? '<button class="btn btn-small" data-action="refresh-source" data-id="' + esc(s.id) + '"' + (session.busy ? ' disabled' : '') + '>Refresh</button>' : '') +
          '<button class="btn btn-small btn-danger" data-action="remove-source" data-id="' + esc(s.id) + '">Remove</button>' +
        '</div>' +
      '</div>';
    if (s.type === 'channel' && vids.length) {
      html += '<details class="source-videos" data-details="' + esc(s.id) + '"' + (session.open[s.id] ? ' open' : '') + '><summary>Show videos (tap a video to hide or show it)</summary><ul>' +
        vids.sort(function (a, b) { return sortKey(b).localeCompare(sortKey(a)); }).map(function (v) {
          return '<li class="' + (v.hidden ? 'is-hidden' : '') + '">' +
            '<button class="video-toggle" data-action="toggle-hidden" data-video="' + esc(v.youtubeId) + '" aria-pressed="' + (v.hidden ? 'true' : 'false') + '">' +
              '<img src="' + esc(YTH.thumbnailUrl(v.youtubeId, 'default')) + '" alt="">' +
              '<span class="video-toggle-title">' + esc(v.title) + '</span>' +
              '<span class="badge">' + (v.hidden ? 'Hidden' : 'Shown') + '</span>' +
            '</button></li>';
        }).join('') + '</ul></details>';
    }
    return html + '</li>';
  }

  function viewDashboard() {
    var channelCount = state.sources.filter(function (s) { return s.type === 'channel'; }).length;
    return '' +
      '<header class="topbar parent-bar">' +
        '<div class="brand"><span class="brand-icon" aria-hidden="true">🔒</span>Parent mode</div>' +
        '<button class="btn btn-primary" data-action="lock">Done · Kid mode</button>' +
      '</header>' +
      '<main class="page narrow">' +

      '<section class="panel">' +
        '<h2>Add a video or channel</h2>' +
        '<form data-form="add" class="add-form">' +
          '<input type="text" name="url" placeholder="Paste a YouTube link…" required autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url"' + (session.busy ? ' disabled' : '') + '>' +
          '<button class="btn btn-primary" type="submit"' + (session.busy ? ' disabled' : '') + '>' + (session.busy ? 'Working…' : 'Add') + '</button>' +
        '</form>' +
        statusHtml('add') +
        '<p class="muted small">Works with youtube.com/watch, youtu.be, Shorts and embed links. ' +
          (state.settings.apiKey ? 'Channel links (youtube.com/@name) add that channel’s latest uploads.' : 'To add whole channels, enter a YouTube API key in Settings below.') +
          ' <a href="#" data-action="use-sample">Try a sample video</a></p>' +
      '</section>' +

      '<section class="panel">' +
        '<div class="panel-head"><h2>Watch time</h2>' +
          '<span class="badge">' + (!(state.settings.watchMinutes || 0) ? 'No limit' : msLeft() > 0 ? formatLeft(msLeft()) + ' left' : 'Locked') + '</span></div>' +
        '<p class="muted small">Kid mode stays locked until you unlock it with your PIN. It relocks when the time runs out.</p>' +
        statusHtml('watch') +
        '<form data-form="watch-time" class="btn-row">' +
          '<label class="inline">Unlock for <select name="watchMinutes">' +
            [0, 5, 10, 15, 20, 30, 45, 60].map(function (m) {
              return '<option value="' + m + '"' + ((state.settings.watchMinutes || 0) === m ? ' selected' : '') + '>' + (m ? m + ' minutes' : 'No limit (always unlocked)') + '</option>';
            }).join('') + '</select></label>' +
          '<button class="btn" type="submit">Save</button>' +
        '</form>' +
        ((state.settings.watchMinutes || 0) ? '<div class="btn-row">' +
          '<button class="btn btn-primary" data-action="start-watch">Start ' + state.settings.watchMinutes + ' minutes now</button>' +
          (msLeft() > 0 ? '<button class="btn" data-action="end-watch">Lock now</button>' : '') +
        '</div>' : '') +
      '</section>' +

      '<section class="panel">' +
        '<div class="panel-head"><h2>Approved library</h2>' +
          (channelCount ? '<button class="btn btn-small" data-action="refresh-all"' + (session.busy ? ' disabled' : '') + '>Refresh all channels</button>' : '') +
        '</div>' +
        (state.sources.length
          ? '<ul class="sources">' + state.sources.slice().sort(function (a, b) { return (b.addedAt || '').localeCompare(a.addedAt || ''); }).map(sourceRow).join('') + '</ul>'
          : '<p class="muted">Nothing approved yet. Paste a link above to get started.</p>') +
      '</section>' +

      '<section class="panel">' +
        '<h2>Settings</h2>' +
        '<form data-form="settings">' +
          '<label>Library name (shown to your child)<input type="text" name="childName" value="' + esc(state.settings.childName) + '" maxlength="40"></label>' +
          '<label>YouTube Data API key (optional, needed for channels)<input type="password" name="apiKey" value="' + esc(state.settings.apiKey) + '" autocomplete="off" placeholder="AIza…"></label>' +
          '<p class="muted small">Create a free key in Google Cloud Console (YouTube Data API v3). It is stored only in this browser. See the README for steps.</p>' +
          '<label class="check"><input type="checkbox" name="blockYouTubeLinks"' + (state.settings.blockYouTubeLinks !== false ? ' checked' : '') + '> Block links to youtube.com inside the player <span class="muted small">(recommended; turn off if videos show as unavailable)</span></label>' +
          '<label class="check"><input type="checkbox" name="useYouTubeSignIn"' + (state.settings.useYouTubeSignIn ? ' checked' : '') + '> Use my YouTube sign-in <span class="muted small">(with YouTube Premium, videos play without ads; sign in to youtube.com in this browser first)</span></label>' +
          '<button class="btn" type="submit">Save settings</button>' +
        '</form>' +
        statusHtml('settings') +
        '<details class="subpanel" data-details="change-pin"' + (session.open['change-pin'] ? ' open' : '') + '><summary>Change PIN</summary>' +
          '<form data-form="change-pin">' +
            '<label>New PIN<input type="password" inputmode="numeric" pattern="[0-9]*" name="pin" minlength="4" required autocomplete="new-password"></label>' +
            '<label>Confirm new PIN<input type="password" inputmode="numeric" pattern="[0-9]*" name="confirm" minlength="4" required autocomplete="new-password"></label>' +
            '<button class="btn" type="submit">Update PIN</button>' +
          '</form>' +
        '</details>' +
      '</section>' +

      '<section class="panel">' +
        '<h2>Backup &amp; move to another device</h2>' +
        '<p class="muted small">Export your library as a JSON file, then import it on another phone, tablet or computer. Your PIN is not included.</p>' +
        '<div class="btn-row">' +
          '<button class="btn" data-action="export">Download backup</button>' +
          '<button class="btn" data-action="copy-export">Copy to clipboard</button>' +
          '<label class="btn file-btn">Import backup<input type="file" accept="application/json,.json" data-role="import" hidden></label>' +
        '</div>' +
        statusHtml('backup') +
      '</section>' +

      '<section class="panel danger-zone">' +
        '<h2>Start over</h2>' +
        '<button class="btn btn-danger" data-action="reset">Delete all videos, settings and PIN</button>' +
      '</section>' +
      '</main>';
  }

  /* ---------------- render ---------------- */

  function render() {
    var r = route();
    var html;
    var mode = 'kid';
    destroyPlayer();
    session.wasLocked = isLocked();
    switch (r.name) {
      case 'parent': html = viewParent(); mode = 'parent'; break;
      case 'unlock': html = viewUnlock(); mode = 'parent'; break;
      case 'watch': html = isLocked() ? viewLocked() : viewWatch(r.arg); mode = isLocked() ? 'kid' : 'watch'; break;
      case 'channels': html = isLocked() ? viewLocked() : viewChannels(); break;
      case 'channel': html = isLocked() ? viewLocked() : viewVideos(r.arg); break;
      default: html = isLocked() ? viewLocked() : viewVideos(null);
    }
    document.body.dataset.mode = mode;
    var active = document.activeElement;
    var keepFocus = active && active.dataset && active.dataset.role === 'filter';
    var selStart = keepFocus ? active.selectionStart : 0;
    root.innerHTML = html;
    if (keepFocus) {
      var f = root.querySelector('[data-role="filter"]');
      if (f) { f.focus(); try { f.setSelectionRange(selStart, selStart); } catch (e) { /* ignore */ } }
    }
    var auto = root.querySelector('[autofocus]');
    if (auto && !keepFocus && mode === 'parent') auto.focus();
    if (mode === 'watch') {
      var current = findVideo(r.arg);
      if (current && !current.hidden) mountPlayer(current);
    }
  }

  /* ---------------- actions ---------------- */

  function addFromUrl(url) {
    var ref = YTH.parseYouTubeUrl(url);
    if (!ref) {
      setStatus('error', 'That doesn’t look like a YouTube video or channel link.');
      return;
    }
    if (ref.type === 'video') return addVideo(ref.id);
    return addChannel(ref);
  }

  function addVideo(videoId) {
    if (findVideo(videoId)) {
      setStatus('info', 'That video is already in the library.');
      return;
    }
    session.busy = true;
    setStatus('info', 'Looking up video details…');
    var key = state.settings.apiKey;
    var lookup = key
      ? YTH.fetchVideoDetails(key, videoId).catch(function () { return null; })
      : Promise.resolve(null);
    return lookup.then(function (details) {
      return details || YTH.fetchVideoMetadata(videoId);
    }).then(function (meta) {
      var now = new Date().toISOString();
      var source = {
        id: STORE.uid(),
        type: 'video',
        youtubeId: videoId,
        title: meta ? meta.title : 'YouTube video ' + videoId,
        channelName: meta ? meta.channelName : '',
        addedAt: now
      };
      state.sources.push(source);
      state.videos.push({
        youtubeId: videoId,
        title: source.title,
        channelName: source.channelName,
        thumbnail: YTH.thumbnailUrl(videoId),
        sourceId: source.id,
        publishedAt: (meta && meta.publishedAt) || '',
        addedAt: now
      });
      persist();
      session.busy = false;
      setStatus(meta ? 'ok' : 'warn', meta
        ? 'Added “' + source.title + '”.'
        : 'Added the video, but its title couldn’t be fetched. It will still play.');
    }).catch(function (err) {
      session.busy = false;
      setStatus('error', 'Could not add that video: ' + err.message);
    });
  }

  function addChannel(ref) {
    var key = state.settings.apiKey;
    if (!key) {
      setStatus('error', 'Adding a whole channel needs a YouTube Data API key. Add one in Settings below, or paste individual video links instead.');
      return;
    }
    session.busy = true;
    setStatus('info', 'Looking up channel…');
    return YTH.resolveChannel(key, ref).then(function (ch) {
      var dup = state.sources.filter(function (s) { return s.type === 'channel' && s.youtubeId === ch.channelId; })[0];
      if (dup) throw new Error('“' + dup.title + '” is already in the library.');
      var source = {
        id: STORE.uid(),
        type: 'channel',
        youtubeId: ch.channelId,
        uploadsPlaylistId: ch.uploadsPlaylistId,
        title: ch.title,
        channelName: ch.title,
        thumbnail: ch.thumbnail,
        addedAt: new Date().toISOString(),
        lastSyncedAt: null
      };
      state.sources.push(source);
      return syncChannel(source).then(function (count) {
        persist();
        session.busy = false;
        setStatus('ok', 'Added channel “' + ch.title + '” with ' + count + ' videos.');
      });
    }).catch(function (err) {
      session.busy = false;
      setStatus('error', err.message);
    });
  }

  /* Pull the latest uploads for a channel source, keeping hidden flags. */
  function syncChannel(source) {
    return YTH.fetchChannelUploads(state.settings.apiKey, source.uploadsPlaylistId, 50).then(function (uploads) {
      var existing = {};
      state.videos.forEach(function (v) { existing[v.youtubeId] = v; });
      var added = 0;
      uploads.forEach(function (u) {
        var cur = existing[u.youtubeId];
        if (cur) {
          if (cur.sourceId === source.id) { cur.title = u.title; cur.publishedAt = u.publishedAt || cur.publishedAt; }
          return; // already approved (maybe individually) – leave it alone
        }
        state.videos.push({
          youtubeId: u.youtubeId,
          title: u.title,
          channelName: u.channelName || source.title,
          thumbnail: u.thumbnail,
          sourceId: source.id,
          publishedAt: u.publishedAt || '',
          addedAt: new Date().toISOString()
        });
        added++;
      });
      source.lastSyncedAt = new Date().toISOString();
      return added;
    });
  }

  function refreshSources(sources) {
    session.busy = true;
    setStatus('info', 'Checking for new videos…');
    var total = 0;
    var chain = Promise.resolve();
    sources.forEach(function (s) {
      chain = chain.then(function () { return syncChannel(s).then(function (n) { total += n; }); });
    });
    return chain.then(function () {
      persist();
      session.busy = false;
      setStatus('ok', total ? 'Found ' + total + ' new ' + (total === 1 ? 'video' : 'videos') + '.' : 'No new videos.');
    }).catch(function (err) {
      persist();
      session.busy = false;
      setStatus('error', err.message);
    });
  }

  function removeSource(id) {
    var s = findSource(id);
    if (!s) return;
    if (!confirm('Remove “' + s.title + '” from the library?')) return;
    state.sources = state.sources.filter(function (x) { return x.id !== id; });
    state.videos = state.videos.filter(function (v) { return v.sourceId !== id; });
    persist();
    setStatus('ok', 'Removed “' + s.title + '”.');
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var added = STORE.importJson(state, reader.result);
        persist();
        setStatus('ok', 'Imported ' + added + ' new ' + (added === 1 ? 'item' : 'items') + '.', 'backup');
      } catch (err) {
        setStatus('error', 'Import failed: ' + err.message, 'backup');
      }
    };
    reader.readAsText(file);
  }

  function setPin(form, onDone) {
    var pin = form.pin.value.trim();
    var confirmPin = form.confirm.value.trim();
    if (!/^\d{4,}$/.test(pin)) { session.pinError = 'Use at least 4 digits.'; render(); return; }
    if (pin !== confirmPin) { session.pinError = 'The PINs don’t match.'; render(); return; }
    STORE.hashPin(pin).then(function (hash) {
      state.settings.parentPinHash = hash;
      session.pinError = '';
      persist();
      onDone();
    });
  }

  /* ---------------- events ---------------- */

  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.tagName === 'A') e.preventDefault();
    switch (action) {
      case 'back': go(session.lastList || '#/videos'); break;
      case 'replay': render(); break;
      case 'start-watch': startWatchTime(); setStatus('ok', 'Unlocked for ' + state.settings.watchMinutes + ' minutes.', 'watch'); break;
      case 'end-watch': endWatchTime(); setStatus('ok', 'Locked.', 'watch'); break;
      case 'lock':
        session.unlocked = false; session.status = null; session.filter = '';
        go('#/videos');
        break;
      case 'remove-source': removeSource(el.dataset.id); break;
      case 'refresh-source': refreshSources([findSource(el.dataset.id)].filter(Boolean)); break;
      case 'refresh-all': refreshSources(state.sources.filter(function (s) { return s.type === 'channel'; })); break;
      case 'toggle-hidden': {
        var v = findVideo(el.dataset.video);
        if (v) { v.hidden = !v.hidden; persist(); render(); }
        break;
      }
      case 'use-sample': {
        var input = root.querySelector('[data-form="add"] input[name="url"]');
        if (input) { input.value = SAMPLE_URL; input.focus(); }
        break;
      }
      case 'export': download('kidtube-backup-' + new Date().toISOString().slice(0, 10) + '.json', STORE.exportJson(state)); break;
      case 'copy-export':
        if (navigator.clipboard) {
          navigator.clipboard.writeText(STORE.exportJson(state)).then(function () { setStatus('ok', 'Backup copied to clipboard.', 'backup'); },
            function () { setStatus('error', 'Clipboard not available. Use Download instead.', 'backup'); });
        } else setStatus('error', 'Clipboard not available. Use Download instead.', 'backup');
        break;
      case 'reset':
        if (confirm('Delete everything, including the PIN? This cannot be undone.')) {
          STORE.clear();
          state = STORE.load();
          session.unlocked = false; session.status = null;
          go('#/videos'); render();
        }
        break;
    }
  });

  root.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    switch (form.dataset.form) {
      case 'pin-setup':
        setPin(form, function () {
          if (route().name === 'unlock') { startWatchTime(); go(session.lastList || '#/videos'); }
          else { session.unlocked = true; render(); }
        });
        break;
      case 'unlock':
        STORE.hashPin(form.pin.value.trim()).then(function (hash) {
          if (hash !== state.settings.parentPinHash) { session.pinError = 'Wrong PIN, try again.'; render(); return; }
          session.pinError = '';
          startWatchTime();
          go(session.lastList || '#/videos');
        });
        break;
      case 'watch-time':
        state.settings.watchMinutes = parseInt(form.watchMinutes.value, 10) || 0;
        persist();
        setStatus('ok', state.settings.watchMinutes ? 'Watch time set to ' + state.settings.watchMinutes + ' minutes per unlock.' : 'Time limit turned off.', 'watch');
        break;
      case 'pin-entry':
        STORE.hashPin(form.pin.value.trim()).then(function (hash) {
          if (hash === state.settings.parentPinHash) { session.unlocked = true; session.pinError = ''; }
          else session.pinError = 'Wrong PIN, try again.';
          render();
        });
        break;
      case 'change-pin':
        setPin(form, function () { setStatus('ok', 'PIN updated.', 'settings'); });
        break;
      case 'add':
        if (session.busy) return;
        addFromUrl(form.url.value);
        break;
      case 'settings':
        state.settings.childName = form.childName.value.trim() || 'My Videos';
        state.settings.apiKey = form.apiKey.value.trim();
        state.settings.blockYouTubeLinks = form.blockYouTubeLinks.checked;
        state.settings.useYouTubeSignIn = form.useYouTubeSignIn.checked;
        persist();
        setStatus('ok', 'Settings saved.', 'settings');
        break;
    }
  });

  root.addEventListener('input', function (e) {
    if (e.target.dataset.role === 'filter') {
      session.filter = e.target.value;
      render();
    }
  });

  root.addEventListener('toggle', function (e) {
    if (e.target.dataset && e.target.dataset.details) session.open[e.target.dataset.details] = e.target.open;
  }, true);

  root.addEventListener('change', function (e) {
    if (e.target.dataset.role === 'import' && e.target.files[0]) importFile(e.target.files[0]);
  });

  window.addEventListener('hashchange', function () {
    session.pinError = '';
    var name = route().name;
    if (name === 'videos' || name === 'channels' || name === 'channel') session.lastList = location.hash;
    if (name !== 'parent') session.status = null;
    if (route().name !== 'videos' && route().name !== 'channel') session.filter = '';
    render();
    window.scrollTo(0, 0);
  });

  // Always start in kid mode: a reload never lands in an unlocked parent view.
  render();
  setInterval(tick, 1000);
})();

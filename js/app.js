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
    state.watch = state.watch || {};
    state.watch.until = Date.now() + (state.settings.watchMinutes || 15) * 60000;
    persist();
  }

  function endWatchTime() {
    state.watch = state.watch || {};
    state.watch.until = 0;
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
    return '<a class="timer' + (left < 60000 ? ' low' : '') + '" href="#/unlock" aria-label="Watch time left">' + icon('timer') + '<span data-role="timer">' + formatLeft(left) + '</span></a>';
  }

  /* When the timer interrupts a video, remember it so the next unlock
     resumes where the child left off. */
  function saveResumePoint() {
    var pos = session.lastPos;
    if (route().name === 'watch' && pos && pos.youtubeId === session.currentVideoId && findVideo(pos.youtubeId)) {
      state.watch.resume = { youtubeId: pos.youtubeId, seconds: Math.max(0, Math.floor(pos.seconds)), queue: (session.playQueue || []).slice(), savedAt: new Date().toISOString() };
    } else {
      delete state.watch.resume;
    }
    persist();
  }

  function resumeVideo() {
    var r = state.watch && state.watch.resume;
    var v = r && findVideo(r.youtubeId);
    return v && !v.hidden ? v : null;
  }

  /* Where to send the child after an unlock: the interrupted video, or the list. */
  function afterUnlockHash() {
    var v = resumeVideo();
    if (!v) return session.lastList || '#/videos';
    session.resume = state.watch.resume;
    delete state.watch.resume;
    persist();
    return '#/watch/' + v.youtubeId;
  }

  function tick() {
    var locked = isLocked();
    if (!locked && route().name === 'watch' && player && player.getCurrentTime) {
      try { session.lastPos = { youtubeId: session.currentVideoId, seconds: player.getCurrentTime() || 0 }; } catch (e) { /* ignore */ }
    }
    if (locked !== session.wasLocked) {
      session.wasLocked = locked;
      if (locked) saveResumePoint();
      var name = route().name;
      if (name !== 'parent' && name !== 'unlock') render();
      return;
    }
    if (!locked && limitEnabled()) {
      var left = msLeft();
      var chips = root.querySelectorAll('[data-role="timer"]');
      for (var i = 0; i < chips.length; i++) {
        chips[i].textContent = formatLeft(left);
        chips[i].parentNode.classList.toggle('low', left < 60000);
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

  var ICONS = {
    home: 'M12 4.33l7 6.12V20h-4v-6H9v6H5v-9.55l7-6.12M12 3L4 10v11h7v-6h2v6h7V10l-8-7z',
    channels: 'M20 8H4V6h16v2zm-2-6H6v2h12V2zm4 10v8c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-8c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2zm-6 4l-6-3.27v6.53L16 16z',
    lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    timer: 'M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0 0 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9a8.994 8.994 0 0 0 7.03-14.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
    replay: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z'
  };

  function icon(name) {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[name] + '"/></svg>';
  }

  function logoHtml() {
    return '<span class="logo" aria-hidden="true"><svg viewBox="0 0 28 20"><rect width="28" height="20" rx="6" fill="#f00"/><path d="M11 5.5v9l7.5-4.5z" fill="#fff"/></svg></span>';
  }

  function channelThumb(name) {
    for (var i = 0; i < state.sources.length; i++) {
      var s = state.sources[i];
      if (s.type === 'channel' && s.title === name && s.thumbnail) return s.thumbnail;
    }
    return '';
  }

  /* YouTube-style round avatar: the channel picture when known, else a
     coloured circle with the channel's initial. */
  function avatarHtml(name) {
    var src = channelThumb(name);
    if (src) return '<span class="avatar"><img src="' + esc(src) + '" alt="" loading="lazy"></span>';
    var h = 0;
    for (var i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    var initial = (name || '').trim().charAt(0).toUpperCase() || '▶';
    return '<span class="avatar" style="background:hsl(' + (h % 360) + ',45%,42%)">' + esc(initial) + '</span>';
  }

  function kidHeader(active) {
    var name = state.settings.childName || 'My Videos';
    return '' +
      '<header class="topbar">' +
        '<a class="brand" href="#/videos">' + logoHtml() + '<span class="brand-name">' + esc(name) + '</span></a>' +
        (isLocked() ? '<span class="tabs"></span>' :
          '<nav class="tabs" aria-label="Sections">' +
            '<a href="#/videos" class="' + (active === 'videos' ? 'active' : '') + '">' + icon('home') + '<span>Home</span></a>' +
            '<a href="#/channels" class="' + (active === 'channels' ? 'active' : '') + '">' + icon('channels') + '<span>Channels</span></a>' +
          '</nav>') +
        '<div class="topbar-right">' +
          (isLocked() ? '' : timerChip()) +
          '<a class="parent-link" href="#/parent" aria-label="Parent mode">' + icon('lock') + '<span class="parent-link-text">Parent</span></a>' +
        '</div>' +
      '</header>';
  }

  function videoCard(v) {
    return '' +
      '<a class="card" href="#/watch/' + esc(v.youtubeId) + '">' +
        '<div class="thumb"><img src="' + esc(v.thumbnail || YTH.thumbnailUrl(v.youtubeId)) + '" alt="" loading="lazy"></div>' +
        '<div class="card-body">' +
          avatarHtml(v.channelName) +
          '<div class="card-text">' +
            '<div class="card-title">' + esc(v.title) + '</div>' +
            '<div class="card-channel">' + esc(v.channelName) + '</div>' +
          '</div>' +
        '</div>' +
      '</a>';
  }

  /* YouTube-style chip row: All + one chip per channel. */
  function chipRow(active) {
    var groups = channelGroups();
    if (groups.length < 2) return '';
    return '<div class="chips-wrap"><div class="chips">' +
      '<a class="chip' + (!active ? ' active' : '') + '" href="#/videos">All</a>' +
      groups.map(function (g) {
        return '<a class="chip' + (active === g.name ? ' active' : '') + '" href="#/channel/' + encodeURIComponent(g.name) + '">' + esc(g.name) + '</a>';
      }).join('') + '</div></div>';
  }

  function emptyLibrary() {
    return '' +
      '<div class="empty">' +
        '<div class="empty-icon" aria-hidden="true">' + logoHtml() + '</div>' +
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

    var html = kidHeader('videos');
    if (!state.videos.length) {
      html += '<main class="page">' + emptyLibrary();
    } else {
      html += chipRow(filterChannel) + '<main class="page">';
      if (filterChannel) {
        html += '<div class="section-head">' + avatarHtml(filterChannel) + '<h1 class="section-title">' + esc(filterChannel) + '</h1>' +
          '<span class="muted small">' + videos.length + (videos.length === 1 ? ' video' : ' videos') + '</span></div>';
      }
      if (videos.length > 4) {
        html += '<div class="filter-row"><label class="filter-box">' + icon('search') +
          '<input class="filter" type="search" placeholder="Find in my videos" value="' + esc(session.filter) + '" data-role="filter" aria-label="Find in my videos" autocomplete="off">' +
        '</label></div>';
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
      html += '<h1 class="page-title">Channels</h1><div class="channel-list">' + groups.map(function (g) {
        return '<a class="channel-card" href="#/channel/' + encodeURIComponent(g.name) + '">' +
          '<span class="channel-avatar">' + avatarHtml(g.name) + '</span>' +
          '<span class="card-body"><span class="card-title">' + esc(g.name) + '</span>' +
          '<span class="card-channel">' + g.videos.length + (g.videos.length === 1 ? ' video' : ' videos') + '</span></span>' +
        '</a>';
      }).join('') + '</div>';
    }
    return html + '</main>';
  }

  /* Approved videos to queue after `v`: same channel first, then the rest. */
  /* Approved videos to play after `v`: same channel first, then the rest. */
  function upNextFor(v) {
    var all = visibleVideos().filter(function (o) { return o.youtubeId !== v.youtubeId; });
    var same = all.filter(function (o) { return o.channelName === v.channelName; });
    var rest = all.filter(function (o) { return o.channelName !== v.channelName; });
    return same.concat(rest).slice(0, 50);
  }

  function watchInfo(v) {
    return '<h1>' + esc(v.title) + '</h1>' +
      '<a class="channel-row" href="#/channel/' + encodeURIComponent(v.channelName || 'Other videos') + '">' + avatarHtml(v.channelName) +
        '<span class="channel-row-name">' + esc(v.channelName) + '</span></a>';
  }

  /* The "Up next" row always shows the remaining queue, in play order. */
  function queuedVideos() {
    return (session.playQueue || []).map(findVideo).filter(function (o) { return o && !o.hidden; });
  }

  function upNextSection() {
    var next = queuedVideos();
    if (!next.length) return '';
    return '<h2>Up next</h2><div class="up-next">' + next.map(videoCard).join('') + '</div>';
  }

  function viewWatch(id) {
    var v = findVideo(id);
    if (!v || v.hidden) {
      return kidHeader('videos') + '<main class="page"><div class="empty"><h2>That video isn’t in the library</h2><a class="btn btn-primary" href="#/videos">Back to videos</a></div></main>';
    }
    if (session.resume && session.resume.youtubeId === id) {
      session.playQueue = (session.resume.queue || []).filter(function (q) { var o = findVideo(q); return o && !o.hidden && q !== id; });
      session.startAt = session.resume.seconds || 0;
      session.resume = null;
    } else if (!session.playQueue || !session.playQueue.length || session.currentVideoId !== id) {
      session.playQueue = upNextFor(v).map(function (o) { return o.youtubeId; });
    }
    return '' +
      '<div class="watch">' +
        '<header class="topbar watch-bar">' +
          '<button class="icon-btn btn-back" data-action="back" aria-label="Back">' + icon('back') + '</button>' +
          '<a class="brand" href="#/videos">' + logoHtml() + '<span class="brand-name">' + esc(state.settings.childName || 'My Videos') + '</span></a>' +
          '<div class="watch-title-sm">' + esc(v.title) + '</div>' +
          '<div class="topbar-right">' + timerChip() + '</div>' +
        '</header>' +
        '<div class="watch-layout">' +
          '<div class="watch-main">' +
            '<div class="player"><div id="yt-player"></div></div>' +
            '<div class="watch-info">' + watchInfo(v) + '</div>' +
          '</div>' +
          '<section class="more">' + upNextSection() + '</section>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- player (YouTube IFrame API) ----------------
     The official API lets us react to player state. The app keeps its own
     queue of approved videos and advances the same player with
     loadVideoById, so "Up next" is always exactly what plays next. It also
     replaces YouTube's end screen with our own and stops playback if an
     unapproved video keeps playing (e.g. picked from the player's overlay). */

  var player = null;
  var playerApiPromise = null;
  var mountToken = 0;
  var UNKNOWN_GRACE_MS = 30000; // pre-roll/mid-roll ads report their own ids; give them time to pass

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
    clearTimeout(session.unknownTimer); session.unknownTimer = null;
    if (player) {
      try { player.destroy(); } catch (e) { /* ignore */ }
      player = null;
    }
  }

  /* Build the player iframe ourselves so we control its attributes. Without
     allow-popups / allow-top-navigation in `sandbox`, the links inside the
     player (title, logo, "Watch on YouTube") cannot open youtube.com. */
  function buildPlayerIframe(v, withApi) {
    var params = ['rel=0', 'playsinline=1', 'iv_load_policy=3'];
    if (session.startAt > 0 && session.currentVideoId === v.youtubeId) params.push('start=' + Math.floor(session.startAt));
    session.startAt = 0;
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
    session.currentVideoId = v.youtubeId;
    loadPlayerApi().then(function () {
      var host = root.querySelector('#yt-player');
      if (token !== mountToken || !host) return; // navigated away
      var iframe = buildPlayerIframe(v, true);
      host.replaceWith(iframe);
      player = new window.YT.Player(iframe, { events: { onStateChange: onPlayerStateChange } });
    }).catch(function () {
      // No API (offline, blocked): plain embed without queue/end-screen handling.
      var host = root.querySelector('#yt-player');
      if (token === mountToken && host) host.replaceWith(buildPlayerIframe(v, false));
    });
  }

  /* Update title, URL and the Up-next row for the video now playing. */
  function showNowPlaying(v) {
    session.currentVideoId = v.youtubeId;
    session.playQueue = (session.playQueue || []).filter(function (id) { return id !== v.youtubeId; });
    history.replaceState(null, '', location.pathname + location.search + '#/watch/' + v.youtubeId);
    var info = root.querySelector('.watch-info'); if (info) info.innerHTML = watchInfo(v);
    var bar = root.querySelector('.watch-title-sm'); if (bar) bar.textContent = v.title;
    var more = root.querySelector('.more'); if (more) more.innerHTML = upNextSection();
  }

  /* Switch the running player to another approved video without rebuilding
     the iframe (keeps playback going on iOS, which needs a tap per iframe). */
  function playInPlace(v) {
    if (!player || !player.loadVideoById) return false;
    showNowPlaying(v);
    player.loadVideoById(v.youtubeId);
    return true;
  }

  function onPlayerStateChange(e) {
    var states = window.YT.PlayerState;
    if (!player) return;
    if (e.data === states.PLAYING) {
      var data = player.getVideoData ? player.getVideoData() : null;
      var id = data && data.video_id;
      if (!id) return;
      var v = findVideo(id);
      if (v && !v.hidden) {
        clearTimeout(session.unknownTimer); session.unknownTimer = null;
        if (id !== session.currentVideoId) showNowPlaying(v); // e.g. picked from the overlay
        return;
      }
      // An unknown id is usually an ad; only act if it is still playing later.
      if (!session.unknownTimer) {
        session.unknownTimer = setTimeout(function () {
          session.unknownTimer = null;
          if (!player || !player.getVideoData) return;
          var now = player.getVideoData().video_id;
          var known = findVideo(now);
          if (!now || (known && !known.hidden)) return;
          destroyPlayer();
          showPlayerScreen('<div class="end-title">That video isn’t in your library</div>');
        }, (window.KIDTUBE_TEST && window.KIDTUBE_TEST.unknownGraceMs) || UNKNOWN_GRACE_MS);
      }
    } else if (e.data === states.ENDED) {
      var next = queuedVideos()[0];
      if (next && playInPlace(next)) return;
      destroyPlayer();
      showPlayerScreen('<div class="end-title">All done!</div>');
    }
  }

  function showPlayerScreen(message) {
    var box = root.querySelector('.player');
    if (!box) return;
    box.innerHTML = '<div class="end-screen">' + message +
      '<div class="btn-row">' +
        '<button class="btn btn-primary" data-action="replay">' + icon('replay') + 'Watch again</button>' +
        '<a class="btn" href="' + esc(session.lastList || '#/videos') + '">Back to videos</a>' +
      '</div></div>';
  }

  function viewLocked() {
    var expired = state.watch && state.watch.until > 0;
    return kidHeader('') + '<main class="page"><div class="empty lock-screen">' +
      '<div class="empty-icon" aria-hidden="true">' + icon(expired ? 'timer' : 'lock') + '</div>' +
      '<h2>' + (expired ? 'Time’s up for now!' : 'Ready to watch?') + '</h2>' +
      '<p>A grown-up can unlock ' + (state.settings.watchMinutes || 15) + ' minutes of videos.</p>' +
      '<a class="btn btn-primary btn-big" href="#/unlock">Ask a grown-up to unlock</a>' +
      (resumeVideo() ? '<div class="resume-note"><img src="' + esc(YTH.thumbnailUrl(resumeVideo().youtubeId, 'default')) + '" alt=""><div><div class="muted small">Next time, continue watching</div><div class="resume-title">' + esc(resumeVideo().title) + '</div></div></div>' : '') +
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

  /* ---------------- import from a share link ---------------- */

  function viewImport(payload) {
    var isSample = payload === 'sample';
    var head = '<header class="topbar parent-bar"><div class="brand">' + logoHtml() + '<span class="brand-name">' + (isSample ? 'Sample library' : 'Shared library') + '</span></div></header>';
    var imp = session.import;
    if (!imp || imp.key !== payload) {
      session.import = { key: payload, data: null, error: null };
      var decoded = isSample
        ? Promise.resolve(JSON.parse(JSON.stringify(window.SAMPLE_LIBRARY || null)))
        : STORE.decodeShare(payload);
      decoded.then(function (data) {
        if (!data || !Array.isArray(data.sources) || !Array.isArray(data.videos)) throw new Error('This is not a Kid Tube share link.');
        session.import.data = data; render();
      }).catch(function (err) { session.import.error = err.message; render(); });
      return head + '<main class="page narrow"><div class="pin-box"><h1>Opening link…</h1></div></main>';
    }
    if (imp.error) {
      return head + '<main class="page narrow"><div class="pin-box"><h1>Couldn’t open this link</h1><p class="error">' + esc(imp.error) + '</p>' +
        '<a class="btn btn-primary" href="#/videos">Back to videos</a></div></main>';
    }
    if (!state.settings.parentPinHash) return head + viewPinSetup();
    var data = imp.data;
    var videos = data.sources.filter(function (x) { return x.type === 'video'; }).length;
    var channels = data.sources.filter(function (x) { return x.type === 'channel'; }).length;
    var titles = data.sources.slice(0, 8).map(function (x) { return '<li>' + esc(x.title) + (x.type === 'channel' ? ' <span class="badge">Channel</span>' : '') + '</li>'; }).join('');
    if (data.sources.length > 8) titles += '<li class="muted">…and ' + (data.sources.length - 8) + ' more</li>';
    return head + '<main class="page narrow"><div class="pin-box">' +
      '<h1>' + (isSample ? 'Add the sample library?' : 'Add shared videos?') + '</h1>' +
      '<p class="muted">' + (isSample ? 'The sample has ' : 'This link contains ') + videos + (videos === 1 ? ' video' : ' videos') + ' and ' + channels + (channels === 1 ? ' channel' : ' channels') + (data.settings && data.settings.apiKey ? ', plus an API key' : '') + '.</p>' +
      (titles ? '<ul class="share-list">' + titles + '</ul>' : '') +
      '<form data-form="import-link">' +
        (session.unlocked ? '' : '<label>Parent PIN<input type="password" inputmode="numeric" pattern="[0-9]*" name="pin" required autocomplete="current-password" autofocus></label>') +
        (session.pinError ? '<p class="error">' + esc(session.pinError) + '</p>' : '') +
        '<div class="btn-row">' +
          '<button class="btn btn-primary" type="submit" name="mode" value="merge">Add to my library</button>' +
          (state.sources.length ? '<button class="btn btn-danger" type="submit" name="mode" value="replace">Replace my library</button>' : '') +
        '</div>' +
      '</form>' +
      '<p class="center" style="margin-bottom:0"><a class="btn btn-ghost" href="#/videos">Cancel</a></p>' +
    '</div></main>';
  }

  function applyImport(data, replace) {
    var added = STORE.importJson(state, data, replace);
    persist();
    session.unlocked = true;
    session.import = null;
    setStatus('ok', replace ? 'Library replaced with ' + state.sources.length + ' items.' : 'Added ' + added + ' new ' + (added === 1 ? 'item' : 'items') + '.', 'add');
    go('#/parent');
    if (videosMissingDetails().length) setTimeout(fetchMissingDetails, 0);
  }

  function shareLink() {
    session.busy = true;
    setStatus('info', 'Making link…', 'share');
    STORE.encodeShare(STORE.sharePayload(state, session.shareApiKey)).then(function (payload) {
      var base = location.href.split('#')[0];
      session.shareLink = base + '#/import/' + payload;
      session.busy = false;
      session.status = null;
      if (navigator.share) {
        return navigator.share({ title: 'Kid Tube library', url: session.shareLink }).then(function () {
          setStatus('ok', 'Shared. Open the link on the other device.', 'share');
        }, function () { render(); });
      }
      setStatus('ok', 'Link ready. Copy it and open it on the other device.', 'share');
    }).catch(function (err) {
      session.busy = false;
      setStatus('error', 'Could not make a link: ' + err.message, 'share');
    });
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
    var missing = videosMissingDetails().length;
    return '' +
      '<header class="topbar parent-bar">' +
        '<div class="brand">' + logoHtml() + '<span class="brand-name">Parent mode</span></div>' +
        '<div class="topbar-right"><button class="btn btn-primary" data-action="lock">Done</button></div>' +
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
          ' <a href="#" data-action="use-sample">Try a sample video</a>' + (window.SAMPLE_LIBRARY ? ' or <a href="#/sample">load the sample library</a> (' + window.SAMPLE_LIBRARY.sources.length + ' videos).' : '') + '</p>' +
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
        '<h2>Send to another device</h2>' +
        '<p class="muted small">Make a link that carries your whole library. AirDrop or message it to the other device, open it there, and enter the PIN to add everything. Your PIN is not included.</p>' +
        '<label class="check"><input type="checkbox" name="shareApiKey" data-role="share-api-key"' + (session.shareApiKey ? ' checked' : '') + (state.settings.apiKey ? '' : ' disabled') + '> Include my API key <span class="muted small">(lets the other device refresh channels)</span></label>' +
        '<div class="btn-row">' +
          '<button class="btn btn-primary" data-action="share-link"' + (state.sources.length ? '' : ' disabled') + '>' + (navigator.share ? 'Share link…' : 'Make link') + '</button>' +
          (session.shareLink ? '<button class="btn" data-action="copy-share-link">Copy link</button>' : '') +
        '</div>' +
        (session.shareLink ? '<textarea class="share-link" readonly rows="3" data-role="share-link" aria-label="Share link">' + esc(session.shareLink) + '</textarea>' +
          '<p class="muted small">' + session.shareLink.length.toLocaleString() + ' characters. Long links are fine in AirDrop, Messages, email and Notes.</p>' : '') +
        statusHtml('share') +
      '</section>' +

      '<section class="panel">' +
        '<div class="panel-head"><h2>Approved library</h2><div class="btn-row">' +
          (missing ? '<button class="btn btn-small" data-action="fetch-details"' + (session.busy ? ' disabled' : '') + '>Fetch missing details (' + missing + ')</button>' : '') +
          (channelCount ? '<button class="btn btn-small" data-action="refresh-all"' + (session.busy ? ' disabled' : '') + '>Refresh all channels</button>' : '') +
        '</div></div>' +
        statusHtml('library') +
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
        '<h2>Backup file</h2>' +
        '<p class="muted small">Or export your library as a JSON file and import it elsewhere.</p>' +
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
      case 'import': html = viewImport(r.arg); mode = 'parent'; break;
      case 'sample': html = viewImport('sample'); mode = 'parent'; break;
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

  /* Videos whose title/channel never got fetched (offline add, seeded link). */
  function videosMissingDetails() {
    return state.videos.filter(function (v) { return !v.channelName || /^YouTube video [A-Za-z0-9_-]{11}$/.test(v.title); });
  }

  function fetchMissingDetails() {
    var list = videosMissingDetails();
    if (!list.length || session.busy) return;
    session.busy = true;
    setStatus('info', 'Fetching details for ' + list.length + ' videos…', 'library');
    var done = 0, seen = 0;
    var chain = Promise.resolve();
    list.forEach(function (v) {
      chain = chain.then(function () {
        return YTH.fetchVideoMetadata(v.youtubeId).then(function (meta) {
          seen++;
          if (!meta) return;
          v.title = meta.title || v.title;
          v.channelName = meta.channelName || v.channelName;
          var src = findSource(v.sourceId);
          if (src && src.type === 'video') { src.title = v.title; src.channelName = v.channelName; }
          done++;
          if (seen % 5 === 0) { persist(); setStatus('info', 'Fetching details… ' + seen + ' of ' + list.length, 'library'); }
        });
      });
    });
    chain.then(function () {
      persist();
      session.busy = false;
      setStatus(done === list.length ? 'ok' : 'warn', 'Updated ' + done + ' of ' + list.length + ' videos.' + (done < list.length ? ' Try again later for the rest.' : ''), 'library');
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
    var card = e.target.closest('a.card');
    if (card && route().name === 'watch' && player && player.loadVideoById) {
      var target = findVideo((card.getAttribute('href') || '').split('/').pop());
      if (target && !target.hidden) { e.preventDefault(); playInPlace(target); window.scrollTo(0, 0); return; }
    }
    var submit = e.target.closest('button[type="submit"][name="mode"]');
    if (submit) session.lastSubmit = submit.value; // fallback for browsers without event.submitter
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.tagName === 'A') e.preventDefault();
    switch (action) {
      case 'back': go(session.lastList || '#/videos'); break;
      case 'replay': render(); break;
      case 'share-link': if (!session.busy) shareLink(); break;
      case 'copy-share-link':
        if (navigator.clipboard) {
          navigator.clipboard.writeText(session.shareLink).then(function () { setStatus('ok', 'Link copied.', 'share'); },
            function () { setStatus('error', 'Could not copy. Select the link text and copy it by hand.', 'share'); });
        } else setStatus('error', 'Could not copy. Select the link text and copy it by hand.', 'share');
        break;
      case 'start-watch': startWatchTime(); setStatus('ok', 'Unlocked for ' + state.settings.watchMinutes + ' minutes.', 'watch'); break;
      case 'end-watch': endWatchTime(); setStatus('ok', 'Locked.', 'watch'); break;
      case 'lock':
        session.unlocked = false; session.status = null; session.filter = ''; session.shareLink = '';
        go(isLocked() ? '#/videos' : afterUnlockHash());
        break;
      case 'remove-source': removeSource(el.dataset.id); break;
      case 'refresh-source': refreshSources([findSource(el.dataset.id)].filter(Boolean)); break;
      case 'fetch-details': fetchMissingDetails(); break;
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
          if (route().name === 'unlock') { startWatchTime(); go(afterUnlockHash()); }
          else { session.unlocked = true; render(); }
        });
        break;
      case 'import-link': {
        var mode = (e.submitter && e.submitter.value) || session.lastSubmit || 'merge';
        var data = session.import && session.import.data;
        if (!data) return;
        if (mode === 'replace' && !confirm('Replace everything in this library with the shared one?')) return;
        var check = session.unlocked ? Promise.resolve(true) : STORE.hashPin(form.pin.value.trim()).then(function (h) { return h === state.settings.parentPinHash; });
        check.then(function (ok) {
          if (!ok) { session.pinError = 'Wrong PIN, try again.'; render(); return; }
          session.pinError = '';
          try { applyImport(data, mode === 'replace'); }
          catch (err) { session.import.error = err.message; render(); }
        });
        break;
      }
      case 'unlock':
        STORE.hashPin(form.pin.value.trim()).then(function (hash) {
          if (hash !== state.settings.parentPinHash) { session.pinError = 'Wrong PIN, try again.'; render(); return; }
          session.pinError = '';
          startWatchTime();
          go(afterUnlockHash());
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
    if (e.target.dataset.role === 'share-api-key') { session.shareApiKey = e.target.checked; session.shareLink = ''; render(); }
    if (e.target.dataset.role === 'import' && e.target.files[0]) importFile(e.target.files[0]);
  });

  window.addEventListener('hashchange', function () {
    session.pinError = '';
    var name = route().name;
    if (name === 'videos' || name === 'channels' || name === 'channel') session.lastList = location.hash;
    if (name !== 'parent' && name !== 'import' && name !== 'sample') session.status = null;
    if (route().name !== 'videos' && route().name !== 'channel') session.filter = '';
    render();
    window.scrollTo(0, 0);
  });

  // Always start in kid mode: a reload never lands in an unlocked parent view.
  render();
  setInterval(tick, 1000);
})();

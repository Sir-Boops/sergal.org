function videoPlayerMarkup(video) {
  return `<div class="video-player" data-video-player>
    ${video}
    <div class="video-controls" role="group" aria-label="Video controls">
      <input class="video-seek" data-video-seek type="range" min="0" max="0" value="0" step="0.01" aria-label="Seek video" disabled>
      <button type="button" data-video-action="play" aria-label="Play video">${iconMarkup('player-play')}</button>
      <span class="video-time" data-video-time aria-hidden="true">0:00</span>
      <button type="button" data-video-action="mute" aria-label="Mute video">${iconMarkup('volume')}</button>
      <input class="video-volume" data-video-volume type="range" min="0" max="1" value="1" step="0.05" aria-label="Video volume">
      <button type="button" data-video-action="fullscreen" aria-label="Enter fullscreen" ${document.fullscreenEnabled ? '' : 'disabled'}>${iconMarkup('maximize')}</button>
    </div>
  </div>`;
}

(() => {
  const main = document.querySelector('main');
  const QUICK_HIDE_MS = 350;
  const TAP_HIDE_MS = 2000;
  const hideTimers = new WeakMap();

  function showControls(player, delay) {
    clearTimeout(hideTimers.get(player));
    player.removeAttribute('data-controls-hidden');
    if (delay === undefined) return;
    hideTimers.set(player, setTimeout(() => {
      const video = player.querySelector('video');
      if (!video.paused && !video.ended) player.setAttribute('data-controls-hidden', '');
    }, delay));
  }

  function setButton(player, action, label, icon) {
    const button = player.querySelector('[data-video-action="' + action + '"]');
    button.setAttribute('aria-label', label);
    button.querySelector('use').setAttribute('href', ICON_SPRITE + '#' + icon);
    return button;
  }

  function syncPlayback(player, video) {
    const playing = !video.paused && !video.ended;
    setButton(player, 'play', playing ? 'Pause video' : 'Play video', playing ? 'player-pause' : 'player-play');
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const minutes = Math.floor(total / 60);
    return minutes + ':' + String(total % 60).padStart(2, '0');
  }

  function syncProgress(player, video) {
    const seek = player.querySelector('[data-video-seek]');
    const canSeek = Number.isFinite(video.duration) && video.duration > 0;
    seek.disabled = !canSeek;
    seek.max = canSeek ? video.duration : 0;
    seek.value = canSeek ? video.currentTime : 0;
    const elapsed = formatTime(video.currentTime);
    const duration = canSeek ? formatTime(video.duration) : '';
    seek.setAttribute('aria-valuetext', duration ? elapsed + ' of ' + duration : elapsed);
    player.querySelector('[data-video-time]').textContent = duration ? elapsed + ' / ' + duration : elapsed;
  }

  function syncVolume(player, video) {
    const silent = video.muted || video.volume === 0;
    setButton(player, 'mute', silent ? 'Unmute video' : 'Mute video', silent ? 'volume-off' : 'volume');
    player.querySelector('[data-video-volume]').value = silent ? 0 : video.volume;
  }

  function syncFullscreen(player, video) {
    const fullscreen = document.fullscreenElement === player;
    const button = setButton(player, 'fullscreen', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen',
      fullscreen ? 'minimize' : 'maximize');
    button.disabled = !document.fullscreenEnabled && !video.webkitSupportsFullscreen;
  }

  function togglePlayback(player, video) {
    if (video.paused || video.ended) {
      video.play().catch(() => {
        syncPlayback(player, video);
        showControls(player);
      });
    } else {
      video.pause();
    }
  }

  async function toggleFullscreen(player, video) {
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen();
      else if (document.fullscreenEnabled) await player.requestFullscreen();
      else if (video.webkitSupportsFullscreen) video.webkitEnterFullscreen();
    } catch {
      syncFullscreen(player, video);
    }
  }

  function onVideo(event, callback) {
    main.addEventListener(event, ({target: video}) => {
      const player = video.tagName === 'VIDEO' && video.closest('[data-video-player]');
      if (player) callback(player, video);
    }, true);
  }

  onVideo('play', (player, video) => {
    syncPlayback(player, video);
    syncFullscreen(player, video);
    showControls(player, QUICK_HIDE_MS);
  });

  for (const event of ['pause', 'ended', 'error', 'emptied']) {
    onVideo(event, (player, video) => {
      syncPlayback(player, video);
      showControls(player);
    });
  }
  for (const event of ['timeupdate', 'durationchange', 'emptied']) onVideo(event, syncProgress);
  onVideo('volumechange', syncVolume);
  onVideo('loadedmetadata', syncFullscreen);
  onVideo('webkitendfullscreen', player => showControls(player, TAP_HIDE_MS));

  main.addEventListener('fullscreenchange', event => {
    const player = event.target.closest?.('[data-video-player]');
    if (!player) return;
    syncFullscreen(player, player.querySelector('video'));
    showControls(player, TAP_HIDE_MS);
  });

  main.addEventListener('click', event => {
    const player = event.target.closest('[data-video-player]');
    if (!player) return;
    const video = player.querySelector('video');
    const action = event.target.closest('[data-video-action]')?.dataset.videoAction;
    if (action === 'play' || (event.target === video && (video.paused || video.ended))) {
      togglePlayback(player, video);
      return;
    }
    if (action === 'mute') {
      const silent = video.muted || video.volume === 0;
      if (video.volume === 0) video.volume = 1;
      video.muted = !silent;
    } else if (action === 'fullscreen') {
      void toggleFullscreen(player, video);
    }
    showControls(player, TAP_HIDE_MS);
  });

  main.addEventListener('input', event => {
    const control = event.target;
    if (!control.matches('[data-video-seek], [data-video-volume]')) return;
    const player = control.closest('[data-video-player]');
    const video = player.querySelector('video');
    const value = control.valueAsNumber;
    if (!Number.isFinite(value)) return;
    if (control.hasAttribute('data-video-seek')) {
      video.currentTime = value;
      syncProgress(player, video);
    } else {
      video.volume = value;
      video.muted = value === 0;
    }
    showControls(player, TAP_HIDE_MS);
  });
})();

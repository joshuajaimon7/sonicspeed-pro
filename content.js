// SonicSpeed Pro - Content Script
// 16x Playback Controller, Web Audio 600% Booster, Vocal Clarity EQ, Silence Skipper, Frame Capture & A-B Looper

(function () {
  // Prevent double execution in the same frame
  if (window.__sonicspeed_injected) return;
  window.__sonicspeed_injected = true;

  let currentSpeed = 1.0;
  let currentVolume = 100; // 100% to 600%
  let isVocalBoostActive = false;
  let isSilenceSkipActive = false;

  // A-B Looping state
  let loopPointA = null;
  let loopPointB = null;
  let isLooping = false;

  let audioCtx = null;
  let gainNode = null;
  let vocalFilter = null;
  let analyserNode = null;
  let silenceInterval = null;
  let hudTimer = null;
  let lastTrackTime = Date.now();
  let dspAttachedTo = null;

  // Deep search for video/audio elements (including YouTube, shadow roots, etc.)
  function getMediaElements() {
    const list = [];

    // 1. Direct standard query
    const direct = document.querySelectorAll('video, audio');
    direct.forEach(el => list.push(el));

    // 2. YouTube specific main player
    const ytVideo = document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video');
    if (ytVideo && !list.includes(ytVideo)) {
      list.unshift(ytVideo);
    }

    // 3. Inspect shadow roots if any
    try {
      const allNodes = document.querySelectorAll('*');
      for (let i = 0; i < allNodes.length; i++) {
        const shadow = allNodes[i].shadowRoot;
        if (shadow) {
          const shadowMedia = shadow.querySelectorAll('video, audio');
          shadowMedia.forEach(m => {
            if (!list.includes(m)) list.push(m);
          });
        }
      }
    } catch (e) {}

    return list;
  }

  function getActiveVideo() {
    const media = getMediaElements();
    if (media.length === 0) return null;

    // Prioritize currently playing element
    const playing = media.find(m => !m.paused && m.currentTime > 0);
    if (playing) return playing;

    // Next prioritize video elements over audio
    const firstVideo = media.find(m => m.tagName.toLowerCase() === 'video');
    return firstVideo || media[0];
  }

  // Initialize Web Audio DSP only on demand (for volume boost >100% or EQ)
  function initAudioDSP(mediaEl) {
    if (dspAttachedTo === mediaEl || !mediaEl) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const source = audioCtx.createMediaElementSource(mediaEl);

      // Gain Node (Volume Booster up to 600%)
      gainNode = audioCtx.createGain();
      gainNode.gain.value = currentVolume / 100;

      // Vocal Clarity Peaking Filter (3kHz voice resonance boost)
      vocalFilter = audioCtx.createBiquadFilter();
      vocalFilter.type = 'peaking';
      vocalFilter.frequency.value = 3000;
      vocalFilter.Q.value = 1.2;
      vocalFilter.gain.value = isVocalBoostActive ? 8 : 0;

      // Analyser Node for silence skipping
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 256;

      // Connect DSP graph: Source -> VocalFilter -> Gain -> Analyser -> Destination
      source.connect(vocalFilter);
      vocalFilter.connect(gainNode);
      gainNode.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);

      dspAttachedTo = mediaEl;
    } catch (e) {
      // Cross-origin audio restrictions or already connected
    }
  }

  function applySpeed(speed) {
    currentSpeed = Math.max(0.1, Math.min(16.0, parseFloat(speed.toFixed(1))));
    const mediaList = getMediaElements();
    mediaList.forEach(media => {
      try {
        media.playbackRate = currentSpeed;
        media.preservesPitch = true;
        if ('webkitPreservesPitch' in media) media.webkitPreservesPitch = true;
        if ('mozPreservesPitch' in media) media.mozPreservesPitch = true;
      } catch (err) {}
    });
    showHUD();
  }

  function applyVolume(vol) {
    currentVolume = Math.max(10, Math.min(600, parseInt(vol, 10)));
    const active = getActiveVideo();

    if (currentVolume > 100 && active) {
      initAudioDSP(active);
    }

    if (gainNode && audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      gainNode.gain.value = currentVolume / 100;
    } else if (active) {
      // Standard HTML5 volume fallback
      active.volume = Math.min(1.0, currentVolume / 100);
    }
    showHUD();
  }

  function toggleVocalBoost(forceState) {
    isVocalBoostActive = typeof forceState === 'boolean' ? forceState : !isVocalBoostActive;
    const active = getActiveVideo();
    if (active && !dspAttachedTo) initAudioDSP(active);

    if (vocalFilter) {
      vocalFilter.gain.value = isVocalBoostActive ? 8 : 0;
    }
    showHUD();
  }

  function toggleSilenceSkip(forceState) {
    isSilenceSkipActive = typeof forceState === 'boolean' ? forceState : !isSilenceSkipActive;

    if (isSilenceSkipActive) {
      startSilenceDetection();
    } else {
      stopSilenceDetection();
    }
    showHUD();
  }

  function startSilenceDetection() {
    stopSilenceDetection();
    const active = getActiveVideo();
    if (!active) return;
    if (!dspAttachedTo) initAudioDSP(active);

    const buffer = new Uint8Array(analyserNode ? analyserNode.frequencyBinCount : 128);

    silenceInterval = setInterval(() => {
      if (!analyserNode || !active || active.paused) return;

      analyserNode.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      const avg = sum / buffer.length;

      // If volume drops below threshold for dead air, accelerate
      if (avg < 5) {
        if (active.playbackRate < currentSpeed * 2.2) {
          active.playbackRate = Math.min(16.0, currentSpeed * 2.5);
        }
      } else {
        if (active.playbackRate !== currentSpeed) {
          active.playbackRate = currentSpeed;
        }
      }
    }, 150);
  }

  function stopSilenceDetection() {
    if (silenceInterval) {
      clearInterval(silenceInterval);
      silenceInterval = null;
    }
    getMediaElements().forEach(m => {
      try { m.playbackRate = currentSpeed; } catch (e) {}
    });
  }

  // A-B Looping
  function setupLoopCheck(video) {
    if (!video) return;
    video.removeEventListener('timeupdate', handleLoopTimeUpdate);
    if (isLooping && loopPointA !== null && loopPointB !== null) {
      video.addEventListener('timeupdate', handleLoopTimeUpdate);
    }
  }

  function handleLoopTimeUpdate(e) {
    const video = e.target;
    if (isLooping && loopPointB !== null && loopPointA !== null) {
      if (video.currentTime >= loopPointB) {
        video.currentTime = loopPointA;
      }
    }
  }

  function stepFrame(frames) {
    const video = getActiveVideo();
    if (!video) return;
    video.pause();
    const frameDelta = 1 / 30;
    video.currentTime = Math.max(0, video.currentTime + (frames * frameDelta));
    showHUD(`Frame: ${video.currentTime.toFixed(2)}s`);
  }

  function captureCurrentFrame() {
    const video = getActiveVideo();
    if (!video) return null;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || video.clientWidth || 1280;
      canvas.height = video.videoHeight || video.clientHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/png');
      const timestamp = Math.floor(video.currentTime);
      const filename = `frame-${timestamp}s.png`;

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      showHUD('Frame Captured (PNG)');
      return { success: true, timestamp, filename };
    } catch (err) {
      showHUD('Frame snapshot ready');
      return { success: false, error: err.message };
    }
  }

  // Floating Video HUD
  function showHUD(customText) {
    const video = getActiveVideo();
    let hud = document.getElementById('sonicspeed-hud');

    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'sonicspeed-hud';
      document.body.appendChild(hud);
    }

    if (customText) {
      hud.innerHTML = `<span class="sonicspeed-hud-metric">${customText}</span>`;
    } else {
      let tags = [];
      if (isVocalBoostActive) tags.push('<span class="sonicspeed-hud-tag">Voice EQ</span>');
      if (isSilenceSkipActive) tags.push('<span class="sonicspeed-hud-tag">Skip Silence</span>');
      if (isLooping) tags.push('<span class="sonicspeed-hud-tag">Loop A-B</span>');

      hud.innerHTML = `
        <span class="sonicspeed-hud-metric">${currentSpeed.toFixed(1)}x</span>
        <span class="sonicspeed-hud-dim">•</span>
        <span class="sonicspeed-hud-metric">${currentVolume}% Vol</span>
        ${tags.join(' ')}
      `;
    }

    if (video) {
      const rect = video.getBoundingClientRect();
      hud.style.top = `${Math.max(14, window.scrollY + rect.top + 16)}px`;
      hud.style.left = `${Math.max(14, window.scrollX + rect.left + 16)}px`;
    }

    hud.classList.add('visible');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      hud.classList.remove('visible');
    }, 1600);
  }

  // YouTube SPA Navigation Listener (re-apply speed when switching videos)
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(() => {
      applySpeed(currentSpeed);
    }, 300);
  });

  // Time Saved Tracker
  setInterval(() => {
    const active = getActiveVideo();
    const now = Date.now();
    const deltaSeconds = (now - lastTrackTime) / 1000;
    lastTrackTime = now;

    if (active && !active.paused && active.playbackRate > 1.0 && deltaSeconds > 0 && deltaSeconds < 5) {
      const saved = deltaSeconds * (active.playbackRate - 1.0);
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['totalSecondsSaved'], (res) => {
            const current = res.totalSecondsSaved || 0;
            chrome.storage.local.set({ totalSecondsSaved: current + saved });
          });
        }
      } catch (e) {}
    }
  }, 2000);

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

    if (e.key === 'd' || e.key === 'D') {
      applySpeed(currentSpeed + 0.1);
    } else if (e.key === 's' || e.key === 'S') {
      applySpeed(currentSpeed - 0.1);
    } else if (e.key === 'r' || e.key === 'R') {
      applySpeed(1.0);
    } else if (e.key === 'v' || e.key === 'V') {
      toggleVocalBoost();
    } else if (e.key === 'b' || e.key === 'B') {
      toggleSilenceSkip();
    } else if (e.key === 'c' || e.key === 'C') {
      captureCurrentFrame();
    } else if (e.key === '[') {
      const active = getActiveVideo();
      if (active) {
        loopPointA = active.currentTime;
        showHUD(`Point A: ${loopPointA.toFixed(1)}s`);
      }
    } else if (e.key === ']') {
      const active = getActiveVideo();
      if (active) {
        loopPointB = active.currentTime;
        isLooping = true;
        setupLoopCheck(active);
        showHUD(`Loop: ${loopPointA ? loopPointA.toFixed(1) : 0}s - ${loopPointB.toFixed(1)}s`);
      }
    }
  });

  // Message listener for Popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const media = getMediaElements();
    const hasMedia = media.length > 0;

    // CRITICAL: If this is an iframe that has NO media, DO NOT respond!
    // Allowing empty subframes to respond hijacks the message from the main video frame.
    if (window !== window.top && !hasMedia) {
      return false;
    }

    if (request.type === 'GET_STATUS') {
      const active = getActiveVideo();
      const actualSpeed = active ? active.playbackRate : currentSpeed;

      sendResponse({
        success: true,
        speed: actualSpeed,
        volume: currentVolume,
        vocalBoost: isVocalBoostActive,
        silenceSkip: isSilenceSkipActive,
        loopPointA,
        loopPointB,
        isLooping,
        hasMedia: hasMedia,
        currentTime: active ? active.currentTime : 0,
        duration: active ? active.duration : 0
      });
      return true;
    }

    if (request.type === 'SET_SPEED') {
      applySpeed(request.speed);
      sendResponse({ success: true, speed: currentSpeed });
      return true;
    }

    if (request.type === 'SET_VOLUME') {
      applyVolume(request.volume);
      sendResponse({ success: true, volume: currentVolume });
      return true;
    }

    if (request.type === 'TOGGLE_VOCAL_BOOST') {
      toggleVocalBoost(request.state);
      sendResponse({ success: true, state: isVocalBoostActive });
      return true;
    }

    if (request.type === 'TOGGLE_SILENCE_SKIP') {
      toggleSilenceSkip(request.state);
      sendResponse({ success: true, state: isSilenceSkipActive });
      return true;
    }

    if (request.type === 'CAPTURE_FRAME') {
      const res = captureCurrentFrame();
      sendResponse(res || { success: false });
      return true;
    }

    if (request.type === 'STEP_FRAME') {
      stepFrame(request.frames || 1);
      sendResponse({ success: true });
      return true;
    }

    if (request.type === 'SET_LOOP_A') {
      const active = getActiveVideo();
      if (active) loopPointA = active.currentTime;
      showHUD(`Point A: ${loopPointA.toFixed(1)}s`);
      sendResponse({ success: true, loopPointA });
      return true;
    }

    if (request.type === 'SET_LOOP_B') {
      const active = getActiveVideo();
      if (active) {
        loopPointB = active.currentTime;
        isLooping = true;
        setupLoopCheck(active);
      }
      showHUD(`Loop: ${loopPointA ? loopPointA.toFixed(1) : 0}s - ${loopPointB.toFixed(1)}s`);
      sendResponse({ success: true, loopPointB, isLooping });
      return true;
    }

    if (request.type === 'CLEAR_LOOP') {
      loopPointA = null;
      loopPointB = null;
      isLooping = false;
      const active = getActiveVideo();
      if (active) setupLoopCheck(active);
      showHUD('Loop Cleared');
      sendResponse({ success: true });
      return true;
    }
  });
})();

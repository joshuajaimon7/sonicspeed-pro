// SonicSpeed Pro - Content Script
// 16x Playback Controller, Web Audio 600% Booster, Vocal Clarity EQ, Silence Skipper, Frame Capture & A-B Looper

(function () {
  let currentSpeed = 1.0;
  let currentVolume = 100; // 100% to 600%
  let isVocalBoostActive = false;
  let isSilenceSkipActive = false;

  // A-B Looping state
  let loopPointA = null;
  let loopPointB = null;
  let isLooping = false;

  // Video Filter state
  let videoBrightness = 100; // 100%
  let videoContrast = 100; // 100%

  let audioCtx = null;
  let gainNode = null;
  let vocalFilter = null;
  let analyserNode = null;
  let silenceInterval = null;
  let hudTimer = null;
  let lastTrackTime = Date.now();

  function getMediaElements() {
    return Array.from(document.querySelectorAll('video, audio'));
  }

  function getActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    const playing = videos.find(v => !v.paused && v.currentTime > 0);
    return playing || videos[0];
  }

  // Ensure AudioContext is initialized on first user interaction
  function initAudioDSP(mediaEl) {
    if (audioCtx || !mediaEl) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
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
    } catch (e) {
      // Cross-origin audio restrictions fallback
    }
  }

  function applySpeed(speed) {
    currentSpeed = Math.max(0.1, Math.min(16.0, parseFloat(speed.toFixed(1))));
    getMediaElements().forEach(media => {
      media.playbackRate = currentSpeed;
      media.preservesPitch = true;
      if ('webkitPreservesPitch' in media) media.webkitPreservesPitch = true;
      if ('mozPreservesPitch' in media) media.mozPreservesPitch = true;
    });
    showHUD();
  }

  function applyVolume(vol) {
    currentVolume = Math.max(10, Math.min(600, parseInt(vol, 10)));
    const active = getActiveVideo();
    if (active && !audioCtx) initAudioDSP(active);

    if (gainNode && audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      gainNode.gain.value = currentVolume / 100;
    }
    showHUD();
  }

  function toggleVocalBoost(forceState) {
    isVocalBoostActive = typeof forceState === 'boolean' ? forceState : !isVocalBoostActive;
    const active = getActiveVideo();
    if (active && !audioCtx) initAudioDSP(active);

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
    if (!audioCtx) initAudioDSP(active);

    const buffer = new Uint8Array(analyserNode ? analyserNode.frequencyBinCount : 128);

    silenceInterval = setInterval(() => {
      if (!analyserNode || !active || active.paused) return;

      analyserNode.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      const avg = sum / buffer.length;

      // If volume drops below threshold for dead air, fast-forward
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
    getMediaElements().forEach(m => m.playbackRate = currentSpeed);
  }

  // A-B Looping Handler
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

  // Step Frame forward or backward (+1 frame is ~0.033s)
  function stepFrame(frames) {
    const video = getActiveVideo();
    if (!video) return;
    video.pause();
    const frameDelta = 1 / 30; // standard 30fps baseline
    video.currentTime = Math.max(0, video.currentTime + (frames * frameDelta));
    showHUD(`Frame: ${video.currentTime.toFixed(2)}s`);
  }

  // High-Res Video Frame Capture
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

      // Trigger instant download
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      showHUD('Frame Captured (PNG)');
      return { success: true, timestamp, filename };
    } catch (err) {
      console.warn('Frame capture error (CORS):', err);
      showHUD('Capture failed (CORS protected)');
      return { success: false, error: err.message };
    }
  }

  // Video Enhancer Filters (Brightness / Contrast)
  function applyVideoFilter(brightness, contrast) {
    videoBrightness = brightness !== undefined ? brightness : videoBrightness;
    videoContrast = contrast !== undefined ? contrast : videoContrast;
    getMediaElements().forEach(media => {
      media.style.filter = `brightness(${videoBrightness}%) contrast(${videoContrast}%)`;
    });
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

  // Time Saved Tracker: runs every 2 seconds when video is playing at > 1.0x
  setInterval(() => {
    const active = getActiveVideo();
    const now = Date.now();
    const deltaSeconds = (now - lastTrackTime) / 1000;
    lastTrackTime = now;

    if (active && !active.paused && active.playbackRate > 1.0 && deltaSeconds > 0 && deltaSeconds < 5) {
      // Real time played = deltaSeconds
      // Content time consumed = deltaSeconds * playbackRate
      // Time saved = content time - real time = deltaSeconds * (playbackRate - 1)
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
  // D = Faster, S = Slower, R = Reset, V = Voice Boost, B = Silence Skip, C = Capture Frame, [ = Loop A, ] = Loop B
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
    if (request.type === 'GET_STATUS') {
      const active = getActiveVideo();
      sendResponse({
        success: true,
        speed: currentSpeed,
        volume: currentVolume,
        vocalBoost: isVocalBoostActive,
        silenceSkip: isSilenceSkipActive,
        loopPointA,
        loopPointB,
        isLooping,
        videoBrightness,
        videoContrast,
        hasMedia: getMediaElements().length > 0,
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

    if (request.type === 'SET_VIDEO_FILTER') {
      applyVideoFilter(request.brightness, request.contrast);
      sendResponse({ success: true, brightness: videoBrightness, contrast: videoContrast });
      return true;
    }
  });
})();

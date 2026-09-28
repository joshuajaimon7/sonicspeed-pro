// SonicSpeed Pro - Popup Logic
// Speed control, Volume booster, DSP toggles, Frame Capture, A-B Looper, and Pro Licensing

const FREE_MAX_SPEED = 2.5;
const FREE_MAX_VOLUME = 200;
const STORE_CHECKOUT_URL = "https://tinystacklabs.lemonsqueezy.com/buy/sonicspeed-pro";

let isPro = false;
let activeTabId = null;

// DOM Elements
const speedSlider = document.getElementById('speedSlider');
const speedDisplay = document.getElementById('speedDisplay');
const volumeSlider = document.getElementById('volumeSlider');
const volumeDisplay = document.getElementById('volumeDisplay');
const silenceCheckbox = document.getElementById('silenceCheckbox');
const vocalCheckbox = document.getElementById('vocalCheckbox');
const statusBar = document.getElementById('statusBar');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const controlsView = document.getElementById('controlsView');
const emptyState = document.getElementById('emptyState');
const openDemoBtn = document.getElementById('openDemoBtn');
const upgradeBtn = document.getElementById('upgradeBtn');
const proUpgradeLink = document.getElementById('proUpgradeLink');
const upgradeModal = document.getElementById('upgradeModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const startCheckoutBtn = document.getElementById('startCheckoutBtn');
const licenseKeyInput = document.getElementById('licenseKeyInput');
const activateKeyBtn = document.getElementById('activateKeyBtn');
const licenseStatus = document.getElementById('licenseStatus');
const proHeaderBadge = document.getElementById('proHeaderBadge');
const footerBanner = document.getElementById('footerBanner');
const timeSavedDisplay = document.getElementById('timeSavedDisplay');

// Tool buttons
const captureFrameBtn = document.getElementById('captureFrameBtn');
const stepPrevBtn = document.getElementById('stepPrevBtn');
const stepNextBtn = document.getElementById('stepNextBtn');
const loopSetABtn = document.getElementById('loopSetABtn');
const loopSetBBtn = document.getElementById('loopSetBBtn');
const loopClearBtn = document.getElementById('loopClearBtn');
const loopStatusDisplay = document.getElementById('loopStatusDisplay');

// Init
document.addEventListener('DOMContentLoaded', async () => {
  await checkProStatus();
  await loadTimeSaved();
  await initTabCommunication();
  setupEventListeners();
});

async function checkProStatus() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['isProLicense', 'licenseKey'], (res) => {
      isPro = !!res.isProLicense;
      renderProUI(isPro);
      resolve();
    });
  });
}

function renderProUI(pro) {
  if (pro) {
    proHeaderBadge.classList.add('unlocked');
    upgradeBtn.textContent = 'Pro Active';
    upgradeBtn.classList.add('is-pro');
    footerBanner.innerHTML = '<span>SonicSpeed Pro Unlimited License Active</span>';
    speedSlider.max = "16.0";
    volumeSlider.max = "600";
  } else {
    proHeaderBadge.classList.remove('unlocked');
    upgradeBtn.textContent = 'Upgrade';
    upgradeBtn.classList.remove('is-pro');
    footerBanner.innerHTML = `
      <span>Free tier: Max ${FREE_MAX_SPEED}x speed & ${FREE_MAX_VOLUME}% volume</span>
      <a href="#" id="proUpgradeLink" class="pro-link">Upgrade to Lifetime ($4.99)</a>
    `;
    const newLink = document.getElementById('proUpgradeLink');
    if (newLink) newLink.addEventListener('click', (e) => { e.preventDefault(); openUpgradeModal(); });
  }
}

function loadTimeSaved() {
  chrome.storage.local.get(['totalSecondsSaved'], (res) => {
    const sec = res.totalSecondsSaved || 0;
    if (sec < 60) {
      timeSavedDisplay.textContent = `${Math.round(sec)} sec`;
    } else if (sec < 3600) {
      timeSavedDisplay.textContent = `${Math.round(sec / 60)} min`;
    } else {
      const hours = Math.floor(sec / 3600);
      const mins = Math.round((sec % 3600) / 60);
      timeSavedDisplay.textContent = `${hours}h ${mins}m`;
    }
  });
}

async function initTabCommunication() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      showEmptyState();
      return;
    }
    activeTabId = tabs[0].id;

    // Send probe
    chrome.tabs.sendMessage(activeTabId, { type: 'GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        // Try injecting content script if not already present
        chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          files: ['content.js']
        }, () => {
          if (chrome.runtime.lastError) {
            showEmptyState();
          } else {
            // Re-query after injection
            setTimeout(() => {
              chrome.tabs.sendMessage(activeTabId, { type: 'GET_STATUS' }, (retryRes) => {
                if (retryRes && retryRes.hasMedia) {
                  showControls(retryRes);
                } else {
                  showEmptyState();
                }
              });
            }, 100);
          }
        });
      } else if (response.hasMedia) {
        showControls(response);
      } else {
        showEmptyState();
      }
    });
  } catch (e) {
    showEmptyState();
  }
}

function showEmptyState() {
  emptyState.style.display = 'flex';
  controlsView.style.display = 'none';
  statusIndicator.classList.remove('active');
  statusText.textContent = 'No active media detected';
}

function showControls(status) {
  emptyState.style.display = 'none';
  controlsView.style.display = 'flex';
  statusIndicator.classList.add('active');
  statusText.textContent = 'Connected to active video playback';

  // Sync Speed
  const spd = status.speed || 1.0;
  speedSlider.value = spd;
  speedDisplay.textContent = `${spd.toFixed(1)}x`;
  highlightSpeedPill(spd);

  // Sync Volume
  const vol = status.volume || 100;
  volumeSlider.value = vol;
  volumeDisplay.textContent = `${vol}%`;
  highlightVolumePill(vol);

  // Sync Toggles
  silenceCheckbox.checked = !!status.silenceSkip;
  vocalCheckbox.checked = !!status.vocalBoost;

  // Sync Loop
  updateLoopDisplay(status.loopPointA, status.loopPointB, status.isLooping);
}

function updateLoopDisplay(a, b, isLooping) {
  if (a !== null && b !== null && isLooping) {
    loopStatusDisplay.textContent = `${a.toFixed(1)}s - ${b.toFixed(1)}s (Active)`;
    loopStatusDisplay.style.color = '#30d158';
  } else if (a !== null) {
    loopStatusDisplay.textContent = `A: ${a.toFixed(1)}s`;
    loopStatusDisplay.style.color = '#86868b';
  } else {
    loopStatusDisplay.textContent = 'Off';
    loopStatusDisplay.style.color = '#86868b';
  }
}

function highlightSpeedPill(val) {
  document.querySelectorAll('.preset-row button[data-speed]').forEach(btn => {
    const s = parseFloat(btn.getAttribute('data-speed'));
    if (Math.abs(s - val) < 0.05) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function highlightVolumePill(val) {
  document.querySelectorAll('.preset-row button[data-vol]').forEach(btn => {
    const v = parseInt(btn.getAttribute('data-vol'), 10);
    if (v === val) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function sendToContent(msg, callback) {
  if (!activeTabId) return;
  chrome.tabs.sendMessage(activeTabId, msg, (res) => {
    if (callback) callback(res);
  });
}

function setupEventListeners() {
  // Speed Slider
  speedSlider.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    if (!isPro && val > FREE_MAX_SPEED) {
      e.target.value = FREE_MAX_SPEED;
      val = FREE_MAX_SPEED;
      openUpgradeModal();
      return;
    }
    speedDisplay.textContent = `${val.toFixed(1)}x`;
    highlightSpeedPill(val);
    sendToContent({ type: 'SET_SPEED', speed: val });
  });

  // Speed Presets
  document.querySelectorAll('.preset-row button[data-speed]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseFloat(btn.getAttribute('data-speed'));
      if (!isPro && val > FREE_MAX_SPEED) {
        openUpgradeModal();
        return;
      }
      speedSlider.value = val;
      speedDisplay.textContent = `${val.toFixed(1)}x`;
      highlightSpeedPill(val);
      sendToContent({ type: 'SET_SPEED', speed: val });
    });
  });

  // Volume Slider
  volumeSlider.addEventListener('input', (e) => {
    let val = parseInt(e.target.value, 10);
    if (!isPro && val > FREE_MAX_VOLUME) {
      e.target.value = FREE_MAX_VOLUME;
      val = FREE_MAX_VOLUME;
      openUpgradeModal();
      return;
    }
    volumeDisplay.textContent = `${val}%`;
    highlightVolumePill(val);
    sendToContent({ type: 'SET_VOLUME', volume: val });
  });

  // Volume Presets
  document.querySelectorAll('.preset-row button[data-vol]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.getAttribute('data-vol'), 10);
      if (!isPro && val > FREE_MAX_VOLUME) {
        openUpgradeModal();
        return;
      }
      volumeSlider.value = val;
      volumeDisplay.textContent = `${val}%`;
      highlightVolumePill(val);
      sendToContent({ type: 'SET_VOLUME', volume: val });
    });
  });

  // Silence Skip Toggle (Pro Feature)
  silenceCheckbox.addEventListener('change', (e) => {
    if (!isPro && e.target.checked) {
      e.target.checked = false;
      openUpgradeModal();
      return;
    }
    sendToContent({ type: 'TOGGLE_SILENCE_SKIP', state: e.target.checked });
  });

  // Vocal Clarity Toggle (Pro Feature)
  vocalCheckbox.addEventListener('change', (e) => {
    if (!isPro && e.target.checked) {
      e.target.checked = false;
      openUpgradeModal();
      return;
    }
    sendToContent({ type: 'TOGGLE_VOCAL_BOOST', state: e.target.checked });
  });

  // Study Tools: Frame Capture
  captureFrameBtn.addEventListener('click', () => {
    sendToContent({ type: 'CAPTURE_FRAME' }, (res) => {
      captureFrameBtn.style.background = '#ffffff';
      captureFrameBtn.style.color = '#000000';
      setTimeout(() => {
        captureFrameBtn.style.background = '';
        captureFrameBtn.style.color = '';
      }, 300);
    });
  });

  // Frame Stepping
  stepPrevBtn.addEventListener('click', () => {
    sendToContent({ type: 'STEP_FRAME', frames: -1 });
  });

  stepNextBtn.addEventListener('click', () => {
    sendToContent({ type: 'STEP_FRAME', frames: 1 });
  });

  // A-B Looper
  loopSetABtn.addEventListener('click', () => {
    sendToContent({ type: 'SET_LOOP_A' }, (res) => {
      loopSetABtn.classList.add('active');
      if (res && res.loopPointA !== undefined) {
        loopStatusDisplay.textContent = `A: ${res.loopPointA.toFixed(1)}s`;
      }
    });
  });

  loopSetBBtn.addEventListener('click', () => {
    sendToContent({ type: 'SET_LOOP_B' }, (res) => {
      loopSetBBtn.classList.add('active');
      if (res && res.loopPointB !== undefined) {
        loopStatusDisplay.textContent = `Looping Active`;
        loopStatusDisplay.style.color = '#30d158';
      }
    });
  });

  loopClearBtn.addEventListener('click', () => {
    sendToContent({ type: 'CLEAR_LOOP' }, () => {
      loopSetABtn.classList.remove('active');
      loopSetBBtn.classList.remove('active');
      loopStatusDisplay.textContent = 'Off';
      loopStatusDisplay.style.color = '#86868b';
    });
  });

  // Demo Page Opener
  openDemoBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('demo-test.html') });
  });

  // Upgrade Modal Handlers
  upgradeBtn.addEventListener('click', () => {
    if (!isPro) openUpgradeModal();
  });

  modalCloseBtn.addEventListener('click', closeUpgradeModal);
  upgradeModal.addEventListener('click', (e) => {
    if (e.target === upgradeModal) closeUpgradeModal();
  });

  startCheckoutBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: STORE_CHECKOUT_URL });
  });

  activateKeyBtn.addEventListener('click', handleLicenseActivation);
  licenseKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLicenseActivation();
  });
}

function openUpgradeModal() {
  upgradeModal.style.display = 'flex';
}

function closeUpgradeModal() {
  upgradeModal.style.display = 'none';
  licenseStatus.textContent = '';
  licenseStatus.className = 'license-status';
}

function handleLicenseActivation() {
  const key = (licenseKeyInput.value || '').trim();
  if (!key) {
    showLicenseMsg('Please enter a valid license key', false);
    return;
  }

  // Verification pattern: SONIC-XXXX or PRO-XXXX or any 8+ char key
  if (key.length >= 8) {
    chrome.storage.local.set({ isProLicense: true, licenseKey: key }, () => {
      isPro = true;
      renderProUI(true);
      showLicenseMsg('License activated! All Pro features unlocked.', true);
      setTimeout(() => {
        closeUpgradeModal();
      }, 1400);
    });
  } else {
    showLicenseMsg('Invalid key. Format: SONIC-XXXX-XXXX', false);
  }
}

function showLicenseMsg(msg, success) {
  licenseStatus.textContent = msg;
  licenseStatus.className = `license-status ${success ? 'success' : 'error'}`;
}

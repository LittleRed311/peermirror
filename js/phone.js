/**
 * CastLink — Phone/Tablet Side
 * Connects to the TV peer via room code, captures screen with
 * getDisplayMedia (or camera fallback on iOS), and streams it over WebRTC.
 */

(function () {
  'use strict';

  // --- DOM Elements ---
  const joinScreen      = document.getElementById('join-screen');
  const sharingScreen   = document.getElementById('sharing-screen');
  const codeInputs      = document.querySelectorAll('.code-input');
  const btnConnect      = document.getElementById('btn-connect');
  const statusEl        = document.getElementById('status');
  const statusText      = document.getElementById('status-text');
  const localPreview    = document.getElementById('local-preview');
  const btnStop         = document.getElementById('btn-stop');
  const backLink        = document.getElementById('back-link');
  const sharingLabel    = document.getElementById('sharing-label');
  const iosNotice       = document.getElementById('ios-notice');

  // --- Detect iOS ---
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const hasScreenCapture = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  // --- Show iOS notice if needed ---
  if (isIOS || !hasScreenCapture) {
    if (iosNotice) {
      iosNotice.classList.remove('hidden');
    }
  }

  // --- State ---
  let peer = null;
  let currentCall = null;
  let localStream = null;

  // --- Code Input Logic ---
  function getEnteredCode() {
    let code = '';
    codeInputs.forEach(input => {
      code += input.value;
    });
    return code;
  }

  function updateConnectButton() {
    const code = getEnteredCode();
    btnConnect.disabled = code.length !== 6;
  }

  codeInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value;

      // Only allow digits
      if (val && !/^\d$/.test(val)) {
        e.target.value = '';
        return;
      }

      // Auto-advance to next input
      if (val && index < codeInputs.length - 1) {
        codeInputs[index + 1].focus();
      }

      updateConnectButton();
    });

    input.addEventListener('keydown', (e) => {
      // Handle backspace — go to previous input
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        codeInputs[index - 1].focus();
        codeInputs[index - 1].value = '';
        updateConnectButton();
      }

      // Handle Enter key
      if (e.key === 'Enter') {
        const code = getEnteredCode();
        if (code.length === 6) {
          startConnection(code);
        }
      }
    });

    // Handle paste into first input
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData)
        .getData('text')
        .replace(/\D/g, '')
        .slice(0, 6);

      for (let i = 0; i < pasted.length && i < codeInputs.length; i++) {
        codeInputs[i].value = pasted[i];
      }

      // Focus the next empty input or the last one
      const nextEmpty = Math.min(pasted.length, codeInputs.length - 1);
      codeInputs[nextEmpty].focus();
      updateConnectButton();
    });
  });

  // Focus first input on load
  codeInputs[0].focus();

  // --- Connect button click ---
  btnConnect.addEventListener('click', () => {
    const code = getEnteredCode();
    if (code.length === 6) {
      startConnection(code);
    }
  });

  // --- Update status UI ---
  function setStatus(type, message) {
    statusEl.classList.remove('hidden');
    statusEl.className = `status status-${type}`;
    statusText.textContent = message;
  }

  // --- Capture media (screen or camera fallback) ---
  async function captureMedia() {
    // Try screen capture first (not available on iOS)
    if (hasScreenCapture) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: 'always',
          },
          audio: true,
        });
        return { stream, type: 'screen' };
      } catch (err) {
        // If user cancelled, throw so caller can handle
        if (err.name === 'NotAllowedError') {
          throw err;
        }
        console.warn('[Phone] Screen capture failed, falling back to camera:', err);
      }
    }

    // Fallback: use camera (works on all devices including iOS)
    console.log('[Phone] Using camera fallback');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment', // Rear camera by default
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: true,
    });
    return { stream, type: 'camera' };
  }

  // --- Start connection flow ---
  async function startConnection(code) {
    btnConnect.disabled = true;

    const captureLabel = hasScreenCapture ? 'Starting screen capture…' : 'Starting camera…';
    setStatus('waiting', captureLabel);

    // Step 1: Capture media
    let captureResult;
    try {
      captureResult = await captureMedia();
    } catch (err) {
      console.error('[Phone] Capture failed:', err);

      if (err.name === 'NotAllowedError') {
        setStatus('error', 'Permission denied. Please try again.');
      } else if (err.name === 'NotFoundError') {
        setStatus('error', 'No camera found on this device.');
      } else {
        setStatus('error', `Capture failed: ${err.message}`);
      }

      btnConnect.disabled = false;
      return;
    }

    localStream = captureResult.stream;
    const captureType = captureResult.type;

    console.log('[Phone] Captured media:', captureType, 'Tracks:', localStream.getTracks().map(t => `${t.kind}:${t.label}`));

    // Update sharing label based on capture type
    if (sharingLabel) {
      sharingLabel.textContent = captureType === 'camera'
        ? 'Your camera is being cast to the TV'
        : 'Your screen is being cast to the TV';
    }

    // Handle user stopping screen share via browser UI
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        console.log('[Phone] Video track ended by user');
        stopSharing();
      });
    }

    setStatus('waiting', 'Connecting to TV…');

    // Step 2: Create peer and call TV
    peer = new Peer({
      host: '0.peerjs.com',
      port: 443,
      secure: true,
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', (myId) => {
      console.log('[Phone] Peer ready with ID:', myId);
      const tvPeerId = `castlink-${code}`;

      // First establish a data connection to verify TV is reachable
      console.log('[Phone] Connecting to TV peer:', tvPeerId);

      currentCall = peer.call(tvPeerId, localStream);

      if (!currentCall) {
        setStatus('error', 'Could not initiate call. Is the code correct?');
        cleanupStream();
        btnConnect.disabled = false;
        return;
      }

      // Listen for the dummy stream back from TV (confirms connection)
      currentCall.on('stream', (remoteStream) => {
        console.log('[Phone] Received answer stream from TV — connection confirmed');
        // We don't display this stream, it's just the dummy handshake stream
      });

      currentCall.on('close', () => {
        console.log('[Phone] Call closed by TV');
        stopSharing();
      });

      currentCall.on('error', (err) => {
        console.error('[Phone] Call error:', err);
        setStatus('error', 'Connection lost');
        stopSharing();
      });

      // Switch to sharing UI after a brief delay to let ICE negotiate
      showSharingView();
    });

    peer.on('error', (err) => {
      console.error('[Phone] Peer error:', err);

      if (err.type === 'peer-unavailable') {
        setStatus('error', 'TV not found. Check the code and try again.');
        cleanupStream();
        btnConnect.disabled = false;

        // Return to join screen
        sharingScreen.classList.add('hidden');
        joinScreen.classList.remove('hidden');
        backLink.classList.remove('hidden');
      } else {
        setStatus('error', `Error: ${err.type}`);
      }
    });
  }

  // --- Show the sharing view ---
  function showSharingView() {
    joinScreen.classList.add('hidden');
    sharingScreen.classList.remove('hidden');
    backLink.classList.add('hidden');

    // Show local preview
    localPreview.srcObject = localStream;
    localPreview.play().catch(() => {});
  }

  // --- Stop sharing and return to join screen ---
  function stopSharing() {
    cleanupStream();

    if (currentCall) {
      currentCall.close();
      currentCall = null;
    }

    if (peer) {
      peer.destroy();
      peer = null;
    }

    // Reset UI
    sharingScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');
    backLink.classList.remove('hidden');
    statusEl.classList.add('hidden');
    localPreview.srcObject = null;
    btnConnect.disabled = false;

    // Clear code inputs
    codeInputs.forEach(input => {
      input.value = '';
    });
    codeInputs[0].focus();
  }

  // --- Cleanup the captured stream ---
  function cleanupStream() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
  }

  // --- Stop button ---
  btnStop.addEventListener('click', () => {
    stopSharing();
  });

  // --- Cleanup on page unload ---
  window.addEventListener('beforeunload', () => {
    cleanupStream();
    if (currentCall) currentCall.close();
    if (peer) peer.destroy();
  });
})();

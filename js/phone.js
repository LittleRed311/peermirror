/**
 * CastLink — Phone/Tablet Side
 * Connects to the TV peer via room code, captures screen with
 * getDisplayMedia, and streams it over WebRTC.
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

  // --- Start connection flow ---
  async function startConnection(code) {
    btnConnect.disabled = true;
    setStatus('waiting', 'Starting screen capture…');

    // Step 1: Capture screen
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
        },
        audio: true, // Will silently fail if not supported
      });
    } catch (err) {
      console.error('[Phone] Screen capture failed:', err);

      if (err.name === 'NotAllowedError') {
        setStatus('error', 'Screen share was cancelled. Please try again.');
      } else {
        setStatus('error', `Capture failed: ${err.message}`);
      }

      btnConnect.disabled = false;
      return;
    }

    // Handle user stopping screen share via browser UI
    localStream.getVideoTracks()[0].addEventListener('ended', () => {
      console.log('[Phone] Screen share stopped by user');
      stopSharing();
    });

    setStatus('waiting', 'Connecting to TV…');

    // Step 2: Create peer and call TV
    peer = new Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', () => {
      console.log('[Phone] Peer ready, calling TV…');
      const tvPeerId = `castlink-${code}`;

      currentCall = peer.call(tvPeerId, localStream);

      if (!currentCall) {
        setStatus('error', 'Could not connect. Is the code correct?');
        btnConnect.disabled = false;
        return;
      }

      currentCall.on('stream', () => {
        // TV doesn't send a stream back, but the event
        // confirms the connection is established
        console.log('[Phone] Connection confirmed');
      });

      currentCall.on('close', () => {
        console.log('[Phone] Call closed');
        stopSharing();
      });

      currentCall.on('error', (err) => {
        console.error('[Phone] Call error:', err);
        setStatus('error', 'Connection lost');
        stopSharing();
      });

      // Switch to sharing UI
      showSharingView();
    });

    peer.on('error', (err) => {
      console.error('[Phone] Peer error:', err);

      if (err.type === 'peer-unavailable') {
        setStatus('error', 'TV not found. Check the code and try again.');
        cleanupStream();
        btnConnect.disabled = false;
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

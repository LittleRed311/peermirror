/**
 * CastLink — TV/Monitor Side
 * Creates a PeerJS peer with a room-code-based ID, waits for incoming
 * screen share calls from the phone, and displays the stream fullscreen.
 */

(function () {
  'use strict';

  // --- DOM Elements ---
  const waitingScreen   = document.getElementById('waiting-screen');
  const roomCodeDisplay = document.getElementById('room-code-display');
  const statusEl        = document.getElementById('status');
  const statusText      = document.getElementById('status-text');
  const videoContainer  = document.getElementById('video-container');
  const remoteVideo     = document.getElementById('remote-video');
  const btnFullscreen   = document.getElementById('btn-fullscreen');
  const btnDisconnect   = document.getElementById('btn-disconnect');
  const backLink        = document.getElementById('back-link');

  // --- State ---
  let peer = null;
  let currentCall = null;
  let roomCode = '';

  // --- Generate a 6-digit numeric code ---
  function generateRoomCode() {
    const digits = [];
    for (let i = 0; i < 6; i++) {
      digits.push(Math.floor(Math.random() * 10));
    }
    return digits.join('');
  }

  // --- Display the room code as individual digit cards ---
  function displayRoomCode(code) {
    roomCodeDisplay.innerHTML = '';
    for (const digit of code) {
      const el = document.createElement('div');
      el.className = 'room-code-digit';
      el.textContent = digit;
      roomCodeDisplay.appendChild(el);
    }
  }

  // --- Update status UI ---
  function setStatus(type, message) {
    statusEl.className = `status status-${type}`;
    statusText.textContent = message;
  }

  // --- Show the fullscreen video player ---
  function showVideo(stream) {
    remoteVideo.srcObject = stream;
    videoContainer.classList.add('active');
    waitingScreen.classList.add('hidden');
    backLink.classList.add('hidden');

    // Auto-attempt fullscreen on the video container
    if (videoContainer.requestFullscreen) {
      videoContainer.requestFullscreen().catch(() => {});
    } else if (videoContainer.webkitRequestFullscreen) {
      videoContainer.webkitRequestFullscreen();
    }
  }

  // --- Return to waiting state ---
  function returnToWaiting() {
    videoContainer.classList.remove('active');
    waitingScreen.classList.remove('hidden');
    backLink.classList.remove('hidden');
    remoteVideo.srcObject = null;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    setStatus('waiting', 'Waiting for phone to connect…');

    // Clean up old peer and create a new one with same code
    if (peer) {
      peer.destroy();
    }
    initPeer();
  }

  // --- Initialize PeerJS ---
  function initPeer() {
    roomCode = generateRoomCode();
    displayRoomCode(roomCode);

    const peerId = `castlink-${roomCode}`;

    peer = new Peer(peerId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', (id) => {
      console.log('[TV] Peer ready with ID:', id);
      setStatus('waiting', 'Waiting for phone to connect…');
    });

    peer.on('call', (call) => {
      console.log('[TV] Incoming call from phone');
      currentCall = call;

      // Answer the call (no local media to send back)
      call.answer();

      call.on('stream', (remoteStream) => {
        console.log('[TV] Receiving remote stream');
        setStatus('connected', 'Connected — receiving screen share');
        showVideo(remoteStream);
      });

      call.on('close', () => {
        console.log('[TV] Call ended');
        currentCall = null;
        returnToWaiting();
      });

      call.on('error', (err) => {
        console.error('[TV] Call error:', err);
        setStatus('error', 'Connection lost. Waiting for reconnect…');
        setTimeout(returnToWaiting, 2000);
      });
    });

    peer.on('error', (err) => {
      console.error('[TV] Peer error:', err);

      if (err.type === 'unavailable-id') {
        // Code collision — generate a new one
        console.log('[TV] Code collision, regenerating…');
        peer.destroy();
        initPeer();
      } else {
        setStatus('error', `Connection error: ${err.type}`);
      }
    });

    peer.on('disconnected', () => {
      console.log('[TV] Peer disconnected, attempting reconnect…');
      setStatus('waiting', 'Reconnecting…');
      peer.reconnect();
    });
  }

  // --- Fullscreen toggle ---
  btnFullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoContainer.requestFullscreen().catch(() => {
        // Fallback for webkit
        if (videoContainer.webkitRequestFullscreen) {
          videoContainer.webkitRequestFullscreen();
        }
      });
    }
  });

  // --- Disconnect button ---
  btnDisconnect.addEventListener('click', () => {
    if (currentCall) {
      currentCall.close();
      currentCall = null;
    }
    returnToWaiting();
  });

  // --- Start ---
  initPeer();
})();

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

    // Ensure the video plays (some browsers need explicit play)
    remoteVideo.play().catch((err) => {
      console.warn('[TV] Video autoplay blocked, user interaction needed:', err);
    });

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

    // Clean up old peer and create a new one
    if (peer) {
      peer.destroy();
    }
    initPeer();
  }

  // --- Create a silent dummy stream to answer with ---
  // PeerJS works more reliably when both sides provide a stream.
  // We create a tiny silent canvas stream so the handshake completes properly.
  function createDummyStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d');
    ctx.fillRect(0, 0, 2, 2);
    const stream = canvas.captureStream(0); // 0 fps = static frame
    return stream;
  }

  // --- Initialize PeerJS ---
  function initPeer() {
    roomCode = generateRoomCode();
    displayRoomCode(roomCode);

    const peerId = `castlink-${roomCode}`;

    peer = new Peer(peerId, {
      host: '0.peerjs.com',
      port: 443,
      secure: true,
      debug: 2, // Log warnings and errors to console
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

    peer.on('open', (id) => {
      console.log('[TV] Peer ready with ID:', id);
      setStatus('waiting', 'Waiting for phone to connect…');
    });

    peer.on('call', (call) => {
      console.log('[TV] Incoming call from phone');
      currentCall = call;
      setStatus('waiting', 'Phone connecting… establishing stream');

      // IMPORTANT: Attach the stream listener BEFORE answering
      // to avoid missing the event
      call.on('stream', (remoteStream) => {
        console.log('[TV] Receiving remote stream, tracks:', remoteStream.getTracks().length);
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

      // Answer with a dummy stream for reliable two-way WebRTC handshake
      const dummyStream = createDummyStream();
      call.answer(dummyStream);
      console.log('[TV] Answered call with dummy stream');
    });

    // Also listen for data connections (used for handshake confirmation)
    peer.on('connection', (conn) => {
      console.log('[TV] Data connection from phone');
      conn.on('open', () => {
        conn.send({ type: 'tv-ready' });
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
      if (!peer.destroyed) {
        peer.reconnect();
      }
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

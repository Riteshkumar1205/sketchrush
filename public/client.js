'use strict';

const socket = io();
const $ = (id) => document.getElementById(id);

const lobbyScreen = $('lobby-screen');
const gameScreen = $('game-screen');
const lobbyFooter = $('lobby-footer');
const nicknameInput = $('nickname');
const roomCodeInput = $('room-code');
const lobbyError = $('lobby-error');
const createButton = $('create-room');
const joinButton = $('join-room');
const chatForm = $('chat-form');
const chatInput = $('chat-input');
const sendChatButton = $('send-chat');
const canvas = $('drawing-canvas');
const canvasWrap = $('canvas-wrap');
const ctx = canvas.getContext('2d');

let roomCode = null;
let myId = null;
let roomState = null;
let currentColor = '#a855f7';
let brushWidth = 4;
let erasing = false;
let drawing = false;
let lastPoint = null;
let canvasStrokes = [];
let toastTimer = null;
let lastSecond = null;

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function setLobbyError(message = '') {
  lobbyError.textContent = message;
}

function getName() {
  return nicknameInput.value.trim().slice(0, 18) || 'Player';
}

function showGame(code) {
  roomCode = code;
  lobbyScreen.classList.add('hidden');
  lobbyFooter.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  $('room-code-display').textContent = code;
  $('share-code').textContent = code;
  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  window.history.replaceState({}, '', url);
  resizeCanvas();
}

function showLobby() {
  roomCode = null;
  roomState = null;
  lobbyScreen.classList.remove('hidden');
  lobbyFooter.classList.remove('hidden');
  gameScreen.classList.add('hidden');
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url);
  setLobbyError('');
}

function emitCreateRoom() {
  setLobbyError('');
  createButton.disabled = true;
  socket.emit('create-room', { name: getName() }, (result) => {
    createButton.disabled = false;
    if (!result?.ok) return setLobbyError(result?.error || 'Could not create room. Try again.');
    showGame(result.code);
    showToast('Room created! Share the code with your friend.');
    socket.emit('request-state');
  });
}

function emitJoinRoom() {
  setLobbyError('');
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 6) return setLobbyError('Enter the 6-character room code.');
  joinButton.disabled = true;
  socket.emit('join-room', { code, name: getName() }, (result) => {
    joinButton.disabled = false;
    if (!result?.ok) return setLobbyError(result?.error || 'Could not join room.');
    showGame(result.code);
    showToast(`Joined room ${result.code}`);
    socket.emit('request-state');
  });
}

createButton.addEventListener('click', emitCreateRoom);
joinButton.addEventListener('click', emitJoinRoom);
roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});
roomCodeInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') emitJoinRoom(); });
nicknameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') emitCreateRoom(); });

socket.on('connect', () => {
  myId = socket.id;
  $('connection-label').textContent = 'CONNECTED';
  $('connection-label').style.color = '#4ade80';
  const codeFromUrl = new URLSearchParams(window.location.search).get('room');
  if (codeFromUrl && !roomCode) {
    roomCodeInput.value = codeFromUrl.toUpperCase().slice(0, 6);
    nicknameInput.focus();
  }
  if (roomCode) socket.emit('request-state');
});

socket.on('disconnect', () => {
  $('connection-label').textContent = 'RECONNECTING';
  $('connection-label').style.color = '#fb7185';
  showToast('Connection lost. Reconnecting…');
});

socket.on('connect_error', () => {
  $('connection-label').textContent = 'OFFLINE';
  $('connection-label').style.color = '#fb7185';
});

socket.on('room-state', (state) => {
  roomState = state;
  roomCode = state.code;
  $('room-code-display').textContent = state.code;
  $('share-code').textContent = state.code;
  $('round-number').textContent = state.round;
  $('round-total').textContent = state.totalRounds;
  $('player-count').textContent = state.players.length;

  const isDrawing = state.status === 'drawing';
  const isDrawer = Boolean(state.isDrawer && isDrawing);
  const tools = $('drawing-tools');
  tools.classList.toggle('hidden', !isDrawer);
  canvas.style.cursor = isDrawer ? (erasing ? 'cell' : 'crosshair') : 'default';
  canvas.style.pointerEvents = isDrawer ? 'auto' : 'none';
  $('canvas-overlay').classList.toggle('hidden', isDrawing);
  $('drawer-banner').classList.toggle('hidden', !isDrawer);
  $('canvas-status').textContent = isDrawing ? (isDrawer ? 'YOU ARE DRAWING' : `${state.drawerName || 'PLAYER'} IS DRAWING`) : state.status === 'finished' ? 'GAME COMPLETE' : 'CANVAS STANDBY';
  $('word-label').textContent = isDrawer ? 'YOUR SECRET WORD' : 'WORD TO GUESS';
  if (isDrawer) $('word-display').textContent = state.secretWord || '…';
  else if (state.status === 'drawing') $('word-display').textContent = state.wordHint || '— — —';
  else if (state.status === 'finished') $('word-display').textContent = 'GAME OVER';
  else if (state.status === 'between') $('word-display').textContent = 'ROUND COMPLETE';
  else $('word-display').textContent = 'WAITING FOR PLAYERS';

  if (state.status === 'waiting') $('game-status-text').textContent = 'Need at least 2 players to start';
  else if (isDrawer) $('game-status-text').textContent = 'Draw clues. No letters or numbers!';
  else if (isDrawing && state.guessedIds?.includes(myId)) $('game-status-text').textContent = 'Correct guess — nice one!';
  else if (isDrawing) $('game-status-text').textContent = `${state.drawerName || 'The drawer'} is sketching. Guess in chat!`;
  else if (state.status === 'between') $('game-status-text').textContent = 'Next round loading…';
  else $('game-status-text').textContent = 'Check the leaderboard for the winner';

  chatInput.disabled = !(state.status === 'drawing' || state.status === 'between');
  sendChatButton.disabled = chatInput.disabled;
  $('rematch-button').classList.toggle('hidden', state.status !== 'finished');
  renderPlayers(state.players, state.drawerId, state.guessedIds || []);
  updateTimer();
});

function renderPlayers(players, drawerId, guessedIds) {
  const list = $('player-list');
  list.replaceChildren();
  if (!players.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-players';
    empty.textContent = 'Waiting for the crew...';
    list.append(empty);
    return;
  }
  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    avatar.textContent = player.name.slice(0, 1).toUpperCase();
    const meta = document.createElement('div');
    meta.className = 'player-meta';
    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = `${player.name}${player.id === myId ? ' (you)' : ''}`;
    const tag = document.createElement('div');
    tag.className = 'player-tag';
    tag.textContent = player.id === drawerId ? '✎ DRAWING' : guessedIds.includes(player.id) ? '✓ GUESSED IT' : index === 0 && player.score > 0 ? '★ TOP PLAYER' : 'IN THE GAME';
    meta.append(name, tag);
    const score = document.createElement('div');
    score.className = 'player-score';
    score.textContent = player.score;
    row.append(avatar, meta, score);
    list.append(row);
  });
}

function addChatMessage(message) {
  const container = $('chat-messages');
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
  const line = document.createElement('div');
  line.className = `message ${message.type || 'chat'}`;
  if (message.type === 'system' || message.type === 'correct') {
    line.textContent = message.message;
  } else {
    const name = document.createElement('span');
    name.className = 'message-name';
    name.textContent = `${message.name}:`;
    const text = document.createElement('span');
    text.className = 'message-text';
    text.textContent = ` ${message.message}`;
    line.append(name, text);
  }
  container.append(line);
  while (container.children.length > 70) container.firstElementChild.remove();
  container.scrollTop = container.scrollHeight;
}

socket.on('chat-message', addChatMessage);
socket.on('chat-history', (messages) => {
  const container = $('chat-messages');
  container.replaceChildren();
  messages.forEach(addChatMessage);
});
chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || chatInput.disabled) return;
  socket.emit('chat', { message });
  chatInput.value = '';
  chatInput.focus();
});

function normalizedPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function drawStroke(stroke, remember = true) {
  if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.save();
  ctx.strokeStyle = stroke.color || '#a855f7';
  ctx.fillStyle = stroke.color || '#a855f7';
  ctx.lineWidth = stroke.width || 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pts = stroke.points;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x * w, pts[0].y * h, Math.max(1, (stroke.width || 4) / 2), 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * w, pts[i].y * h);
    ctx.stroke();
  }
  ctx.restore();
  if (remember) canvasStrokes.push(stroke);
}

function resizeCanvas() {
  if (!canvasWrap || !canvas.clientWidth) return;
  const oldWidth = canvas.width;
  const oldHeight = canvas.height;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.floor(canvas.clientWidth * ratio);
  const height = Math.floor(canvas.clientHeight * ratio);
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redrawCanvas();
}

function redrawCanvas() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  const strokes = [...canvasStrokes];
  canvasStrokes = [];
  strokes.forEach((stroke) => drawStroke(stroke, true));
}

canvas.addEventListener('pointerdown', (event) => {
  if (!roomState?.isDrawer || roomState.status !== 'drawing') return;
  drawing = true;
  lastPoint = normalizedPoint(event);
  canvas.setPointerCapture?.(event.pointerId);
  const stroke = { points: [lastPoint], color: erasing ? '#0c0c19' : currentColor, width: erasing ? 22 : brushWidth };
  drawStroke(stroke);
  socket.emit('draw', stroke);
});
canvas.addEventListener('pointermove', (event) => {
  if (!drawing || !lastPoint) return;
  const point = normalizedPoint(event);
  const stroke = { points: [lastPoint, point], color: erasing ? '#0c0c19' : currentColor, width: erasing ? 22 : brushWidth };
  drawStroke(stroke);
  socket.emit('draw', stroke);
  lastPoint = point;
});
function stopDrawing() { drawing = false; lastPoint = null; }
canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);
canvas.addEventListener('lostpointercapture', stopDrawing);
socket.on('draw', (stroke) => drawStroke(stroke));
socket.on('canvas-history', (strokes) => {
  canvasStrokes = [];
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  (strokes || []).forEach((stroke) => drawStroke(stroke));
});
socket.on('clear-canvas', () => {
  canvasStrokes = [];
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
});

$('drawing-tools').querySelectorAll('.swatch').forEach((button) => {
  button.addEventListener('click', () => {
    currentColor = button.dataset.color;
    erasing = false;
    $('eraser-tool').classList.remove('active');
    $('drawing-tools').querySelectorAll('.swatch').forEach((swatch) => swatch.classList.toggle('active', swatch === button));
    $('brush-label').textContent = `BRUSH / ${brushWidth} PX`;
  });
});
$('eraser-tool').addEventListener('click', () => {
  erasing = !erasing;
  $('eraser-tool').classList.toggle('active', erasing);
  $('brush-label').textContent = erasing ? 'ERASER / 22 PX' : `BRUSH / ${brushWidth} PX`;
});
$('clear-canvas').addEventListener('click', () => {
  if (roomState?.isDrawer && roomState.status === 'drawing') socket.emit('clear-canvas');
});

function updateTimer() {
  if (!roomState || roomState.status !== 'drawing' || !roomState.deadline) {
    $('timer-value').textContent = roomState?.status === 'finished' ? '✓' : roomState?.status === 'between' ? '…' : '60';
    $('timer-progress').style.strokeDashoffset = '0';
    $('timer-progress').style.stroke = '#22d3ee';
    lastSecond = null;
    return;
  }
  const seconds = Math.max(0, Math.ceil((roomState.deadline - Date.now()) / 1000));
  $('timer-value').textContent = seconds;
  $('timer-progress').style.strokeDashoffset = String(169.65 * (1 - seconds / 60));
  $('timer-progress').style.stroke = seconds <= 10 ? '#fb7185' : '#22d3ee';
  if (seconds !== lastSecond) {
    lastSecond = seconds;
    if (seconds <= 10) $('timer-value').style.color = '#fb7185';
    else $('timer-value').style.color = '';
  }
}
setInterval(updateTimer, 250);

$('copy-link').addEventListener('click', async () => {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomCode || $('share-code').textContent);
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast('Invite link copied!');
  } catch {
    showToast(`Share room code: ${roomCode}`);
  }
});
$('leave-room').addEventListener('click', () => {
  socket.emit('leave-room');
  showLobby();
  showToast('You left the room.');
});
socket.on('left-room', showLobby);
$('rematch-button').addEventListener('click', () => socket.emit('rematch'));
window.addEventListener('resize', resizeCanvas);

// If a room code is in the URL, prefill it. The player can enter a nickname and join.
const initialCode = new URLSearchParams(window.location.search).get('room');
if (initialCode) roomCodeInput.value = initialCode.toUpperCase().slice(0, 6);

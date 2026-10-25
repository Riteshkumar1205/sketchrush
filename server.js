'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { randomInt } = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const ROUND_SECONDS = 60;
const ROUNDS_PER_GAME = 5;
const MIN_PLAYERS_TO_START = 2;
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_CHAT_LENGTH = 180;
const MAX_STROKE_POINTS = 80;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const WORDS = [
  'PIZZA', 'ROCKET', 'RAINBOW', 'TIGER', 'CASTLE', 'BANANA', 'GUITAR',
  'VOLCANO', 'ROBOT', 'DINOSAUR', 'UMBRELLA', 'PENGUIN', 'HELICOPTER',
  'SUNFLOWER', 'SANDWICH', 'ASTRONAUT', 'WATERMELON', 'SNOWMAN', 'DRAGON',
  'BUTTERFLY', 'LAPTOP', 'CACTUS', 'POPCORN', 'TREASURE', 'TURTLE', 'CROWN',
  'AIRPLANE', 'SPIDER', 'ICE CREAM', 'LIGHTNING', 'GHOST', 'CAMPFIRE', 'OCTOPUS'
];

const rooms = new Map();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function cleanName(value) {
  const name = String(value || '').replace(/[<>\r\n]/g, '').trim().slice(0, 18);
  return name || 'Player';
}

function cleanRoomCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function makeRoomCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function publicPlayers(room) {
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected
  }));
}

function maskedWord(word) {
  return word.split('').map((char) => char === ' ' ? ' ' : '_').join(' ');
}

function sendRoomState(room) {
  const base = {
    code: room.code,
    players: publicPlayers(room),
    status: room.status,
    round: room.round,
    totalRounds: ROUNDS_PER_GAME,
    drawerId: room.drawerId,
    drawerName: room.players.find((p) => p.id === room.drawerId)?.name || null,
    deadline: room.deadline,
    seconds: room.status === 'drawing' ? Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000)) : 0,
    wordHint: room.word ? maskedWord(room.word) : '',
    guessedIds: [...room.guessedIds]
  };

  for (const player of room.players) {
    io.to(player.id).emit('room-state', {
      ...base,
      isDrawer: player.id === room.drawerId,
      secretWord: player.id === room.drawerId ? room.word : null
    });
  }
}

function systemMessage(room, message) {
  const payload = { type: 'system', name: 'SKETCHRUSH', message, at: Date.now() };
  room.messages.push(payload);
  room.messages = room.messages.slice(-60);
  io.to(room.code).emit('chat-message', payload);
}

function clearRoundTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function chooseWord(previousWord) {
  let word = WORDS[randomInt(WORDS.length)];
  if (WORDS.length > 1) {
    while (word === previousWord) word = WORDS[randomInt(WORDS.length)];
  }
  return word;
}

function startRound(room) {
  clearRoundTimer(room);
  if (room.players.filter((p) => p.connected).length < MIN_PLAYERS_TO_START) {
    room.status = 'waiting';
    room.word = null;
    room.drawerId = null;
    room.deadline = null;
    sendRoomState(room);
    return;
  }

  if (room.round >= ROUNDS_PER_GAME) {
    room.status = 'finished';
    room.word = null;
    room.drawerId = null;
    room.deadline = null;
    sendRoomState(room);
    const winner = [...room.players].sort((a, b) => b.score - a.score)[0];
    systemMessage(room, winner ? `Game over! ${winner.name} wins with ${winner.score} points!` : 'Game over!');
    return;
  }

  const connectedPlayers = room.players.filter((p) => p.connected);
  if (!connectedPlayers.length) return;
  room.round += 1;
  const drawer = connectedPlayers[(room.round - 1) % connectedPlayers.length];
  room.drawerId = drawer.id;
  room.word = chooseWord(room.previousWord);
  room.previousWord = room.word;
  room.guessedIds = new Set();
  room.status = 'drawing';
  room.deadline = Date.now() + ROUND_SECONDS * 1000;
  room.strokes = [];
  io.to(room.code).emit('clear-canvas');
  systemMessage(room, `Round ${room.round} started! ${drawer.name} is drawing. You have ${ROUND_SECONDS} seconds.`);
  sendRoomState(room);

  room.timer = setTimeout(() => endRound(room, 'time'), ROUND_SECONDS * 1000);
}

function endRound(room, reason) {
  if (room.status !== 'drawing') return;
  clearRoundTimer(room);
  const answer = room.word;
  room.status = 'between';
  room.deadline = null;
  systemMessage(room, reason === 'guessed' ? `Correct! The word was ${answer}.` : `Time's up! The word was ${answer}.`);
  sendRoomState(room);
  room.nextTimer = setTimeout(() => {
    room.nextTimer = null;
    startRound(room);
  }, 3500);
}

function getRoomForSocket(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

function leaveCurrentRoom(socket) {
  const room = getRoomForSocket(socket);
  if (!room) return;
  const index = room.players.findIndex((p) => p.id === socket.id);
  if (index !== -1) {
    const [player] = room.players.splice(index, 1);
    systemMessage(room, `${player.name} left the room.`);
  }
  socket.leave(room.code);
  socket.data.roomCode = null;

  if (room.players.length === 0) {
    clearRoundTimer(room);
    if (room.nextTimer) clearTimeout(room.nextTimer);
    rooms.delete(room.code);
    return;
  }

  if (room.status === 'drawing' && room.drawerId === socket.id) {
    systemMessage(room, 'The drawer disconnected. Moving to the next round.');
    endRound(room, 'time');
  } else {
    sendRoomState(room);
    if (room.status === 'waiting' && room.players.filter((p) => p.connected).length >= MIN_PLAYERS_TO_START) {
      startRound(room);
    }
  }
}

io.on('connection', (socket) => {
  socket.emit('connected', { id: socket.id });

  socket.on('create-room', ({ name } = {}, callback = () => {}) => {
    leaveCurrentRoom(socket);
    const code = makeRoomCode();
    const room = {
      code,
      players: [{ id: socket.id, name: cleanName(name), score: 0, connected: true }],
      status: 'waiting',
      round: 0,
      drawerId: null,
      word: null,
      previousWord: null,
      deadline: null,
      timer: null,
      nextTimer: null,
      guessedIds: new Set(),
      strokes: [],
      messages: []
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    callback({ ok: true, code });
    systemMessage(room, `${room.players[0].name} created the room. Share code ${code} with a friend!`);
    sendRoomState(room);
  });

  socket.on('join-room', ({ code, name } = {}, callback = () => {}) => {
    const normalizedCode = cleanRoomCode(code);
    const room = rooms.get(normalizedCode);
    if (!room) return callback({ ok: false, error: 'Room not found. Check the code and try again.' });
    if (room.players.length >= MAX_PLAYERS_PER_ROOM) return callback({ ok: false, error: 'This room is full.' });
    if (room.players.some((p) => p.id === socket.id)) return callback({ ok: true, code: room.code });

    leaveCurrentRoom(socket);
    const player = { id: socket.id, name: cleanName(name), score: 0, connected: true };
    room.players.push(player);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    callback({ ok: true, code: room.code });
    systemMessage(room, `${player.name} joined the room.`);
    sendRoomState(room);

    if (room.status === 'waiting' && room.players.filter((p) => p.connected).length >= MIN_PLAYERS_TO_START) {
      startRound(room);
    }
  });

  socket.on('draw', (data = {}) => {
    const room = getRoomForSocket(socket);
    if (!room || room.status !== 'drawing' || room.drawerId !== socket.id) return;
    const points = Array.isArray(data.points) ? data.points.slice(0, MAX_STROKE_POINTS) : [];
    if (!points.length) return;
    const safePoints = points.map((point) => ({
      x: Math.max(0, Math.min(1, Number(point.x) || 0)),
      y: Math.max(0, Math.min(1, Number(point.y) || 0))
    }));
    const color = /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : '#a855f7';
    const width = Math.max(1, Math.min(24, Number(data.width) || 4));
    const stroke = { points: safePoints, color, width, playerId: socket.id };
    room.strokes.push(stroke);
    if (room.strokes.length > 2500) room.strokes.splice(0, room.strokes.length - 2500);
    socket.to(room.code).emit('draw', stroke);
  });

  socket.on('clear-canvas', () => {
    const room = getRoomForSocket(socket);
    if (!room || room.status !== 'drawing' || room.drawerId !== socket.id) return;
    room.strokes = [];
    io.to(room.code).emit('clear-canvas');
  });

  socket.on('chat', ({ message } = {}) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    const text = String(message || '').trim().slice(0, MAX_CHAT_LENGTH);
    if (!text) return;

    if (room.status === 'drawing' && socket.id !== room.drawerId && !room.guessedIds.has(socket.id)) {
      const normalizedGuess = text.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedWord = room.word.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedGuess === normalizedWord) {
        const secondsLeft = Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000));
        const points = 100 + secondsLeft;
        player.score += points;
        room.guessedIds.add(socket.id);
        const drawer = room.players.find((p) => p.id === room.drawerId);
        if (drawer) drawer.score += 40;
        const payload = {
          type: 'correct', name: player.name,
          message: `${player.name} guessed it! +${points} points`, at: Date.now()
        };
        room.messages.push(payload);
        io.to(room.code).emit('chat-message', payload);
        sendRoomState(room);
        if (room.guessedIds.size >= room.players.filter((p) => p.connected && p.id !== room.drawerId).length) {
          endRound(room, 'guessed');
        }
        return;
      }
    }

    const payload = { type: 'chat', name: player.name, message: text, at: Date.now() };
    room.messages.push(payload);
    room.messages = room.messages.slice(-60);
    io.to(room.code).emit('chat-message', payload);
  });

  socket.on('request-state', () => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    socket.emit('chat-history', room.messages);
    socket.emit('canvas-history', room.strokes);
    sendRoomState(room);
  });

  socket.on('leave-room', () => {
    leaveCurrentRoom(socket);
    socket.emit('left-room');
  });

  socket.on('rematch', () => {
    const room = getRoomForSocket(socket);
    if (!room || room.status !== 'finished') return;
    room.round = 0;
    room.players.forEach((p) => { p.score = 0; });
    room.previousWord = null;
    room.status = 'waiting';
    room.guessedIds = new Set();
    systemMessage(room, 'Rematch requested! Starting a new game.');
    sendRoomState(room);
    if (room.players.filter((p) => p.connected).length >= MIN_PLAYERS_TO_START) startRound(room);
  });

  socket.on('disconnect', () => leaveCurrentRoom(socket));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SketchRush is running at http://localhost:${PORT}`);
});

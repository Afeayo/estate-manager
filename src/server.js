// src/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Init DB first
require('./config/database');

const routes = require('./routes/index');
const { updateOverdueBills, checkExpiringLeases } = require('./utils/helpers');

const app = express();
const server = http.createServer(app);

// ─── Socket.io Setup ──────────────────────────────────────
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || '*', methods: ['GET', 'POST'] }
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  socket.on('join_complaint', (complaintId) => {
    socket.join(`complaint_${complaintId}`);
  });

  socket.on('join_user', (userId) => {
    socket.join(`user_${userId}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// ─── Middleware ──────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure upload dirs exist
const uploadDir = process.env.UPLOAD_PATH || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Serve uploaded files
app.use('/uploads', express.static(path.resolve(uploadDir)));

// ─── Serve Frontend Static Files ─────────────────────────
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// ─── API Routes ──────────────────────────────────────────
app.use('/api', routes);

// ─── Health Check ────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ─── SPA Fallback ────────────────────────────────────────
app.get('*', (req, res) => {
  const indexPath = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend not found. API is running.' });
  }
});

// ─── Error Handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 5MB)' });
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Scheduled Tasks (every hour) ───────────────────────
setInterval(() => {
  updateOverdueBills();
  checkExpiringLeases();
}, 60 * 60 * 1000);

// Run on startup too
setTimeout(() => {
  updateOverdueBills();
  checkExpiringLeases();
}, 3000);

// ─── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 EstateManager Server running on http://localhost:${PORT}`);
  console.log(`📦 API:       http://localhost:${PORT}/api`);
  console.log(`🔍 Health:    http://localhost:${PORT}/api/health`);
  console.log(`📁 Uploads:   http://localhost:${PORT}/uploads`);
  console.log(`🌐 Frontend:  http://localhost:${PORT}\n`);
});

module.exports = { app, server };

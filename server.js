const express = require('express');
const path = require('path'); // Core Node module
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// THE FIX: This ensures the server always finds the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Fallback for the root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ... Your MongoDB connection and API routes here ... */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Petra live at http://localhost:${PORT}`));

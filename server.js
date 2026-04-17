const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// --- ADD THIS LINE BELOW ---
app.use(express.static('public')); 
// ---------------------------

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Petra Database Connected"))
    .catch(err => console.log("❌ DB Error:", err));

// Create a Data Model
const Booking = mongoose.model('Booking', new mongoose.Schema({
    sitter: String,
    customerName: String,
    service: String,
    startDate: String,
    createdAt: { type: Date, default: Date.now }
}));

// Route to get existing bookings
app.get('/api/bookings', async (req, res) => {
    const data = await Booking.find().sort({ createdAt: -1 }).limit(10);
    res.json(data);
});

// Route to create a booking and tell everyone in real-time
app.post('/api/bookings', async (req, res) => {
    try {
        const newBooking = new Booking(req.body);
        await newBooking.save();
        
        // Broadcast the real-time event
        io.emit('new_booking_event', newBooking); 
        
        res.status(201).json(newBooking);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Petra Server live on port ${PORT}`));

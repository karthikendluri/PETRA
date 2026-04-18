const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { 
        origin: "*",
        methods: ["GET", "POST", "PATCH"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(cors({ origin: "*", methods: ["GET", "POST", "PATCH"] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Petra Database Connected"))
    .catch(err => console.log("❌ DB Error:", err));

// ─── Schemas ────────────────────────────────────────────────────────────────

const BookingSchema = new mongoose.Schema({
    sitter: String,
    sitterId: String,
    customerName: String,
    petName: String,
    petType: { type: String, default: 'Dog' },
    service: String,
    startDate: String,
    endDate: String,
    status: { type: String, default: 'confirmed', enum: ['pending', 'confirmed', 'active', 'completed', 'cancelled'] },
    price: Number,
    notes: String,
    createdAt: { type: Date, default: Date.now }
});

const SitterSchema = new mongoose.Schema({
    sitterId: { type: String, unique: true },
    name: String,
    avatar: String,
    specialty: String,
    rating: { type: Number, default: 4.8 },
    reviewCount: { type: Number, default: 0 },
    isAvailable: { type: Boolean, default: true },
    activeBookings: { type: Number, default: 0 },
    totalBookings: { type: Number, default: 0 },
    location: String,
    hourlyRate: Number,
    services: [String],
    connectedAt: Date,
    lastSeen: { type: Date, default: Date.now }
});

const Booking = mongoose.model('Booking', BookingSchema);
const Sitter = mongoose.model('Sitter', SitterSchema);

// ─── Seed sitters if empty ───────────────────────────────────────────────────

const seedSitters = async () => {
    const count = await Sitter.countDocuments();
    if (count === 0) {
        await Sitter.insertMany([
            { sitterId: 's1', name: 'Maya Chen', specialty: 'Dogs & Puppies', rating: 4.9, reviewCount: 124, location: 'Austin, TX', hourlyRate: 25, services: ['Dog Walking', 'Boarding', 'Day Care'], avatar: '🐕‍🦺' },
            { sitterId: 's2', name: 'Jake Rivera', specialty: 'Cats & Kittens', rating: 4.8, reviewCount: 98, location: 'Austin, TX', hourlyRate: 22, services: ['Cat Sitting', 'Boarding', 'Drop-In Visits'], avatar: '🐈' },
            { sitterId: 's3', name: 'Priya Nair', specialty: 'All Pets', rating: 4.7, reviewCount: 211, location: 'Round Rock, TX', hourlyRate: 28, services: ['Dog Walking', 'Boarding', 'Training'], avatar: '🐾' },
            { sitterId: 's4', name: 'Sam Torres', specialty: 'Exotic Pets', rating: 4.6, reviewCount: 56, location: 'Cedar Park, TX', hourlyRate: 30, services: ['Exotic Care', 'Boarding', 'House Sitting'], avatar: '🦜' },
        ]);
        console.log('✅ Seeded sitters');
    }
};
seedSitters();

// ─── In-memory live state ────────────────────────────────────────────────────

let onlineUsers = 0; // customers browsing

// ─── Socket.IO ──────────────────────────────────────────────────────────────

io.on('connection', async (socket) => {
    onlineUsers++;
    io.emit('online_users', onlineUsers);
    console.log(`👤 Client connected. Online: ${onlineUsers}`);

    // Send current state on connect
    const [bookings, sitters, stats] = await Promise.all([
        Booking.find({ status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).limit(20),
        Sitter.find().sort({ rating: -1 }),
        getStats()
    ]);
    socket.emit('initial_state', { bookings, sitters, stats });

    // Sitter went online (sitter app integration point)
    socket.on('sitter_online', async ({ sitterId }) => {
        await Sitter.findOneAndUpdate({ sitterId }, { isAvailable: true, connectedAt: new Date(), lastSeen: new Date() });
        const sitter = await Sitter.findOne({ sitterId });
        io.emit('sitter_status_changed', { sitter, event: 'online' });
    });

    // Sitter toggled availability
    socket.on('toggle_availability', async ({ sitterId }) => {
        const sitter = await Sitter.findOne({ sitterId });
        if (sitter) {
            sitter.isAvailable = !sitter.isAvailable;
            sitter.lastSeen = new Date();
            await sitter.save();
            io.emit('sitter_status_changed', { sitter, event: 'availability' });
        }
    });

    // Booking status update
    socket.on('update_booking_status', async ({ bookingId, status }) => {
        const booking = await Booking.findByIdAndUpdate(bookingId, { status }, { new: true });
        if (booking) {
            io.emit('booking_status_updated', booking);
            const stats = await getStats();
            io.emit('stats_updated', stats);
        }
    });

    socket.on('disconnect', () => {
        onlineUsers = Math.max(0, onlineUsers - 1);
        io.emit('online_users', onlineUsers);
        console.log(`👤 Client disconnected. Online: ${onlineUsers}`);
    });
});

// ─── Stats Helper ────────────────────────────────────────────────────────────

async function getStats() {
    const [total, active, confirmed, todayCount] = await Promise.all([
        Booking.countDocuments(),
        Booking.countDocuments({ status: 'active' }),
        Booking.countDocuments({ status: 'confirmed' }),
        Booking.countDocuments({
            createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        })
    ]);
    const revenue = await Booking.aggregate([
        { $match: { status: { $in: ['confirmed', 'active', 'completed'] } } },
        { $group: { _id: null, total: { $sum: '$price' } } }
    ]);
    return {
        total,
        active,
        confirmed,
        todayCount,
        revenue: revenue[0]?.total || 0,
        onlineUsers
    };
}

// ─── REST API ────────────────────────────────────────────────────────────────

// Get bookings
app.get('/api/bookings', async (req, res) => {
    const { status, sitterId, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (sitterId) filter.sitterId = sitterId;
    const data = await Booking.find(filter).sort({ createdAt: -1 }).limit(parseInt(limit));
    res.json(data);
});

// Create booking (real-time broadcast)
app.post('/api/bookings', async (req, res) => {
    try {
        // Calculate price based on service
        const prices = { 'Dog Walking': 25, 'Cat Sitting': 22, 'Boarding': 45, 'Day Care': 35, 'Drop-In Visits': 20, 'Training': 55, 'Exotic Care': 60, 'House Sitting': 40 };
        const price = prices[req.body.service] || 30;

        const newBooking = new Booking({ ...req.body, price });
        await newBooking.save();

        // Update sitter's booking count
        if (req.body.sitterId) {
            await Sitter.findOneAndUpdate(
                { sitterId: req.body.sitterId },
                { $inc: { activeBookings: 1, totalBookings: 1 } }
            );
        }

        const stats = await getStats();

        // Real-time broadcast to all clients
        io.emit('new_booking_event', newBooking);
        io.emit('stats_updated', stats);

        res.status(201).json(newBooking);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get sitters
app.get('/api/sitters', async (req, res) => {
    const sitters = await Sitter.find().sort({ rating: -1 });
    res.json(sitters);
});

// Update sitter availability
app.patch('/api/sitters/:sitterId/availability', async (req, res) => {
    const sitter = await Sitter.findOneAndUpdate(
        { sitterId: req.params.sitterId },
        { isAvailable: req.body.isAvailable, lastSeen: new Date() },
        { new: true }
    );
    io.emit('sitter_status_changed', { sitter, event: 'availability' });
    res.json(sitter);
});

// Get stats
app.get('/api/stats', async (req, res) => {
    res.json(await getStats());
});

// Cancel booking
app.patch('/api/bookings/:id/cancel', async (req, res) => {
    const booking = await Booking.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
    if (booking?.sitterId) {
        await Sitter.findOneAndUpdate({ sitterId: booking.sitterId }, { $inc: { activeBookings: -1 } });
    }
    io.emit('booking_status_updated', booking);
    const stats = await getStats();
    io.emit('stats_updated', stats);
    res.json(booking);
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Petra Server live on port ${PORT}`));

// Connect to the server
const socket = io(); // Automatically connects to the same host serving the page

let currentSitter = "";

// 1. LISTEN for real-time updates from the server
socket.on('new_booking_broadcast', (booking) => {
    console.log("Real-time booking received!", booking);
    addBookingToTable(booking);
});

// 2. Fetch existing data when page loads
async function fetchInitialBookings() {
    const response = await fetch('/api/bookings');
    const bookings = await response.json();
    bookings.forEach(addBookingToTable);
}

// 3. SEND data to server when booking is confirmed
async function confirmBooking() {
    const bookingData = {
        sitter: currentSitter,
        customerName: document.getElementById('userName').value,
        startDate: document.getElementById('bookDate').value,
        service: document.getElementById('bookService').value
    };

    const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingData)
    });

    if (response.ok) {
        closeModal();
    }
}

function addBookingToTable(b) {
    const row = `
        <tr>
            <td><strong>${b.sitter}</strong></td>
            <td>${b.customerName}</td>
            <td>${b.service}</td>
            <td>${b.startDate}</td>
            <td><span class="badge">Live</span></td>
        </tr>`;
    document.getElementById('ledgerBody').insertAdjacentHTML('afterbegin', row);
}

function openModal(sitter) {
    currentSitter = sitter;
    document.getElementById('sitterNameDisplay').innerText = sitter;
    document.getElementById('bookingModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('bookingModal').style.display = 'none';
}

window.onload = fetchInitialBookings;
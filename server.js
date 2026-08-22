const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Persistent database file paths
const DB_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DB_DIR, 'users.json');
const ORDERS_FILE = path.join(DB_DIR, 'orders.json');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}
if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify([]));
}

// Helper functions for JSON database
function readUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function readOrders() {
  try {
    const data = fs.readFileSync(ORDERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// Peakerr API configuration
const PEAKERR_API_URL = 'https://peakerr.com/api/v2';
const PEAKERR_API_KEY = process.env.PEAKERR_API_KEY || '178f56fa08420e7df65cbcc1ca15d38e';

// ==================== AUTH & USER ROUTES ====================

// Signup Route
app.post('/api/signup', (req, res) => {
  const { name, email, whatsapp, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  let allUsers = readUsers();
  const existing = allUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(400).json({ success: false, error: 'Email already registered' });
  }

  const customId = 'DJ-' + Math.floor(100000 + Math.random() * 900000);
  const apiKey = 'djs_live_' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  const isAdmin = (email.toLowerCase() === 'isahy061@gmail.com');

  const newUser = {
    customId,
    name,
    email: email.toLowerCase(),
    whatsapp: whatsapp || '',
    password,
    balance: 0.0,
    apiKey,
    isAdmin,
    createdAt: new Date().toISOString()
  };

  allUsers.push(newUser);
  writeUsers(allUsers);

  const { password: _, ...safeUser } = newUser;
  res.json({ success: true, user: safeUser });
});

// Login Route
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const allUsers = readUsers();
  const user = allUsers.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);

  if (!user) {
    return res.status(400).json({ success: false, error: 'Invalid email or password' });
  }

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// Get User Profile Data
app.get('/api/user/:customId', (req, res) => {
  const allUsers = readUsers();
  const user = allUsers.find(u => u.customId === req.params.customId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// Update User Profile
app.put('/api/user/:customId', (req, res) => {
  const { name, whatsapp } = req.body;
  let allUsers = readUsers();
  const index = allUsers.findIndex(u => u.customId === req.params.customId);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  if (name) allUsers[index].name = name;
  if (whatsapp) allUsers[index].whatsapp = whatsapp;

  writeUsers(allUsers);
  const { password: _, ...safeUser } = allUsers[index];
  res.json({ success: true, user: safeUser });
});

// ==================== SERVICES ROUTE ====================

// Fetch live services from Peakerr API using form-urlencoded
app.get('/api/services', async (req, res) => {
  try {
    const params = new URLSearchParams();
    params.append('key', PEAKERR_API_KEY);
    params.append('action', 'services');

    const response = await axios.post(PEAKERR_API_URL, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching services from Peakerr:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch services' });
  }
});

// ==================== ORDERS ROUTES ====================

// Place Order Route
app.post('/api/orders', async (req, res) => {
  const { userId, serviceId, link, quantity } = req.body;
  if (!userId || !serviceId || !link || !quantity) {
    return res.status(400).json({ success: false, error: 'Missing order parameters' });
  }

  let allUsers = readUsers();
  const userIndex = allUsers.findIndex(u => u.customId === userId);
  if (userIndex === -1) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  try {
    // 1. Fetch services to calculate accurate cost using markup rate
    const serviceParams = new URLSearchParams();
    serviceParams.append('key', PEAKERR_API_KEY);
    serviceParams.append('action', 'services');

    const servicesRes = await axios.post(PEAKERR_API_URL, serviceParams, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    
    const serviceList = servicesRes.data;
    const targetService = Array.isArray(serviceList) ? serviceList.find(s => (s.service || s.id).toString() === serviceId.toString()) : null;

    if (!targetService) {
      return res.status(400).json({ success: false, error: 'Selected service does not exist' });
    }

    const baseRate = parseFloat(targetService.rate || 0);
    const markedUpRate = baseRate * 1.65; // 65% markup
    const totalCost = (markedUpRate / 1000) * parseInt(quantity);

    if (allUsers[userIndex].balance < totalCost) {
      return res.status(400).json({ success: false, error: 'Insufficient wallet balance. Please top up.' });
    }

    // 2. Submit order to Peakerr provider API using form-urlencoded
    const orderParams = new URLSearchParams();
    orderParams.append('key', PEAKERR_API_KEY);
    orderParams.append('action', 'add');
    orderParams.append('service', serviceId);
    orderParams.append('link', link);
    orderParams.append('quantity', quantity);

    const providerRes = await axios.post(PEAKERR_API_URL, orderParams, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (providerRes.data && providerRes.data.order) {
      // Deduct balance
      allUsers[userIndex].balance -= totalCost;
      writeUsers(allUsers);

      // Save order to local DB
      let orders = readOrders();
      const newOrder = {
        orderId: providerRes.data.order,
        userId,
        serviceId,
        link,
        quantity: parseInt(quantity),
        cost: totalCost,
        status: 'Processing',
        createdAt: new Date().toISOString()
      };
      orders.unshift(newOrder);
      writeOrders(orders);

      const { password: _, ...safeUser } = allUsers[userIndex];
      return res.json({ success: true, order: newOrder, user: safeUser });
    } else {
      return res.status(400).json({ success: false, error: providerRes.data.error || 'Provider rejected order' });
    }
  } catch (error) {
    console.error('Order processing error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error processing order' });
  }
});

// Get Orders History
app.get('/api/orders', (req, res) => {
  const { userId } = req.query;
  const orders = readOrders();
  if (userId) {
    const userOrders = orders.filter(o => o.userId === userId);
    return res.json({ success: true, orders: userOrders });
  }
  res.json({ success: true, orders });
});

// ==================== PAYMENT & ADMIN ROUTES ====================

// Verify Paystack Payment & Fund Wallet
app.post('/api/payment/verify', async (req, res) => {
  const { userId, reference } = req.body;
  if (!userId || !reference) {
    return res.status(400).json({ success: false, error: 'Missing verification data' });
  }

  try {
    let allUsers = readUsers();
    const userIndex = allUsers.findIndex(u => u.customId === userId);
    if (userIndex === -1) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY || '';
    let creditedAmount = 1000; // default simulation fallback
    
    try {
      const verifyRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${paystackSecret}` }
      });
      if (verifyRes.data && verifyRes.data.data && verifyRes.data.data.status === 'success') {
        creditedAmount = verifyRes.data.data.amount / 100;
      }
    } catch (err) {
      console.warn('Paystack live verification skipped/simulated:', err.message);
    }

    allUsers[userIndex].balance += creditedAmount;
    writeUsers(allUsers);

    const { password: _, ...safeUser } = allUsers[userIndex];
    res.json({ success: true, user: safeUser, credited: creditedAmount });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Payment verification failed' });
  }
});

// Admin Metrics Route
app.get('/api/admin/metrics/:customId', (req, res) => {
  const allUsers = readUsers();
  const requester = allUsers.find(u => u.customId === req.params.customId);

  if (!requester || !requester.isAdmin) {
    return res.status(403).json({ success: false, error: 'Unauthorized access' });
  }

  const orders = readOrders();
  const totalRevenue = orders.reduce((acc, o) => acc + (o.cost || 0), 0);

  res.json({
    success: true,
    metrics: {
      userCount: allUsers.length,
      totalOrders: orders.length,
      totalRevenue
    }
  });
});

// Fallback routing for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DonJaySocial server running on port ${PORT}`);
});
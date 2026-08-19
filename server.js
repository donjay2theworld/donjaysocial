const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static HTML/CSS/JS frontend files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Peakerr SMM Provider Configuration
const SMM_API_URL = 'https://peakerr.com/api/v2';
const SMM_API_KEY = 'e9b83ff3530597cbe01a44d7a3d9944a';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_live_...'; 

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// In-Memory Database
const users = []; 
const orders = []; 

// Helper: Generate unique IDs and API keys
const generateId = () => Math.floor(100000 + Math.random() * 900000).toString();
const generateApiKey = () => crypto.randomBytes(20).toString('hex');

// Seed default admin account
const adminPasswordHash = bcrypt.hashSync('admin123', 10);
users.push({
  customId: '100001',
  name: 'Isah Yusuf',
  email: 'isahy061@gmail.com',
  whatsapp: '+2348000000000',
  passwordHash: adminPasswordHash,
  balance: 5000.00,
  apiKey: generateApiKey(),
  isAdmin: true
});

// ==================== AUTH ROUTES ====================

app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, whatsapp, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Please fill in all required fields.' });
    }

    const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Email is already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      customId: generateId(),
      name,
      email,
      whatsapp: whatsapp || '',
      passwordHash,
      balance: 0.00,
      apiKey: generateApiKey(),
      isAdmin: email.toLowerCase() === 'isahy061@gmail.com'
    };

    users.push(newUser);

    const { passwordHash: _, ...safeUser } = newUser;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error during signup.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
    
    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Invalid email or password.' });
    }

    const { passwordHash: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error during login.' });
  }
});

app.get('/api/user/:customId', (req, res) => {
  const user = users.find(u => u.customId === req.params.customId);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  const { passwordHash: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

app.put('/api/user/:customId', (req, res) => {
  const { name, whatsapp } = req.body;
  const user = users.find(u => u.customId === req.params.customId);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  if (name) user.name = name;
  if (whatsapp) user.whatsapp = whatsapp;

  const { passwordHash: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// ==================== SMM SERVICES & ORDERS ====================

app.get('/api/services', async (req, res) => {
  try {
    const params = new URLSearchParams();
    params.append('key', SMM_API_KEY);
    params.append('action', 'services');

    const response = await axios.post(SMM_API_URL, params);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch services from provider' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { userId, serviceId, link, quantity } = req.body;
    const user = users.find(u => u.customId === userId);
    
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const servicesParams = new URLSearchParams();
    servicesParams.append('key', SMM_API_KEY);
    servicesParams.append('action', 'services');

    const servicesRes = await axios.post(SMM_API_URL, servicesParams);
    
    const service = servicesRes.data.find(s => (s.service || s.id).toString() === serviceId.toString());
    if (!service) return res.status(400).json({ success: false, error: 'Selected service not found' });

    const baseRate = parseFloat(service.rate || 0);
    const markedUpRate = baseRate * 1.65;
    const totalCost = (markedUpRate / 1000) * parseInt(quantity);

    if (user.balance < totalCost) {
      return res.status(400).json({ success: false, error: 'Insufficient wallet balance. Please top up.' });
    }

    const orderParams = new URLSearchParams();
    orderParams.append('key', SMM_API_KEY);
    orderParams.append('action', 'add');
    orderParams.append('service', serviceId);
    orderParams.append('link', link);
    orderParams.append('quantity', quantity);

    const smmOrderRes = await axios.post(SMM_API_URL, orderParams);

    if (smmOrderRes.data && smmOrderRes.data.order) {
      user.balance -= totalCost;
      const newOrder = {
        orderId: smmOrderRes.data.order.toString(),
        userId: user.customId,
        serviceId,
        link,
        quantity: parseInt(quantity),
        cost: totalCost,
        status: 'Pending',
        createdAt: new Date()
      };
      orders.push(newOrder);
      return res.json({ success: true, order: newOrder });
    } else {
      return res.status(400).json({ success: false, error: smmOrderRes.data.error || 'Provider rejected order' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error processing order' });
  }
});

app.get('/api/orders', (req, res) => {
  const { userId } = req.query;
  const userOrders = orders.filter(o => o.userId === userId).reverse();
  res.json({ success: true, orders: userOrders });
});

// ==================== PAYSTACK PAYMENT VERIFICATION ====================

app.post('/api/payment/verify', async (req, res) => {
  try {
    const { userId, reference } = req.body;
    const user = users.find(u => u.customId === userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const paystackRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
    });

    if (paystackRes.data && paystackRes.data.data && paystackRes.data.data.status === 'success') {
      const amountPaidInNaira = paystackRes.data.data.amount / 100;
      user.balance += amountPaidInNaira;
      return res.json({ success: true, newBalance: user.balance });
    } else {
      return res.status(400).json({ success: false, error: 'Payment verification failed' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error connecting to payment gateway' });
  }
});

// ==================== ADMIN METRICS ====================

app.get('/api/admin/metrics/:customId', (req, res) => {
  const requester = users.find(u => u.customId === req.params.customId);
  if (!requester || !requester.isAdmin) {
    return res.status(403).json({ success: false, error: 'Unauthorized access' });
  }

  const totalRevenue = orders.reduce((acc, curr) => acc + curr.cost, 0);
  res.json({
    success: true,
    metrics: {
      userCount: users.length,
      orderCount: orders.length,
      totalRevenue
    }
  });
});

app.listen(PORT, () => {
  console.log(`DonJaySocial Server running on port ${PORT}`);
});
// Fix Node DNS resolution for MongoDB SRV URIs on Windows
require('dns').setDefaultResultOrder('ipv4first');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- SCHEMAS ---
const userSchema = new mongoose.Schema({
  customId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  whatsapp: { type: String, default: '' },
  password: { type: String, required: true },
  balance: { type: Number, default: 0.00 },
  apiKey: { type: String, required: true, unique: true },
  isAdmin: { type: Boolean, default: false }, // Added to control panel access
  createdAt: { type: Date, default: Date.now }
});

const orderSchema = new mongoose.Schema({
  orderId: String,
  providerOrderId: String,
  userId: String,
  serviceId: Number,
  link: String,
  quantity: Number,
  cost: Number,
  status: { type: String, default: 'In Progress' },
  createdAt: { type: Date, default: Date.now }
});

const depositSchema = new mongoose.Schema({
  depositId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  amount: { type: Number, required: true },
  reference: { type: String, required: true, unique: true },
  status: { type: String, default: 'success' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Order = mongoose.model('Order', orderSchema);
const Deposit = mongoose.model('Deposit', depositSchema);

// Seed default master user on boot (if not already existing)
async function seedDefaultUser() {
  try {
    const existing = await User.findOne({ email: 'admin@donjaysocial.com' });
    if (!existing) {
      const hashedPassword = await bcrypt.hash('password123', 10);
      await User.create({ 
        customId: 'user_1', 
        name: 'Isah', 
        email: 'admin@donjaysocial.com',
        whatsapp: '+2348000000000',
        password: hashedPassword,
        balance: 50.00,
        apiKey: 'djs_key_masteradmin123',
        isAdmin: true // Ensure default master account is admin
      });
      console.log('===> Default master user seeded successfully.');
    }
  } catch (err) {
    console.error('Seeding error:', err.message);
  }
}

// --- MONGOOSE CONNECT ---
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/donjaysocial';

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
})
  .then(() => {
    console.log('Connected to MongoDB 🍃');
    seedDefaultUser();
  })
  .catch((err) => console.error('MongoDB connection error:', err));

const fallbackServices = [
  { service: 101, name: 'Instagram Followers [Real]', category: 'Instagram', rate: 1.50, min: 100, max: 10000 },
  { service: 102, name: 'TikTok Likes [Instant]', category: 'TikTok', rate: 0.80, min: 50, max: 50000 },
  { service: 103, name: 'YouTube Views [High Retention]', category: 'YouTube', rate: 2.20, min: 500, max: 100000 }
];

const MARKUP_FACTOR = 1.30;

// --- ROUTES ---

// 1. Authentication: Sign Up
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, whatsapp, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Please fill in all required fields' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const customId = `user_${Date.now()}`;
    const apiKey = `djs_key_${Math.random().toString(36).substring(2, 11)}${Math.random().toString(36).substring(2, 11)}`;

    const newUser = await User.create({
      customId,
      name,
      email,
      whatsapp: whatsapp || '',
      password: hashedPassword,
      balance: 0.00,
      apiKey,
      isAdmin: false // Regular signups are never admins
    });

    res.json({
      success: true,
      message: 'Account created successfully!',
      user: { 
        customId: newUser.customId, 
        name: newUser.name, 
        email: newUser.email, 
        whatsapp: newUser.whatsapp,
        balance: newUser.balance,
        apiKey: newUser.apiKey,
        isAdmin: newUser.isAdmin
      }
    });

  } catch (err) {
    console.error('Signup Error:', err);
    res.status(500).json({ success: false, error: 'Server error during signup' });
  }
});

// 2. Authentication: Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide email and password' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Invalid email or password' });
    }

    res.json({
      success: true,
      message: 'Logged in successfully!',
      user: { 
        customId: user.customId, 
        name: user.name, 
        email: user.email, 
        whatsapp: user.whatsapp,
        balance: user.balance,
        apiKey: user.apiKey,
        isAdmin: user.isAdmin // Passed to client to conditionally render admin panel
      }
    });

  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, error: 'Server error during login' });
  }
});

// 3. User profile details fetch & update
app.get('/api/user/:id', async (req, res) => {
  try {
    const user = await User.findOne({ customId: req.params.id });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ 
      success: true, 
      user: { 
        customId: user.customId, 
        name: user.name, 
        email: user.email, 
        whatsapp: user.whatsapp,
        balance: user.balance,
        apiKey: user.apiKey,
        isAdmin: user.isAdmin
      } 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/user/:id', async (req, res) => {
  try {
    const { name, whatsapp } = req.body;
    const user = await User.findOne({ customId: req.params.id });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    if (name) user.name = name;
    if (whatsapp !== undefined) user.whatsapp = whatsapp;
    await user.save();

    res.json({ 
      success: true, 
      message: 'Profile updated successfully',
      user: { 
        customId: user.customId, 
        name: user.name, 
        email: user.email, 
        whatsapp: user.whatsapp,
        balance: user.balance,
        apiKey: user.apiKey,
        isAdmin: user.isAdmin
      } 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3b. Admin metrics and security check route
app.get('/api/admin/metrics/:id', async (req, res) => {
  try {
    const user = await User.findOne({ customId: req.params.id });
    // Strictly verify if the user exists and has admin privileges
    if (!user || !user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Unauthorized access. Admins only.' });
    }

    const userCount = await User.countDocuments();
    const pendingDepositsCount = await Deposit.countDocuments({ status: 'pending' });
    const allDeposits = await Deposit.find({ status: 'success' });
    const totalRevenue = allDeposits.reduce((acc, curr) => acc + curr.amount, 0);

    res.json({ 
      success: true, 
      metrics: {
        userCount,
        pendingDepositsCount,
        totalRevenue
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Fetch services
app.get('/api/services', async (req, res) => {
  try {
    let rawServices = fallbackServices;

    if (process.env.PROVIDER_API_URL && process.env.PROVIDER_API_KEY && process.env.PROVIDER_API_KEY !== 'your_actual_provider_api_key_here') {
      const response = await axios.post(process.env.PROVIDER_API_URL, new URLSearchParams({
        key: process.env.PROVIDER_API_KEY,
        action: 'services'
      }));
      if (Array.isArray(response.data)) rawServices = response.data;
    }

    const servicesWithMarkup = rawServices.map((svc) => {
      const computedRate = (parseFloat(svc.rate || 0) * MARKUP_FACTOR).toFixed(2);
      return {
        service: svc.service || svc.id,
        id: svc.service || svc.id,
        name: svc.name,
        category: svc.category || 'General',
        rate: computedRate,
        pricePerThousand: computedRate,
        min: svc.min || 0,
        max: svc.max || 0
      };
    });

    res.json(servicesWithMarkup);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch services' });
  }
});

// 5. Place Order (MongoDB)
app.post('/api/orders', async (req, res) => {
  try {
    const { userId, serviceId, link, quantity } = req.body;

    if (!userId || !serviceId || !link || !quantity) {
      return res.status(400).json({ success: false, error: 'Missing required order fields' });
    }

    const user = await User.findOne({ customId: userId });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    let rawServices = fallbackServices;
    if (process.env.PROVIDER_API_URL && process.env.PROVIDER_API_KEY && process.env.PROVIDER_API_KEY !== 'your_actual_provider_api_key_here') {
      const response = await axios.post(process.env.PROVIDER_API_URL, new URLSearchParams({
        key: process.env.PROVIDER_API_KEY,
        action: 'services'
      }));
      if (Array.isArray(response.data)) rawServices = response.data;
    }

    const selectedService = rawServices.find(s => (s.service || s.id) == serviceId);
    if (!selectedService) {
      return res.status(400).json({ success: false, error: 'Invalid service selected' });
    }

    const providerRate = parseFloat(selectedService.rate || 0);
    const pricePerThousand = providerRate * MARKUP_FACTOR;
    const totalCost = parseFloat(((pricePerThousand * quantity) / 1000).toFixed(2));

    if (user.balance < totalCost) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient balance. Required: ₦${totalCost}, Available: ₦${user.balance}` 
      });
    }

    let providerOrderId = `MOCK-${Date.now()}`;

    if (process.env.PROVIDER_API_URL && process.env.PROVIDER_API_KEY && process.env.PROVIDER_API_KEY !== 'your_actual_provider_api_key_here') {
      const providerRes = await axios.post(process.env.PROVIDER_API_URL, new URLSearchParams({
        key: process.env.PROVIDER_API_KEY,
        action: 'add',
        service: serviceId,
        link,
        quantity
      }));

      if (providerRes.data?.order) {
        providerOrderId = providerRes.data.order;
      } else if (providerRes.data?.error) {
        return res.status(400).json({ success: false, error: `Provider Error: ${providerRes.data.error}` });
      }
    }

    user.balance = parseFloat((user.balance - totalCost).toFixed(2));
    await user.save();

    const newOrder = await Order.create({
      orderId: `ORD-${Date.now()}`,
      providerOrderId,
      userId,
      serviceId,
      link,
      quantity,
      cost: totalCost,
      status: 'In Progress'
    });

    res.json({
      success: true,
      message: 'Order placed and saved to DB!',
      order: newOrder,
      remainingBalance: user.balance
    });

  } catch (error) {
    console.error('Order Error:', error);
    res.status(500).json({ success: false, error: 'Error processing order' });
  }
});

// 6. Fetch orders from DB (Supports filtering by userId query param)
app.get('/api/orders', async (req, res) => {
  try {
    const { userId } = req.query;
    const filter = userId ? { userId } : {};
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Verify Paystack Payment and Credit Wallet (Direct NGN)
app.post('/api/payment/verify', async (req, res) => {
  const { reference, userId } = req.body;

  if (!reference) {
    return res.status(400).json({ success: false, error: 'Transaction reference is required' });
  }

  if (!userId) {
    return res.status(400).json({ success: false, error: 'User ID is required to credit wallet' });
  }

  try {
    const paystackResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const transactionData = paystackResponse.data;

    if (transactionData.status && transactionData.data.status === 'success') {
      const amountPaidNGN = transactionData.data.amount / 100; 

      const user = await User.findOne({ customId: userId });

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found for crediting wallet' });
      }

      // Check if reference was already processed to prevent duplicate crediting
      const existingDeposit = await Deposit.findOne({ reference });
      if (existingDeposit) {
        return res.status(400).json({ success: false, error: 'Transaction reference already used' });
      }

      user.balance = parseFloat((user.balance + amountPaidNGN).toFixed(2));
      await user.save();

      // Record deposit history
      await Deposit.create({
        depositId: `DEP-${Date.now()}`,
        userId,
        amount: amountPaidNGN,
        reference,
        status: 'success'
      });

      return res.json({
        success: true,
        message: 'Payment verified and wallet credited successfully',
        amountCredited: amountPaidNGN,
        newBalance: user.balance
      });
    } else {
      return res.status(400).json({ success: false, error: 'Transaction was not successful' });
    }

  } catch (err) {
    console.error('Paystack Verification Error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'Server error during payment verification' });
  }
});

// 7b. Submit manual payment proof
app.post('/api/payments/manual', async (req, res) => {
  try {
    const { userId, method, amount, reference } = req.body;
    if (!userId || !method || !amount || !reference) {
      return res.status(400).json({ success: false, error: 'All manual deposit fields are required' });
    }

    const existingDeposit = await Deposit.findOne({ reference });
    if (existingDeposit) {
      return res.status(400).json({ success: false, error: 'Reference or hash already submitted' });
    }

    await Deposit.create({
      depositId: `DEP-MANUAL-${Date.now()}`,
      userId,
      amount: parseFloat(amount) || 0,
      reference: `${method} - ${reference}`,
      status: 'pending'
    });

    res.json({ success: true, message: 'Manual payment proof submitted successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Fetch user deposit history from DB
app.get('/api/payments/:userId', async (req, res) => {
  try {
    const payments = await Deposit.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Check Order Status from Provider API
app.get('/api/orders/status/:orderId', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    if (!order.providerOrderId || order.providerOrderId.startsWith('MOCK-')) {
      return res.json({ success: true, status: order.status });
    }

    if (process.env.PROVIDER_API_URL && process.env.PROVIDER_API_KEY) {
      const response = await axios.post(process.env.PROVIDER_API_URL, new URLSearchParams({
        key: process.env.PROVIDER_API_KEY,
        action: 'status',
        order: order.providerOrderId
      }));

      if (response.data && response.data.status) {
        order.status = response.data.status;
        await order.save();
      }
    }

    res.json({ success: true, status: order.status, order });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to check order status' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
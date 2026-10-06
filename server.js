require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const { startPhaseDeadlineScheduler } = require('./services/phaseDeadlineScheduler');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Middleware
const allowedOrigins = [
  'https://goals-frontend-rosy.vercel.app',
  'https://goals-frontend-mzhawki6i-divyas-projects-4af8f9ad.vercel.app',
  'http://localhost:8080',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients or requests without origin
    if (!origin) return callback(null, true);
    // Allow configured origins
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow any Vercel deployment preview / subdomain
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    // Reject other origins gracefully without throwing an uncaught error
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Body parser
app.use(express.json());

// MongoDB connection handling for serverless & long-running instances
let cachedDbPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  if (!cachedDbPromise) {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error('MONGO_URI is not set in environment variables');
    }
    cachedDbPromise = mongoose.connect(uri, {
      bufferCommands: false,
    });
  }
  await cachedDbPromise;
  return mongoose.connection;
};

// Ensure DB is connected for API requests
app.use(async (req, res, next) => {
  if (req.path === '/' || req.path === '/health') {
    return next();
  }
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Database connection error:', err.message);
    return res.status(500).json({
      error: 'Database connection failed',
      details: err.message
    });
  }
});

// Root & Health routes
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Goals Backend API is live!', status: 'OK' });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    dbState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Routes
app.use('/api/auth', authRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Start persistent server in local development
if (!process.env.VERCEL) {
  connectDB().then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      startPhaseDeadlineScheduler();
    });
  }).catch((err) => {
    console.error('MongoDB connection error on startup:', err.message);
  });
}

module.exports = app;

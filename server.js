require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const { startPhaseDeadlineScheduler } = require('./services/phaseDeadlineScheduler');

const app = express();
const PORT = process.env.PORT || 5001;

// CORS Configuration
const allowedOrigins = [
  'https://goals-frontend-rosy.vercel.app',
  'https://goals-frontend-mzhawki6i-divyas-projects-4af8f9ad.vercel.app',
  'http://localhost:8080',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5001'
];

if (process.env.FRONTEND_URL) {
  const cleanFrontendUrl = process.env.FRONTEND_URL.replace(/\/+$/, '');
  if (!allowedOrigins.includes(cleanFrontendUrl)) {
    allowedOrigins.push(cleanFrontendUrl);
  }
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients or requests without origin (curl, postman, server-to-server)
    if (!origin) return callback(null, true);

    // Allow configured origins
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // Allow any localhost or 127.0.0.1 on any port for local development
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // Allow any Vercel deployment preview or production domain
    if (/^https:\/\/([a-zA-Z0-9-]+\.)*vercel\.app$/.test(origin)) {
      return callback(null, true);
    }

    // Reject other origins gracefully without throwing an uncaught error
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Body parser
app.use(express.json());

// MongoDB connection handling for serverless & long-running instances
let cachedDbPromise = null;

const connectDB = async () => {
  // Return existing active connection
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // If currently connecting, wait for that promise
  if (mongoose.connection.readyState === 2 && cachedDbPromise) {
    await cachedDbPromise;
    return mongoose.connection;
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in environment variables');
  }

  // Clear previous failed/stale promise and initiate connection
  cachedDbPromise = mongoose.connect(uri)
    .catch((err) => {
      cachedDbPromise = null;
      throw err;
    });

  await cachedDbPromise;
  return mongoose.connection;
};

// Ensure DB is connected for API requests
app.use(async (req, res, next) => {
  // Skip DB check for OPTIONS preflight and basic health checks
  if (
    req.method === 'OPTIONS' ||
    req.path === '/' ||
    req.path === '/api' ||
    req.path === '/health' ||
    req.path === '/api/health'
  ) {
    return next();
  }

  try {
    await connectDB();
  } catch (err) {
    console.error('Database connection error:', err.message);
    return res.status(500).json({
      error: 'Database connection failed',
      details: err.message
    });
  }

  next();
});

// Root & Health routes
app.get(['/', '/api'], (req, res) => {
  res.status(200).json({ message: 'Goals Backend API is live!', status: 'OK' });
});

app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'OK',
    dbState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Routes - support both /api/auth (frontend convention) and /api (standard REST convention)
app.use('/api/auth', authRoutes);
app.use('/api', authRoutes);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl || req.url}`
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error('Unhandled server error:', err);
  res.status(err.status || err.statusCode || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Start persistent server in local development
if (!process.env.VERCEL) {
  const server = app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    try {
      await connectDB();
      console.log('Connected to MongoDB');
      startPhaseDeadlineScheduler();
    } catch (err) {
      console.error('MongoDB connection error on startup:', err.message);
      console.log('Server is running, but database connection could not be established immediately. Requests requiring DB will attempt to reconnect.');
    }
  });

  const gracefulShutdown = async () => {
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        console.log('MongoDB connection closed.');
      }
      server.close(() => {
        process.exit(0);
      });
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

module.exports = app;


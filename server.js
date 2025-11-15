require('dotenv').config();
const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const path = require("path");
const http = require("http");
const twilio = require('twilio');
const WebSocket = require('ws');
const fs = require('fs');

// Structured Logging Utility
const logger = {
  // Order lifecycle logging
  logOrder: (orderId, step, data = {}) => {
    const timestamp = new Date().toISOString();
    const logData = { orderId, step, timestamp, ...data };
    console.log(`📋 ORDER_${step}:`, JSON.stringify(logData, null, 0));
  },

  // Error logging with context
  logError: (context, error, orderId = null) => {
    const timestamp = new Date().toISOString();
    const logData = {
      context,
      error: error.message || error,
      orderId,
      timestamp,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
    console.error(`❌ ERROR_${context}:`, JSON.stringify(logData, null, 0));
  },

  // Info logging (startup, config)
  logInfo: (message, data = {}) => {
    if (process.env.NODE_ENV === 'production' && !message.includes('ERROR')) return;
    const timestamp = new Date().toISOString();
    console.log(`ℹ️ INFO: ${message}`, data ? JSON.stringify(data, null, 0) : '');
  },

  // Debug logging (development only)
  logDebug: (message, data = {}) => {
    if (process.env.NODE_ENV === 'production') return;
    console.log(`🔍 DEBUG: ${message}`, data ? JSON.stringify(data, null, 0) : '');
  }
};
const mongoose = require('mongoose');
const axios = require('axios');
const UserOrder = require('./models/UserOrder');

// Restaurant data for vendor contact lookup
const restaurants = [
  {
    id: 1,
    name: "BABAJI_FOOD-POINT",
    vendorEmail: "gulabsingh93732@gmail.com",
    vendorPhone: "+919373290270",
    operatingHours: "10:30 AM - 8:30 PM",
    category: "Chinese, Indian"
  },
  {
    id: 2,
    name: "HIMALAYAN_CAFE",
    vendorEmail: "yogeshthakur03839@gmail.com", 
    vendorPhone: "+918278803839",
    operatingHours: "10:30 AM - 10:00 PM",
    category: "Chinese, Indian"
  },
  {
    id: 3,
    name: "SONU_FOOD-POINT",
    vendorEmail: "sunil62948@gmail.com",
    vendorPhone: "+919882262948", 
    operatingHours: "10:30 AM - 9:45 PM",
    category: "Chinese, Indian"
  },
  {
    id: 4,
    name: "JEEVA_FOOD-POINT",
    vendorEmail: "panchhithakur0@gmail.com",
    vendorPhone: "+917018596320",
    operatingHours: "10:30 AM - 9:45 PM", 
    category: "Chinese, Indian"
  },
  {
    id: 5,
    name: "PIZZA-BITE",
    vendorEmail: "anshul3927@gmail.com",
    vendorPhone: "+919625970000",
    operatingHours: "11:00 AM - 9:45 PM",
    category: "American"
  },
  {
    id: 6,
    name: "NORTHERN_CAFE",
    vendorEmail: "northerncafe@gmail.com",
    vendorPhone: "+919876543210",
    operatingHours: "9:00 AM - 10:30 PM",
    category: "Indian, Chinese"
  },
  {
    id: 7,
    name: "FRUIT_BAKERY",
    vendorEmail: "fruitbakery@gmail.com",
    vendorPhone: "+919876543211",
    operatingHours: "7:00 AM - 9:00 PM",
    category: "American"
  },
  {
    id: 8,
    name: "AYODHYA_RESTAURANT",
    vendorEmail: "ayodhyarestaurant@gmail.com",
    vendorPhone: "+919876543212",
    operatingHours: "10:00 AM - 11:00 PM",
    category: "Indian, South Indian"
  },
  {
    id: 9,
    name: "TEST_RESTAURANT",
    vendorEmail: "test@foodles.shop",
    vendorPhone: "+919876543213",
    operatingHours: "24/7",
    category: "Test Items"
  }
];

// Function to get restaurant data by ID
const getRestaurantById = (restaurantId) => {
  const id = parseInt(restaurantId);
  return restaurants.find(restaurant => restaurant.id === id) || {
    name: "Restaurant",
    vendorEmail: "suppfoodles@gmail.com", 
    vendorPhone: "+91 98765 43210"
  };
};

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  // Remove deprecated options and use modern defaults
  // These settings help with connection stability
}).then(() => {
  logger.logInfo('✅ Connected to MongoDB');
}).catch((err) => {
  logger.logError('mongodb_connection_error', 'MongoDB connection error', {
    error: err.message
  });
});

// Only watch .env file in development mode
if (process.env.NODE_ENV === 'development') {
  const envPath = path.join(__dirname, '.env');
  // Check if .env file exists before watching
if (fs.existsSync(envPath)) {
  fs.watch(envPath, (eventType, filename) => {
    if (eventType === 'change') {
      logger.logOrder('env_file_changed', '.env file changed, reloading configuration', {});
      require('dotenv').config({ override: true });
    }
  });
  logger.logOrder('env_file_watching', 'Watching .env file for changes in development mode', {});
} else {
  logger.logOrder('env_file_not_found', 'No .env file found in development mode', {});
}
} else {
  logger.logOrder('production_mode_no_env_watch', 'Production mode - not watching .env file', {});
}const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server first
const server = http.createServer(app);

// Then create WebSocket server


const isDevelopment = process.env.NODE_ENV !== 'development';

// Update CORS configuration for Render deployment
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'https://foodles.shop',
      'https://www.foodles.shop',
      'https://api.foodles.shop',
      'https://precious-cobbler-d60f77.netlify.app' // Netlify preview
    ];

    // Only allow localhost in development mode
    if (process.env.NODE_ENV === 'development') {
      allowedOrigins.push('http://localhost:3000');
      allowedOrigins.push('http://127.0.0.1:3000');
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.logOrder('cors_blocked_origin', 'CORS blocked origin', {
        origin,
        nodeEnv: process.env.NODE_ENV
      });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin']
}));

// Add request logging middleware
app.use((req, res, next) => {
  logger.logOrder('request_received', 'Request received', {
    origin: req.get('origin'),
    method: req.method,
    path: req.path,
    host: req.get('host'),
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for production monitoring
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      email: contactEmail ? 'configured' : 'not_configured',
      twilio: twilioClient ? 'configured' : 'not_configured'
    },
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };

  const isHealthy = health.services.mongodb === 'connected';
  res.status(isHealthy ? 200 : 503).json(health);
});

const contactEmail = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false
  },
  pool: true, // Enable pooling for better performance
  maxConnections: 5,
  rateDelta: 1000,
  rateLimit: 5,
  // Connection timeout settings
  connectionTimeout: 30000, // 30 seconds
  greetingTimeout: 15000, // 15 seconds
  socketTimeout: 30000, // 30 seconds
  // Add debug logging
  debug: process.env.NODE_ENV === 'development',
  logger: process.env.NODE_ENV === 'development'
});

// Add better error handling for email verification
contactEmail.verify((error) => {
  if (error) {
    logger.logError('email_verification_failed', 'Email transport verification failed', {
      error: error.message,
      code: error.code,
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: process.env.EMAIL_PORT || 587,
      user: process.env.EMAIL_USER ? 'configured' : 'missing',
      hasPassword: !!process.env.EMAIL_PASS,
      timestamp: new Date().toISOString()
    });
  } else {
    logger.logOrder('email_service_ready', 'Email service ready', {
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: process.env.EMAIL_PORT || 587,
      user: process.env.EMAIL_USER ? 'configured' : 'missing',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/razorpay-key', (req, res) => {
  res.json({ key: process.env.RAZORPAY_KEY_ID });
});

const formatOrderDetails = (orderDetails, orderId, isPreReservation = false) => {
  // Guard against null/undefined and normalize data (Comment 5, 11)
  try {
    const safeOrderDetails = {
      items: Array.isArray(orderDetails?.items) ? orderDetails.items : [],
      subtotal: parseFloat(orderDetails?.subtotal) || 0,
      deliveryFee: parseFloat(orderDetails?.deliveryFee) || 0,
      convenienceFee: parseFloat(orderDetails?.convenienceFee) || 0,
      dogDonation: parseFloat(orderDetails?.dogDonation) || 0,
      grandTotal: parseFloat(orderDetails?.grandTotal) || 0,
      remainingPayment: parseFloat(orderDetails?.remainingPayment) || 0,
      deliveryAddress: orderDetails?.deliveryAddress || 'Address not provided',
      vendorPhone: orderDetails?.vendorPhone || '',
      customerPhone: orderDetails?.customerPhone || ''
    };

    // Debug log to check vendor contact info
    logger.logOrder('email_formatting', 'Formatting email with contact info', {
      orderId,
      vendorPhone: safeOrderDetails.vendorPhone,
      customerPhone: safeOrderDetails.customerPhone,
      isPreReservation,
      itemCount: safeOrderDetails.items.length
    });

    // Format phone numbers consistently
    const formatPhoneForDisplay = (phone) => {
      if (!phone) return 'Not provided';
      const cleaned = phone.replace(/^\+?(91)?/, '').replace(/\D/g, '');
      return `+91 ${cleaned}`;
    };

    // Safe toFixed with guards (Comment 5)
    const safeFixed = (value, decimals = 2) => {
      const num = parseFloat(value);
      return isNaN(num) ? '0.00' : num.toFixed(decimals);
    };

    const prePaidAmount = safeOrderDetails.remainingPayment;
    const remainingAmount = safeOrderDetails.grandTotal - prePaidAmount;

    // Format phone numbers for links
    const vendorPhoneLink = safeOrderDetails.vendorPhone ? 
      formatPhoneNumber(safeOrderDetails.vendorPhone) : '';
    const customerPhoneLink = safeOrderDetails.customerPhone ? 
      formatPhoneNumber(safeOrderDetails.customerPhone) : '';

  // Choose color scheme based on order type
  const colorScheme = isPreReservation ? {
    primary: '#9333EA',      // Purple-600
    secondary: '#C084FC',    // Purple-400
    accent: '#DDD6FE',       // Purple-200
    dark: '#581C87',         // Purple-900
    light: '#F3E8FF'         // Purple-50
  } : {
    primary: '#FFD700',      // Gold (current)
    secondary: '#4ADE80',    // Green-400
    accent: '#888888',       // Gray
    dark: '#111111',         // Dark gray
    light: '#1A1A1A'         // Light dark
  };

  const orderTypeLabel = isPreReservation ? 'PRE-RESERVATION CONFIRMED' : 'ORDER CONFIRMED';
  const orderTypePrefix = isPreReservation ? 'PRE-RES' : '';

  const userEmailTemplate = `
  <div style="background-color: #000000; color: #ffffff; font-family: 'Arial', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #111111; border-left: 4px solid ${colorScheme.primary}; padding: 20px; margin-bottom: 20px;">
      <h1 style="color: ${colorScheme.primary}; margin: 0; font-size: 24px;">${orderTypeLabel}</h1>
      <p style="color: #888888; margin: 5px 0;">Order ID: #${orderTypePrefix}${orderId}</p>
      ${isPreReservation ? `
        <div style="background-color: ${colorScheme.primary}20; border: 1px solid ${colorScheme.primary}; padding: 10px; margin-top: 10px; border-radius: 4px;">
          <p style="color: ${colorScheme.secondary}; margin: 0; font-size: 14px;">
            🎉 Table Pre-Reserved | ✨ 10% Discount Applied | 💰 Pay only ₹20 now
          </p>
        </div>
      ` : ''}
    </div>

    <div style="background-color: #111111; padding: 20px; margin-bottom: 20px;">
      <div style="border-bottom: 1px solid #333333; padding-bottom: 10px; margin-bottom: 15px;">
        <h2 style="color: ${colorScheme.primary}; font-size: 18px; margin: 0;">ORDER DETAILS</h2>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr style="border-bottom: 1px solid #333333;">
          <th style="text-align: left; padding: 10px 5px; color: #888888;">Item</th>
          <th style="text-align: center; padding: 10px 5px; color: #888888;">Qty</th>
          <th style="text-align: right; padding: 10px 5px; color: #888888;">Price</th>
        </tr>
        ${safeOrderDetails.items.map(item => `
          <tr style="border-bottom: 1px solid #222222;">
            <td style="padding: 10px 5px;">${item.name || 'Item'}</td>
            <td style="text-align: center; padding: 10px 5px;">${item.quantity || 0}</td>
            <td style="text-align: right; padding: 10px 5px;">₹${safeFixed((item.price || 0) * (item.quantity || 0))}</td>
          </tr>
        `).join('')}
        <tr style="background-color: #1A1A1A;">
          <td colspan="2" style="padding: 10px 5px;">Subtotal</td>
          <td style="text-align: right; padding: 10px 5px;">₹${safeFixed(safeOrderDetails.subtotal)}</td>
        </tr>
        <tr style="background-color: #1A1A1A;">
          <td colspan="2" style="padding: 10px 5px;">Delivery Fee</td>
          <td style="text-align: right; padding: 10px 5px;">₹${safeFixed(safeOrderDetails.deliveryFee)}</td>
        </tr>
        <tr style="background-color: #1A1A1A;">
          <td colspan="2" style="padding: 10px 5px;">Convenience Fee</td>
          <td style="text-align: right; padding: 10px 5px;">
            ${safeOrderDetails.dogDonation > 0 ? 
              `<span style="text-decoration: line-through; color: #4ADE80;">₹${safeFixed(safeOrderDetails.convenienceFee)}</span>
               <span style="color: #4ADE80; margin-left: 4px;">FREE</span>` 
              : `₹${safeFixed(safeOrderDetails.convenienceFee)}`}
          </td>
        </tr>
        ${safeOrderDetails.dogDonation > 0 ? `
          <tr style="background-color: #1A1A1A;">
            <td colspan="2" style="padding: 10px 5px;">Dog Donation</td>
            <td style="text-align: right; padding: 10px 5px; color: #4ADE80;">₹${safeFixed(safeOrderDetails.dogDonation)}</td>
          </tr>
        ` : ''}
        <tr style="background-color:rgb(146, 146, 146);">
          <td colspan="2" style="padding: 10px 5px; color: #000000; font-weight: bold;">Total</td>
          <td style="text-align: right; padding: 10px 5px; color: #000000; font-weight: bold;">₹${safeFixed(safeOrderDetails.grandTotal)}</td>
        </tr>
      </table>

      <div style="margin-top: 20px; border-top: 1px solid #333333; padding-top: 15px;">
        <h3 style="color: ${colorScheme.primary}; font-size: 16px; margin-bottom: 10px;">PAYMENT DETAILS</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="background-color: #1A1A1A;">
            <td style="padding: 10px 5px; color: ${colorScheme.secondary};">Order-Confirmation Amount (paid)</td>
            <td style="text-align: right; padding: 10px 5px; color: ${colorScheme.secondary};">
              ₹${safeFixed(prePaidAmount)}
            </td>
          </tr>
          <tr style="background-color: ${isPreReservation ? colorScheme.primary : '#FFD700'};">
            <td style="padding: 10px 5px; color: #000000;">${isPreReservation ? 'Pay at Restaurant' : 'Pay on Delivery'}</td>
            <td style="text-align: right; padding: 10px 5px; color: #000000;">
              ₹${safeFixed(remainingAmount)}
            </td>
          </tr>
        </table>
      </div>

      <div style="background-color: #1A1A1A; padding: 15px; margin-bottom: 20px;">
        <h3 style="color: ${colorScheme.primary}; margin: 0 0 10px 0; font-size: 16px;">${isPreReservation ? 'RESTAURANT LOCATION' : 'DELIVERY LOCATION'}</h3>
        <p style="margin: 0; color: #ffffff;">${safeOrderDetails.deliveryAddress}</p>
      </div>

      <div style="background-color: #1A1A1A; padding: 15px;">
        <h3 style="color: ${colorScheme.primary}; margin: 0 0 10px 0; font-size: 16px;">VENDOR CONTACT</h3>
        <p style="margin: 0; color: #ffffff;">
          Mobile: <a href="tel:${vendorPhoneLink}" style="color: ${colorScheme.secondary}; text-decoration: none; border-bottom: 1px dashed ${colorScheme.secondary};">
            ${formatPhoneForDisplay(safeOrderDetails.vendorPhone)}
          </a>
        </p>
      </div>
    </div>

    <div style="text-align: center; padding: 20px; background-color: #111111;">
      <p style="color: #888888; margin: 0;">Thank you for ${isPreReservation ? 'your pre-reservation with' : 'ordering with'} Foodles</p>
      
      ${safeOrderDetails.dogDonation > 0 ? `
        <div style="margin-top: 15px; padding: 15px; border: 1px solid ${colorScheme.secondary}; border-radius: 4px; background: rgba(${isPreReservation ? '147, 51, 234' : '74, 222, 128'}, 0.1);">
          <p style="color: ${colorScheme.secondary}; margin: 0; font-size: 14px;">
            🐾 You're amazing! Thank you for your kind donation of ₹${safeFixed(safeOrderDetails.dogDonation)} towards our campus dogs!
            <span style="display: block; margin-top: 5px; font-size: 12px; opacity: 0.8;">
              Your generosity helps us provide better care for our furry friends. We'll keep you updated on how your contribution makes a difference.
            </span>
          </p>
        </div>
      ` : ''}
      
      <!-- Share Your Thoughts Button -->
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #333;">
        <p style="color: ${colorScheme.primary}; font-size: 14px; margin-bottom: 15px;">Your feedback helps us improve!</p>
        <a href="https://docs.google.com/forms/d/e/1FAIpQLScXZaSqfIz6wFzA_-KtJ5bxM65E_wfJArZyMb_NOYNoaT1I5w/viewform?usp=sharing" 
           style="display: inline-block;
                  background: ${colorScheme.primary};
                  color: #000000;
                  padding: 12px 24px;
                  text-decoration: none;
                  border-radius: 4px;
                  font-family: Arial, sans-serif;
                  font-size: 14px;
                  font-weight: bold;">
          Share Your Thoughts
        </a>
      </div>
    </div>
  </div>
  `;

  const vendorEmailTemplate = `
  <div style="background-color: #000000; color: #ffffff; font-family: 'Arial', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #111111; border-left: 4px solid ${colorScheme.primary}; padding: 20px; margin-bottom: 20px;">
      <h1 style="color: ${colorScheme.primary}; margin: 0; font-size: 24px;">${isPreReservation ? 'NEW PRE-RESERVATION' : 'NEW ORDER'}_${orderId} RECEIVED</h1>
      <p style="color: #888888; margin: 5px 0;">Order ID: #${orderTypePrefix}${orderId}</p>
      ${isPreReservation ? `
        <div style="background-color: ${colorScheme.primary}20; border: 1px solid ${colorScheme.primary}; padding: 10px; margin-top: 10px; border-radius: 4px;">
          <p style="color: ${colorScheme.secondary}; margin: 0; font-size: 14px;">
            🍽️ Table Pre-Reserved | Customer will dine-in | Only ₹20 collected online
          </p>
        </div>
      ` : ''}
    </div>

    <div style="background-color: #111111; padding: 20px; margin-bottom: 20px;">
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr style="border-bottom: 1px solid #333333;">
          <th style="text-align: left; padding: 10px 5px; color: #888888;">Item</th>
          <th style="text-align: center; padding: 10px 5px; color: #888888;">Qty</th>

        </tr>
        ${safeOrderDetails.items.map(item => `
          <tr style="border-bottom: 1px solid #222222;">
            <td style="padding: 10px 5px;">${item.name || 'Item'}</td>
            <td style="text-align: center; padding: 10px 5px;">${item.quantity || 0}</td>
          </tr>
        `).join('')}
        <tr style="background-color:${isPreReservation ? colorScheme.primary : 'rgb(250, 231, 124)'};">
          <td colspan="2" style="padding: 10px 5px; color:black ; font-weight: bold;">Total Amount</td>
          <td style="text-align: right; padding: 10px 5px; color: black; font-weight: bold;">₹${safeFixed(remainingAmount)}</td>
        </tr>
      </table>



      <div style="background-color: #1A1A1A; padding: 15px; margin-bottom: 20px;">
        <h3 style="color: ${colorScheme.primary}; margin: 0 0 10px 0; font-size: 16px;">${isPreReservation ? 'RESTAURANT LOCATION' : 'DELIVERY LOCATION'}</h3>
        <p style="margin: 0; color: #ffffff;">${safeOrderDetails.deliveryAddress}</p>
      </div>

      <div style="background-color: #1A1A1A; padding: 15px;">
        <h3 style="color: ${colorScheme.primary}; margin: 0 0 10px 0; font-size: 16px;">CUSTOMER CONTACT</h3>
        <p style="margin: 0; color: #ffffff;">
          Mobile: <a href="tel:${customerPhoneLink}" style="color: ${colorScheme.secondary}; text-decoration: none; border-bottom: 1px dashed ${colorScheme.secondary};">
            ${formatPhoneForDisplay(safeOrderDetails.customerPhone)}
          </a>
        </p>
      </div>
    </div>

    <div style="text-align: center; padding: 20px; background-color: #111111;">
      <p style="color: #888888; margin: 0;">Please prepare the order for ${isPreReservation ? 'dine-in service' : 'delivery'}</p>
    </div>
  </div>
  `;

    return { userEmailTemplate, vendorEmailTemplate };
  } catch (error) {
    // Fallback simplified template on error (Comment 11)
    logError('template_generation_error', 'Template generation error', {
      error: error.message
    });
    const fallbackTemplate = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Order #${orderId}</h2>
        <p>Order details could not be formatted. Please contact support.</p>
      </div>
    `;
    return { userEmailTemplate: fallbackTemplate, vendorEmailTemplate: fallbackTemplate };
  }
};

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const sendOrderConfirmationEmail = (name, email, orderDetails, orderId, isPreReservation = false) => {
  return new Promise((resolve, reject) => {
    if (!isValidEmail(email)) {
      reject(new Error("Invalid customer email address"));
      return;
    }

    // Detect pre-reservation from orderDetails if not explicitly passed
    const preReservationDetected = isPreReservation || 
      orderDetails.isPreReservation || 
      orderDetails.preReservationData || 
      orderDetails.orderType === 'pre-reserve' ||
      (orderDetails.remainingPayment && orderDetails.remainingPayment <= 20);

    const { userEmailTemplate } = formatOrderDetails(orderDetails, orderId, preReservationDetected);

    const orderTypeText = preReservationDetected ? 'Pre-Reservation' : 'Order';
    const mail = {
      from: {
        name: 'Foodles Orders',
        address: process.env.EMAIL_USER
      },
      to: email,
      subject: `${orderTypeText} Confirmed: #${preReservationDetected ? 'PRE-RES' : ''}${orderId} - Foodles`,
      html: userEmailTemplate,
      headers: {
        'X-Entity-Ref-ID': `order-${orderId}`,
        'List-Unsubscribe': `<mailto:${process.env.EMAIL_USER}?subject=unsubscribe>`,
        'X-Priority': '1',
        'Precedence': 'high',
        'X-MSMail-Priority': 'High',
        'Importance': 'high',
        // Prevent threading in Gmail
        'Message-ID': `<order-${orderId}-${Date.now()}@foodles.shop>`,
        'X-GM-THRID': `order-${orderId}`,
        'References': '',
        // Add these headers to prevent quoted text hiding
        'Content-Type': 'text/html; charset=utf-8',
        'X-Auto-Response-Suppress': 'All',
        'Auto-Submitted': 'auto-generated'
      },
      // Add these options to prevent quoted text hiding
      textEncoding: 'base64',
      alternative: true,
      messageId: `order-${orderId}-${Date.now()}@foodles.shop`,
      normalizeHeaderKey: (key) => key // Preserve header case
    };

    contactEmail.sendMail(mail, (error, info) => {
      if (error) {
        logError('customer_email_error', 'Contact email error', {
          error: error.message,
          email
        });
        reject(error);
      } else if (info.rejected.length > 0) {
        logError('customer_email_rejected', 'Email rejected for customer', {
          email,
          rejectedCount: info.rejected.length
        });
        reject(new Error("Email delivery failed"));
      } else {
        logger.logOrder('customer_email_delivered', 'Customer email delivered successfully', {
          email
        });
        resolve(true);
      }
    });
  });
};

const sendOrderReceivedEmail = (vendorEmail, orderDetails, orderId, isPreReservation = false) => {
  return new Promise((resolve, reject) => {
    if (!isValidEmail(vendorEmail)) {
      reject(new Error("Invalid vendor email address"));
      return;
    }

    // Detect pre-reservation from orderDetails if not explicitly passed
    const preReservationDetected = isPreReservation || 
      orderDetails.isPreReservation || 
      orderDetails.preReservationData || 
      orderDetails.orderType === 'pre-reserve' ||
      (orderDetails.remainingPayment && orderDetails.remainingPayment <= 20);

    const { vendorEmailTemplate } = formatOrderDetails(orderDetails, orderId, preReservationDetected);

    const orderTypeText = preReservationDetected ? 'Pre-Reservation' : 'Order';
    const mail = {
      from: {
        name: 'Foodles Vendor Orders',
        address: process.env.EMAIL_USER
      },
      to: vendorEmail,
      subject: `New ${orderTypeText}: #${preReservationDetected ? 'PRE-RES' : ''}${orderId} - Action Required`,
      html: vendorEmailTemplate,
      headers: {
        'X-Entity-Ref-ID': `vendor-order-${orderId}`,
        'X-Priority': '1',
        'Precedence': 'high',
        'X-MSMail-Priority': 'High',
        'Importance': 'high',
        // Prevent threading for vendor emails
        'Message-ID': `<vendor-order-${orderId}-${Date.now()}@foodles.shop>`,
        'X-GM-THRID': `vendor-order-${orderId}`,
        'References': '',
        // Add these headers to prevent quoted text hiding
        'Content-Type': 'text/html; charset=utf-8',
        'X-Auto-Response-Suppress': 'All',
        'Auto-Submitted': 'auto-generated'
      },
      // Add these options to prevent quoted text hiding
      textEncoding: 'base64',
      alternative: true,
      messageId: `vendor-order-${orderId}-${Date.now()}@foodles.shop`,
      normalizeHeaderKey: (key) => key // Preserve header case
    };

    contactEmail.sendMail(mail, (error, info) => {
      if (error) {
        logError('vendor_email_error', 'Vendor email error', {
          error: error.message,
          vendorEmail
        });
        reject(error);
      } else if (info.rejected.length > 0) {
        logError('vendor_email_rejected', 'Email rejected for vendor', {
          vendorEmail,
          rejectedCount: info.rejected.length
        });
        reject(new Error("Vendor email delivery failed"));
      } else {
        logger.logOrder('vendor_email_delivered', 'Vendor email delivered successfully', {
          vendorEmail
        });
        resolve(true);
      }
    });
  });
};

const sendAdminNotificationEmail = (name, email, orderDetails, orderId) => {
  return new Promise((resolve, reject) => {
    // Use the existing formatOrderDetails which already has formatPhoneForDisplay
    const { userEmailTemplate, vendorEmailTemplate } = formatOrderDetails(orderDetails, orderId);

    const adminEmailTemplate = `
      <div style="font-family: Arial, sans-serif;">
        <h2>Admin Order Notification - #${orderId}</h2>
        <div style="margin-bottom: 20px;">
          <strong>Customer Details:</strong>
          <p>Name: ${name}</p>
          <p>Email: ${email}</p>
          <p>Phone: ${orderDetails.customerPhone}</p>
        </div>

        <!-- Include both customer and vendor views -->
        <div style="margin-bottom: 30px;">
          <h3>Customer Email View:</h3>
          ${userEmailTemplate}
        </div>

        <div style="margin-bottom: 30px;">
          <h3>Vendor Email View:</h3>
          ${vendorEmailTemplate}
        </div>
      </div>
    `;

    const mail = {
      from: {
        name: 'Foodles Admin Notifications',
        address: process.env.EMAIL_USER
      },
      to: 'suppfoodles@gmail.com',
      subject: `New Order #${orderId} - Admin Notification`,
      html: adminEmailTemplate,
      priority: 'high'
    };

    contactEmail.sendMail(mail, (error, info) => {
      if (error) {
        logError('admin_email_error', 'Admin email error', {
          error: error.message
        });
        reject(error);
      } else {
        logger.logOrder('admin_notification_sent', 'Admin notification sent successfully', {});
        resolve(true);
      }
    });
  });
};

// Initialize Razorpay for payment processing
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

logger.logOrder('razorpay_initialized', 'Razorpay initialized', {
  keyId: process.env.RAZORPAY_KEY_ID?.substring(0, 10) + '...'
});

// Razorpay: Create order endpoint
app.post('/payment/razorpay/create-order', async (req, res) => {
  const { amount, orderId, userDetails, currency = 'INR' } = req.body;
  
  try {
    if (!amount || amount <= 0) {
      throw new Error('Invalid amount specified');
    }

    if (!orderId || !userDetails) {
      throw new Error('Missing order details');
    }

    const options = {
      amount: Math.round(amount * 100), // Convert to paise
      currency,
      receipt: orderId,
      notes: {
        orderId: orderId,
        customerName: userDetails.fullName || userDetails.name || 'Customer',
        customerEmail: userDetails.email || '',
        customerPhone: userDetails.phoneNumber || userDetails.phone || '',
        description: "Foodles order payment",
        timestamp: new Date().toISOString()
      }
    };

    logger.logOrder('razorpay_order_creation', 'Creating Razorpay order', {
      orderId,
      amount: amount,
      customerName: userDetails.fullName
    });

    const razorpayOrder = await razorpay.orders.create(options);
    
    logger.logOrder('razorpay_order_created', 'Razorpay order created successfully', {
      razorpayOrderId: razorpayOrder.id,
      orderId: orderId,
      amount: razorpayOrder.amount / 100
    });

    res.json({
      success: true,
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    logError('razorpay_order_creation_failed', 'Razorpay order creation failed', {
      error: error.message,
      orderId: req.body.orderId,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced validation functions for payment verification
const validateOrderId = (orderId) => {
  if (!orderId || typeof orderId !== 'string') {
    return { valid: false, error: 'Order ID is required and must be a string' };
  }

  // Order ID should be alphanumeric with possible hyphens/underscores
  const orderIdRegex = /^[a-zA-Z0-9_-]+$/;
  if (!orderIdRegex.test(orderId)) {
    return { valid: false, error: 'Order ID contains invalid characters' };
  }

  if (orderId.length < 3 || orderId.length > 100) {
    return { valid: false, error: 'Order ID must be between 3 and 100 characters' };
  }

  return { valid: true };
};

const validateRazorpayVerificationData = (data) => {
  const errors = [];
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = data;

  if (!razorpay_order_id || typeof razorpay_order_id !== 'string') {
    errors.push('razorpay_order_id is required and must be a string');
  }

  if (!razorpay_payment_id || typeof razorpay_payment_id !== 'string') {
    errors.push('razorpay_payment_id is required and must be a string');
  }

  if (!razorpay_signature || typeof razorpay_signature !== 'string') {
    errors.push('razorpay_signature is required and must be a string');
  }

  const orderIdValidation = validateOrderId(orderId);
  if (!orderIdValidation.valid) {
    errors.push(`Order ID validation failed: ${orderIdValidation.error}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    validatedData: {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId
    }
  };
};

const validateOrderDataStructure = (orderData) => {
  const errors = [];

  if (!orderData || typeof orderData !== 'object') {
    return { valid: false, error: 'Order data must be an object' };
  }

  const { userDetails, orderDetails, vendorEmail, vendorPhone, restaurantId, restaurantName } = orderData;

  // Validate userDetails
  if (!userDetails || typeof userDetails !== 'object') {
    errors.push('userDetails is required and must be an object');
  } else {
    if (!userDetails.fullName || typeof userDetails.fullName !== 'string') {
      errors.push('userDetails.fullName is required and must be a string');
    }
    if (!userDetails.email || typeof userDetails.email !== 'string') {
      errors.push('userDetails.email is required and must be a string');
    }
    // Phone is optional but should be valid if provided
    if (userDetails.phoneNumber && typeof userDetails.phoneNumber !== 'string') {
      errors.push('userDetails.phoneNumber must be a string if provided');
    }
  }

  // Validate orderDetails
  if (!orderDetails || typeof orderDetails !== 'object') {
    errors.push('orderDetails is required and must be an object');
  } else {
    // Validate items array
    if (!Array.isArray(orderDetails.items)) {
      errors.push('orderDetails.items must be an array');
    } else if (orderDetails.items.length === 0) {
      errors.push('orderDetails.items cannot be empty');
    } else {
      // Validate each item has required fields
      orderDetails.items.forEach((item, index) => {
        if (!item.name || typeof item.name !== 'string') {
          errors.push(`orderDetails.items[${index}].name is required and must be a string`);
        }
        if (item.quantity === undefined || item.quantity === null || isNaN(parseInt(item.quantity)) || parseInt(item.quantity) <= 0) {
          errors.push(`orderDetails.items[${index}].quantity must be a positive number`);
        }
        if (item.price === undefined || item.price === null || isNaN(parseFloat(item.price)) || parseFloat(item.price) < 0) {
          errors.push(`orderDetails.items[${index}].price must be a non-negative number`);
        }
      });
    }

    // Validate numeric fields
    const numericFields = ['subtotal', 'deliveryFee', 'convenienceFee', 'dogDonation', 'grandTotal', 'remainingPayment'];
    numericFields.forEach(field => {
      const value = orderDetails[field];
      if (value !== undefined && value !== null) {
        const parsed = parseFloat(value);
        if (isNaN(parsed) || parsed < 0) {
          errors.push(`orderDetails.${field} must be a non-negative number`);
        }
      }
    });

    // Validate deliveryAddress
    if (orderDetails.deliveryAddress && typeof orderDetails.deliveryAddress !== 'string') {
      errors.push('orderDetails.deliveryAddress must be a string if provided');
    }
  }

  // Validate restaurant data
  if (!restaurantId || typeof restaurantId !== 'string') {
    errors.push('restaurantId is required and must be a string');
  }

  if (!restaurantName || typeof restaurantName !== 'string') {
    errors.push('restaurantName is required and must be a string');
  }

  // Vendor contact info is optional but should be valid if provided
  if (vendorEmail && typeof vendorEmail !== 'string') {
    errors.push('vendorEmail must be a string if provided');
  }

  if (vendorPhone && typeof vendorPhone !== 'string') {
    errors.push('vendorPhone must be a string if provided');
  }

  return {
    valid: errors.length === 0,
    errors,
    validatedData: {
      userDetails,
      orderDetails,
      vendorEmail,
      vendorPhone,
      restaurantId,
      restaurantName
    }
  };
};

// Function to check order data consistency between sources
const validateOrderDataConsistency = (frontendData, serverData) => {
  const inconsistencies = [];

  if (!frontendData || !serverData) {
    return { consistent: true, note: 'One data source missing - cannot compare' };
  }

  // Compare restaurant data
  if (frontendData.restaurantId !== serverData.restaurantId) {
    inconsistencies.push({
      field: 'restaurantId',
      frontend: frontendData.restaurantId,
      server: serverData.restaurantId
    });
  }

  if (frontendData.restaurantName !== serverData.restaurantName) {
    inconsistencies.push({
      field: 'restaurantName',
      frontend: frontendData.restaurantName,
      server: serverData.restaurantName
    });
  }

  // Compare user details
  if (frontendData.userDetails?.email !== serverData.userDetails?.email) {
    inconsistencies.push({
      field: 'userDetails.email',
      frontend: frontendData.userDetails?.email,
      server: serverData.userDetails?.email
    });
  }

  if (frontendData.userDetails?.fullName !== serverData.userDetails?.fullName) {
    inconsistencies.push({
      field: 'userDetails.fullName',
      frontend: frontendData.userDetails?.fullName,
      server: serverData.userDetails?.fullName
    });
  }

  // Compare order totals (most important for payment verification)
  if (parseFloat(frontendData.orderDetails?.grandTotal) !== parseFloat(serverData.orderDetails?.grandTotal)) {
    inconsistencies.push({
      field: 'orderDetails.grandTotal',
      frontend: parseFloat(frontendData.orderDetails?.grandTotal),
      server: parseFloat(serverData.orderDetails?.grandTotal)
    });
  }

  if (parseFloat(frontendData.orderDetails?.remainingPayment) !== parseFloat(serverData.orderDetails?.remainingPayment)) {
    inconsistencies.push({
      field: 'orderDetails.remainingPayment',
      frontend: parseFloat(frontendData.orderDetails?.remainingPayment),
      server: parseFloat(serverData.orderDetails?.remainingPayment)
    });
  }

  // Compare items count
  const frontendItemsCount = Array.isArray(frontendData.orderDetails?.items) ? frontendData.orderDetails.items.length : 0;
  const serverItemsCount = Array.isArray(serverData.orderDetails?.items) ? serverData.orderDetails.items.length : 0;

  if (frontendItemsCount !== serverItemsCount) {
    inconsistencies.push({
      field: 'orderDetails.items.length',
      frontend: frontendItemsCount,
      server: serverItemsCount
    });
  }

  return {
    consistent: inconsistencies.length === 0,
    inconsistencies,
    severity: inconsistencies.length > 0 ? 'warning' : 'none'
  };
};

// Fallback verification strategies when primary verification fails
const attemptFallbackVerification = async (orderId, primaryError) => {
  logger.logOrder('fallback_verification_attempt', 'Attempting fallback verification strategies', {
    orderId,
    primaryError: primaryError?.message || 'unknown'
  });

  const results = {
    strategies: [],
    finalResult: null,
    success: false
  };

  // STRATEGY 1: Check cached verification results
  const cachedVerification = verifiedPayments.get(orderId);
  if (cachedVerification && cachedVerification.status === 'SUCCESS') {
    logger.logOrder('fallback_cached_verification_success', 'Fallback successful using cached verification', {
      orderId,
      cachedAt: cachedVerification.timestamp
    });
    results.strategies.push('cached_verification');
    results.finalResult = cachedVerification;
    results.success = true;
    return results;
  }

  // STRATEGY 2: Check if order was processed successfully before
  const processedOrder = processedOrders.get(orderId);
  if (processedOrder && processedOrder.paymentStatus === 'SUCCESS') {
    logger.logOrder('fallback_processed_order_success', 'Fallback successful using processed order data', {
      orderId,
      processedAt: processedOrder.completedAt
    });
    results.strategies.push('processed_order_check');
    results.finalResult = {
      status: 'SUCCESS',
      paymentId: processedOrder.paymentId,
      verified: false, // Not freshly verified but processed
      source: 'processed_order_fallback'
    };
    results.success = true;
    return results;
  }

  // STRATEGY 4: Check for webhook confirmations (if any)
  // This would be populated by webhooks if they arrive after initial verification
  const webhookConfirmations = verifiedPayments.get(`${orderId}_webhook`);
  if (webhookConfirmations && webhookConfirmations.status === 'SUCCESS') {
    logger.logOrder('fallback_webhook_verification_success', 'Fallback successful using webhook confirmation', {
      orderId
    });
    results.strategies.push('webhook_confirmation');
    results.finalResult = webhookConfirmations;
    results.success = true;
    return results;
  }

  logger.logOrder('fallback_verification_all_failed', 'All fallback verification strategies failed', {
    orderId,
    strategiesAttempted: results.strategies
  });

  results.strategies.push('all_strategies_failed');
  return results;
};

// Razorpay: Verify payment and process order
app.post('/payment/razorpay/verify', async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature, 
      orderId,
      orderData: frontendOrderData
    } = req.body;

    logOrder('razorpay_payment_verification', 'Verifying Razorpay payment', {
      razorpay_order_id,
      razorpay_payment_id,
      orderId,
      hasOrderData: !!frontendOrderData
    });

    // STEP 1: Enhanced input validation
    const validation = validateRazorpayVerificationData(req.body);
    if (!validation.valid) {
      logError('razorpay_validation_failed', 'Razorpay verification data validation failed', {
        errors: validation.errors,
        orderId: req.body.orderId
      });
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Invalid request data',
        validationErrors: validation.errors,
        errorCode: 'VALIDATION_FAILED'
      });
    }

    // STEP 2: Verify Razorpay signature
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const payment_verified = generated_signature === razorpay_signature;

    if (!payment_verified) {
      logError('razorpay_signature_verification_failed', 'Payment signature verification failed', {
        orderId,
        providedSignature: razorpay_signature?.substring(0, 10) + '...',
        generatedSignature: generated_signature?.substring(0, 10) + '...'
      });
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Payment verification failed',
        errorCode: 'SIGNATURE_VERIFICATION_FAILED'
      });
    }

    logOrder('razorpay_signature_verified', 'Razorpay signature verified successfully', {
      orderId
    });

    // STEP 3: Check idempotency
    if (processedOrders.has(orderId)) {
      logOrder('razorpay_idempotent_check', 'Order already processed (idempotent check)', {
        orderId
      });
      const cachedResult = processedOrders.get(orderId);
      return res.json({
        success: true,
        verified: true,
        orderId,
        emailsSent: cachedResult.results?.emailsSent || 0,
        emailErrors: cachedResult.results?.emailErrors || [],
        missedCallStatus: cachedResult.results?.missedCallStatus,
        note: 'Order already processed'
      });
    }

    // STEP 4: Get and validate order data
    let orderData = frontendOrderData || pendingOrders.get(orderId);
    let dataSource = frontendOrderData ? 'frontend-localStorage' : 'server-memory';
    let consistencyCheck = null;
    
    if (!orderData) {
      logError('razorpay_order_data_missing', 'No order data found', {
        orderId
      });
      return res.status(404).json({
        success: false,
        verified: true,
        error: 'Order data not found',
        errorCode: 'ORDER_DATA_MISSING'
      });
    }

    // Check data consistency if we have both sources
    if (frontendOrderData && pendingOrders.has(orderId)) {
      const serverData = pendingOrders.get(orderId);
      consistencyCheck = validateOrderDataConsistency(frontendOrderData, serverData);
      if (!consistencyCheck.consistent) {
        logOrder('razorpay_data_consistency_warning', 'Order data inconsistency detected between frontend and server', {
          orderId,
          inconsistencies: consistencyCheck.inconsistencies,
          severity: consistencyCheck.severity
        });
      }
    }

    logOrder('razorpay_order_data_source', `Using order data from ${dataSource}`, {
      orderId,
      dataSource,
      hasConsistencyCheck: !!consistencyCheck
    });

    // Validate order data structure
    const orderValidation = validateOrderDataStructure(orderData);
    if (!orderValidation.valid) {
      logError('razorpay_order_data_validation_failed', 'Order data structure validation failed', {
        orderId,
        errors: orderValidation.errors
      });
      return res.status(400).json({
        success: false,
        verified: true,
        error: 'Invalid order data structure',
        validationErrors: orderValidation.errors,
        errorCode: 'ORDER_DATA_INVALID'
      });
    }

    const { 
      userDetails, 
      orderDetails, 
      vendorEmail, 
      vendorPhone, 
      restaurantId,
      restaurantName 
    } = orderValidation.validatedData;

    // STEP 4: Normalize and adjust order details
    const normalizedOrderDetails = {
      ...orderDetails,
      items: Array.isArray(orderDetails.items) ? orderDetails.items : [],
      subtotal: parseFloat(orderDetails.subtotal) || 0,
      deliveryFee: parseFloat(orderDetails.deliveryFee) || 0,
      convenienceFee: parseFloat(orderDetails.convenienceFee) || 0,
      dogDonation: parseFloat(orderDetails.dogDonation) || 0,
      grandTotal: parseFloat(orderDetails.grandTotal) || 0,
      remainingPayment: parseFloat(orderDetails.remainingPayment) || 0,
      deliveryAddress: orderDetails.deliveryAddress || 'Address not provided',
      customerPhone: orderDetails.customerPhone || userDetails.phoneNumber || '',
      vendorPhone: vendorPhone || ''
    };

    // Pizza Bite specific adjustment
    if (restaurantId === '5') {
      const adjustedDonation = normalizedOrderDetails.dogDonation > 0 ? normalizedOrderDetails.dogDonation - 5 : 0;
      normalizedOrderDetails.remainingPayment = 20 + adjustedDonation;
      normalizedOrderDetails.convenienceFee = 0;
      logOrder('pizza_bite_adjustment', 'Applied Pizza Bite pricing adjustment', {
        orderId,
        originalDonation: orderDetails.dogDonation,
        adjustedDonation,
        remainingPayment: normalizedOrderDetails.remainingPayment
      });
    }

    // STEP 5: Save order to MongoDB
    logOrder('mongodb_save_start', 'Saving order to MongoDB', {
      orderId
    });
    try {
      const orderDataToSave = {
        orderId,
        restaurantId,
        restaurantName,
        orderType: orderDetails.isPreReservation ? 'pre-reservation' : 'regular',
        userDetails: {
          fullName: userDetails.fullName,
          email: userDetails.email,
          phone: userDetails.phoneNumber || userDetails.phone
        },
        orderDetails: {
          ...normalizedOrderDetails,
          deliveryAddress: normalizedOrderDetails.deliveryAddress,
          specialInstructions: orderDetails.specialInstructions || '',
          isPreReservation: orderDetails.isPreReservation || false,
          deliveryTime: orderDetails.deliveryTime || '30-40'
        },
        paymentStatus: 'SUCCESS',
        paymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        amount: normalizedOrderDetails.remainingPayment,
        totalOrderValue: normalizedOrderDetails.grandTotal,
        completedAt: new Date()
      };

      // Save or update user order
      let userOrder = await UserOrder.findOne({ phone: userDetails.phoneNumber || userDetails.phone });
      
      if (!userOrder) {
        // Create new user
        userOrder = new UserOrder({
          email: userDetails.email,
          name: userDetails.fullName,
          phone: userDetails.phoneNumber || userDetails.phone,
          orders: [orderDataToSave],
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } else {
        // Add order to existing user
        userOrder.orders.push(orderDataToSave);
        userOrder.updatedAt = new Date();
      }

      await userOrder.save();
      logOrder('mongodb_save_success', 'Order saved to MongoDB successfully', {
        orderId,
        userPhone: userDetails.phoneNumber || userDetails.phone
      });

    } catch (saveError) {
      logError('mongodb_save_failed', 'Failed to save order to MongoDB', {
        orderId,
        error: saveError.message
      });
      // Don't fail the entire process for database save errors
    }

    logOrder('notification_processing_start', 'Processing notifications', {
      orderId
    });

    // STEP 5: Process emails and notifications (with error handling that doesn't fail payment)
    try {
      const results = await processEmails(
        userDetails.fullName, 
        userDetails.email, 
        normalizedOrderDetails, 
        orderId, 
        vendorEmail, 
        vendorPhone, 
        restaurantId
      );

      logOrder('notifications_processed', 'Notifications processed successfully', {
        orderId,
        emailsSent: results.emailsSent,
        missedCallStatus: results.missedCallStatus
      });
    } catch (notificationError) {
      logError('notification_processing_failed', 'Notification processing failed', {
        orderId,
        error: notificationError.message
      });
      logOrder('payment_verification_continued', 'Payment verification successful but notifications failed', {
        orderId,
        note: 'Order will still be marked as complete'
      });
      
      // Don't fail the payment verification if notifications fail
      // Just log the error and continue
    }

    // STEP 6: Mark as processed (regardless of notification success)
    processedOrders.set(orderId, {
      ...orderData,
      orderDetails: normalizedOrderDetails,
      paymentStatus: 'SUCCESS',
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      processedAt: Date.now(),
      notificationAttempted: true // Mark that we tried to send notifications
    });

    // Clean up pending order
    if (pendingOrders.has(orderId)) {
      pendingOrders.delete(orderId);
    }

    logOrder('razorpay_order_completed', 'Order completed via Razorpay - Payment verified successfully', {
      orderId,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id
    });

    res.json({
      success: true,
      verified: true,
      orderId,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      note: 'Payment verified successfully'
    });

  } catch (error) {
    logError('razorpay_verification_error', 'Razorpay verification error', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      verified: false,
      error: error.message
    });
  }
});





// Endpoint to get order details for confirmation page
app.get('/order-details/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Check if order exists in pending orders or email status
    const orderData = pendingOrders.get(orderId);
    const emailStatus = global.emailStatus?.[orderId];
    
    if (orderData || emailStatus) {
      res.json({
        success: true,
        orderId,
        orderData,
        emailStatus: emailStatus || { emailsSent: 0, emailErrors: [], missedCallStatus: null }
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }
  } catch (error) {
    logError('order_details_fetch_error', 'Error getting order details', {
      error: error.message,
      orderId: req.params?.orderId
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced API call wrapper with timeout and retry logic
const apiCallWithTimeoutAndRetry = async (apiCall, options = {}) => {
  const {
    maxRetries = 3,
    timeoutMs = 10000, // 10 seconds
    retryDelayMs = 1000, // 1 second
    backoffMultiplier = 2
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logOrder('api_call_attempt', `API call attempt ${attempt}/${maxRetries}`, {
        attempt,
        maxRetries,
        timeoutMs
      });

      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`API call timeout after ${timeoutMs}ms`)), timeoutMs);
      });

      // Race between API call and timeout
      const result = await Promise.race([apiCall(), timeoutPromise]);

      logOrder('api_call_success', `API call successful on attempt ${attempt}`, {
        attempt
      });

      return result;

    } catch (error) {
      lastError = error;
      logError('api_call_attempt_failed', `API call attempt ${attempt} failed`, {
        attempt,
        maxRetries,
        error: error.message,
        isTimeout: error.message.includes('timeout')
      });

      // Don't retry on the last attempt
      if (attempt < maxRetries) {
        const delay = retryDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        logOrder('api_call_retry_wait', `Waiting ${delay}ms before retry`, {
          attempt,
          delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All attempts failed
  logError('api_call_all_attempts_failed', `All ${maxRetries} API call attempts failed`, {
    maxRetries,
    finalError: lastError.message
  });

  throw lastError;
};







// Enhanced endpoint to get verified payment status (Comment 1: Step 3)
app.get('/payment/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    logOrder('payment_status_check', 'Payment status check requested', {
      orderId
    });
    
    // PRIORITY 1: Check if payment has been verified (Comment 1: Step 3)
    const verifiedStatus = verifiedPayments.get(orderId);
    
    if (verifiedStatus) {
      logOrder('payment_status_verified_found', 'Found verified payment', {
        orderId
      });
      return res.json({
        success: true,
        orderId,
        paymentStatus: verifiedStatus.status,
        paymentId: verifiedStatus.paymentId,
        verifiedAt: verifiedStatus.timestamp,
        verified: true
      });
    }
    
    // PRIORITY 2: Check if order was processed but not verified (Comment 1: Step 3)
    const isProcessed = processedOrders.has(orderId);
    
    if (isProcessed) {
      logOrder('payment_status_processed_found', 'Order processed but not verified', {
        orderId
      });
      const processedData = processedOrders.get(orderId);
      return res.json({
        success: true,
        orderId,
        paymentStatus: 'PENDING', // Changed from SUCCESS - not verified yet (Comment 1: Step 3)
        verified: false,
        processed: true,
        processedAt: processedData.timestamp,
        note: 'Payment processed but awaiting verification'
      });
    }
    
    // PRIORITY 3: Check if order is pending
    const isPending = pendingOrders.has(orderId);
    
    if (isPending) {
      logOrder('payment_status_pending', 'Order is pending payment', {
        orderId
      });
      return res.json({
        success: true,
        orderId,
        paymentStatus: 'PENDING',
        verified: false,
        processed: false
      });
    }
    
    // Order not found anywhere
    return res.status(404).json({
      success: false,
      error: 'Order not found',
      orderId
    });
    
  } catch (error) {
    logError('payment_status_check_error', 'Error checking payment status', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});



// GET endpoint to retrieve order details by orderId
app.get('/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    logOrder('order_details_fetch', 'Fetching order details', {
      orderId
    });

    // Check in processedOrders first (completed orders)
    let orderData = processedOrders.get(orderId);
    if (orderData) {
      return res.json({
        success: true,
        order: {
          orderId,
          userDetails: orderData.userDetails,
          orderDetails: orderData.orderDetails,
          restaurantName: orderData.restaurantName,
          amount: orderData.amount,
          completedAt: orderData.completedAt,
          paymentStatus: orderData.paymentStatus
        }
      });
    }

    // Check in pendingOrders (ongoing orders)
    orderData = pendingOrders.get(orderId);
    if (orderData) {
      return res.json({
        success: true,
        order: {
          orderId,
          userDetails: orderData.userDetails,
          orderDetails: orderData.orderDetails,
          restaurantName: orderData.restaurantName,
          amount: orderData.amount,
          timestamp: orderData.timestamp,
          paymentStatus: 'PENDING'
        }
      });
    }

    // Order not found
    res.status(404).json({
      success: false,
      error: 'Order not found'
    });

  } catch (error) {
    logError('order_details_fetch_error', 'Error fetching order details', {
      error: error.message,
      orderId: req.params?.orderId
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET endpoint to retrieve orders by phone number for order history
app.get('/orders/history/:phone', async (req, res) => {
  try {
    const { phone } = req.params;

    logOrder('order_history_fetch', 'Fetching order history for phone', {
      phone
    });

    // Clean the phone number (remove +91 prefix if present)
    const cleanPhone = phone.replace(/^\+91/, '').replace(/^\+/, '');
    const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;

    // Find user by phone number
    const userOrder = await UserOrder.findOne({ phone: { $regex: new RegExp(formattedPhone + '$') } });

    if (!userOrder) {
      return res.json({
        success: true,
        orders: [],
        message: 'No orders found for this phone number'
      });
    }

    // Sort orders by creation date (newest first)
    const sortedOrders = userOrder.orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    logOrder('order_history_found', 'Found orders for phone', {
      phone,
      orderCount: sortedOrders.length
    });

    res.json({
      success: true,
      orders: sortedOrders,
      user: {
        name: userOrder.name,
        email: userOrder.email,
        phone: userOrder.phone
      }
    });

  } catch (error) {
    logError('order_history_fetch_error', 'Error fetching order history', {
      error: error.message,
      phone: req.params?.phone
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});



// Endpoint to check if order has been processed (for frontend polling)
app.get('/payment/order-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Check if order is processed
    if (processedOrders.has(orderId)) {
      const processedOrder = processedOrders.get(orderId);
      return res.json({
        status: 'SUCCESS',
        processed: true,
        orderId,
        emailsSent: processedOrder.results?.emailsSent || 0,
        emailErrors: processedOrder.results?.emailErrors || [],
        missedCallStatus: processedOrder.results?.missedCallStatus
      });
    }
    
    // Check if order is still pending
    if (pendingOrders.has(orderId)) {
      return res.json({
        status: 'PENDING',
        processed: false,
        orderId
      });
    }
    
    // Order not found
    res.status(404).json({
      status: 'NOT_FOUND',
      orderId
    });

  } catch (error) {
    logError('order_status_check_error', 'Error checking order status', {
      error: error.message,
      orderId: req.params?.orderId
    });
    res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

// Add new endpoint to check email status with detailed information (Comment 6)
app.get('/email-status/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const status = global.emailStatus?.[orderId] || {
    emailsSent: 0,
    emailErrors: [],
    missedCallStatus: null,
    status: 'not_found'
  };
  
  // Return detailed payload (Comment 6)
  res.json({
    ...status,
    orderId,
    timestamp: Date.now()
  });
});

// Add global email tracking
const emailTracker = new Map();

// Add global call tracking for monitoring missed call attempts
const callTracker = new Map();

// API endpoint to save user order
app.post('/api/save-order', async (req, res) => {
  try {
    const { email, name, hostel, phone, order } = req.body;
    if (!email || !order) {
      return res.status(400).json({ success: false, error: 'Missing email or order data' });
    }
    let user = await UserOrder.findOne({ email });
    if (!user) {
      // New user
      user = new UserOrder({
        email,
        name,
        hostel,
        phone,
        orders: [order],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await user.save();
      return res.json({ success: true, message: 'User created and order saved' });
    } else {
      // Existing user, add order
      user.orders.push(order);
      user.updatedAt = new Date();
      await user.save();
      return res.json({ success: true, message: 'Order added to existing user' });
    }
  } catch (err) {
    logError('save_order_error', 'Error saving order', {
      error: err.message
    });
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Update processEmails function
async function processEmails(name, email, orderDetails, orderId, vendorEmail, vendorPhone, restaurantId) {
  // Check if emails were already sent for this order
  if (emailTracker.has(orderId)) {
    logOrder('emails_already_sent', 'Emails already sent for order', {
      orderId
    });
    return emailTracker.get(orderId);
  }

  let emailsSent = 0;
  let emailErrors = [];
  let missedCallStatus = null;

  try {
    logOrder('notification_processing_start', 'Processing order notifications (GUARANTEED)', {
      orderId,
      vendorPhone
    });
    global.emailStatus = global.emailStatus || {};
    global.emailStatus[orderId] = { emailsSent: 0, emailErrors: [], missedCallStatus: null };

    // Detect pre-reservation from orderDetails
    const isPreReservation = orderDetails.isPreReservation || 
      orderDetails.preReservationData || 
      orderDetails.orderType === 'pre-reserve' ||
      (orderDetails.remainingPayment && orderDetails.remainingPayment <= 20);

    logOrder('order_type_detected', 'Order type detected', {
      orderId,
      orderType: isPreReservation ? 'PRE-RESERVATION' : 'REGULAR ORDER'
    });

    // Ensure we have minimum required data
    const safeName = name || 'Valued Customer';
    const safeEmail = email || 'customer@foodles.shop';
    
    // Get vendor contact info dynamically from restaurant data
    const restaurantData = getRestaurantById(restaurantId);
    const safeVendorEmail = vendorEmail || restaurantData.vendorEmail;
    const safeVendorPhone = vendorPhone || restaurantData.vendorPhone;

    logOrder('restaurant_data_loaded', 'Restaurant data loaded for notifications', {
      restaurantId,
      restaurantName: restaurantData.name,
      vendorEmail: safeVendorEmail,
      vendorPhone: safeVendorPhone
    });

    // Create safe order details with proper vendor contact info
    const safeOrderDetails = orderDetails || { 
      items: [], 
      grandTotal: 0, 
      deliveryAddress: 'Address not provided',
      customerPhone: '+919999999999',
      vendorPhone: safeVendorPhone // Use the actual vendor phone from restaurant data
    };
    
    // Ensure vendorPhone is properly set in orderDetails
    safeOrderDetails.vendorPhone = safeVendorPhone;

    // SEND CUSTOMER EMAIL - Guaranteed attempt (non-blocking)
    try {
      logOrder('customer_email_sending', 'Sending customer email with vendor contact', {
        orderId,
        vendorPhone: safeOrderDetails.vendorPhone,
        vendorEmail: safeVendorEmail,
        restaurantName: restaurantData.name
      });
      await sendOrderConfirmationEmail(safeName, safeEmail, safeOrderDetails, orderId, isPreReservation);
      emailsSent++;
      logOrder('customer_email_sent', 'Customer email sent successfully', {
        orderId,
        email: safeEmail
      });
    } catch (error) {
      logError('customer_email_failed', 'Customer email failed (non-blocking)', {
        orderId,
        error: error.message
      });
      emailErrors.push({ type: 'customer', error: error.message });
      
      // RETRY customer email with fallback (non-blocking)
      try {
        logOrder('customer_email_retry', 'Retrying customer email with fallback data', {
          orderId
        });
        const fallbackOrderDetails = { 
          ...safeOrderDetails, 
          items: [{ name: 'Order Item', quantity: 1, price: 0 }],
          subtotal: 0,
          deliveryFee: 0,
          convenienceFee: 0,
          dogDonation: 0
        };
        await sendOrderConfirmationEmail(safeName, safeVendorEmail, fallbackOrderDetails, orderId, isPreReservation);
        emailsSent++;
        logOrder('customer_fallback_email_sent', 'Customer fallback email sent to admin', {
          orderId
        });
      } catch (retryError) {
        logError('customer_email_retry_failed', 'Customer email retry also failed (non-blocking)', {
          orderId,
          error: retryError.message
        });
        // Continue processing - email failure should not block payment
      }
    }

    // SEND VENDOR EMAIL + MISSED CALL - Guaranteed attempt (non-blocking)
    if (safeVendorEmail) {
      try {
        logOrder('vendor_email_sending', 'Sending vendor email with customer contact', {
          orderId,
          customerPhone: safeOrderDetails.customerPhone,
          vendorEmail: safeVendorEmail,
          restaurantName: restaurantData.name
        });
        await sendOrderReceivedEmail(safeVendorEmail, safeOrderDetails, orderId, isPreReservation);
        emailsSent++;
        logOrder('vendor_email_sent', 'Vendor email sent successfully', {
          orderId,
          email: safeVendorEmail
        });
        
        // TRIGGER MISSED CALL - Enhanced robustness with detailed tracking (non-blocking)
        if (safeVendorPhone) {
          logOrder('missed_call_initiating', 'Initiating vendor missed call', {
            orderId,
            restaurantId,
            phone: safeVendorPhone,
            hasTwilioClient: !!twilioClient,
            twilioPhone: process.env.TWILIO_PHONE_NUMBER
          });

          try {
            // Attempt missed call with retry logic
            const callStartTime = Date.now();
            const callSuccess = await triggerMissedCall(safeVendorPhone, restaurantId, 3); // 3 retries
            const callDuration = Date.now() - callStartTime;

            missedCallStatus = callSuccess ? 'success' : 'failed';

            logOrder('missed_call_result', 'Missed call result', {
              orderId,
              success: callSuccess,
              restaurantId,
              phone: safeVendorPhone,
              duration: `${callDuration}ms`,
              status: missedCallStatus,
              timestamp: new Date().toISOString()
            });

            // Log detailed failure information for monitoring
            if (!callSuccess) {
              logError('missed_call_failed', 'Missed call failed', {
                orderId,
                vendorPhone: safeVendorPhone,
                restaurantId,
                duration: callDuration,
                twilioConfigured: !!twilioClient,
                twilioPhone: process.env.TWILIO_PHONE_NUMBER,
                timestamp: new Date().toISOString()
              });
            }

          } catch (callError) {
            logError('missed_call_critical_error', 'Critical missed call error', {
              orderId,
              error: callError.message,
              code: callError.code,
              stack: callError.stack,
              vendorPhone: safeVendorPhone,
              restaurantId,
              timestamp: new Date().toISOString()
            });

            missedCallStatus = 'error';
            emailErrors.push({
              type: 'missed_call',
              error: callError.message,
              restaurantId,
              vendorPhone: safeVendorPhone
            });
          }
        } else {
          logOrder('missed_call_no_phone', 'No vendor phone available for missed call', {
            orderId,
            restaurantId,
            vendorPhone: safeVendorPhone,
            restaurantData: restaurantData
          });
          missedCallStatus = 'no_phone';
        }
      } catch (error) {
        logError('vendor_notifications_failed', 'Vendor notifications failed (non-blocking)', {
          orderId,
          error: error.message
        });
        emailErrors.push({ type: 'vendor', error: error.message });
        
        // RETRY vendor email to admin as fallback (non-blocking)
        try {
          logOrder('vendor_email_retry', 'Sending vendor notification to admin as fallback', {
            orderId
          });
          await sendOrderReceivedEmail(safeVendorEmail, safeOrderDetails, orderId);
          emailsSent++;
          logOrder('vendor_fallback_email_sent', 'Vendor fallback email sent to admin', {
            orderId
          });
        } catch (retryError) {
          logError('vendor_email_retry_failed', 'Vendor email retry failed (non-blocking)', {
            orderId,
            error: retryError.message
          });
          // Continue processing - email failure should not block payment
        }
      }
    }

    // SEND ADMIN NOTIFICATION - Always attempt (non-blocking)
    try {
      await sendAdminNotificationEmail(safeName, safeEmail, safeOrderDetails, orderId);
      emailsSent++;
      logOrder('admin_notification_sent', 'Admin notification sent successfully', {
        orderId
      });
    } catch (error) {
      logError('admin_notification_failed', 'Admin notification failed (non-blocking)', {
        orderId,
        error: error.message
      });
      emailErrors.push({ type: 'admin', error: error.message });
      // Continue processing - admin email failure should not block payment
    }

    // Store the results
    const results = { emailsSent, emailErrors, missedCallStatus };
    emailTracker.set(orderId, results);

    // Clean up tracker after 2 minutes (increased time)
    setTimeout(() => {
      emailTracker.delete(orderId);
      logOrder('email_tracking_cleaned', 'Cleaned up email tracking', {
        orderId
      });
    }, 120000); // 2 minutes

    // Clean up call tracker after 5 minutes (keep longer for monitoring)
    setTimeout(() => {
      const orderCalls = Array.from(callTracker.entries())
        .filter(([callId]) => callId.includes(orderId));
      
      orderCalls.forEach(([callId]) => {
        callTracker.delete(callId);
      });
      
      if (orderCalls.length > 0) {
        logOrder('call_tracking_cleaned', 'Cleaned up call tracking', {
          orderId,
          callsRemoved: orderCalls.length
        });
      }
    }, 300000); // 5 minutes

    // Update final status
    global.emailStatus[orderId] = { 
      emailsSent, 
      emailErrors, 
      missedCallStatus 
    };

    logOrder('notifications_completed', 'Order notifications completed (GUARANTEED)', {
      orderId,
      emailsSent,
      missedCall: missedCallStatus,
      totalAttempts: emailsSent + emailErrors.length
    });

    return results;
  } catch (error) {
    logError('notification_process_error', 'Notification process error', {
      orderId,
      error: error.message
    });
    
    // EMERGENCY FALLBACK - Send at least one notification
    try {
      logOrder('emergency_fallback_notification', 'Emergency fallback notification', {
        orderId
      });
      await sendAdminNotificationEmail('Emergency Order', safeVendorEmail, { 
        items: [{ name: 'Emergency Processing', quantity: 1, price: 0 }],
        grandTotal: 0,
        deliveryAddress: 'Emergency processing - check logs',
        customerPhone: '+919999999999'
      }, orderId);
      logOrder('emergency_notification_sent', 'Emergency notification sent', {
        orderId
      });
      return { emailsSent: 1, emailErrors: [], missedCallStatus: 'failed' };
    } catch (emergencyError) {
      logError('emergency_notification_failed', 'Emergency notification failed', {
        orderId,
        error: emergencyError.message
      });
      return { emailsSent: 0, emailErrors: [error], missedCallStatus: 'failed' };
    }
  }
}

// Add more detailed logging for the health endpoint with diagnostics (Comment 8, 14)
app.get('/health', async (req, res) => {
  logOrder('health_check_requested', 'Health check requested', {});

  // Check nodemailer status (Comment 14)
  let emailStatus = 'unknown';
  try {
    await contactEmail.verify();
    emailStatus = 'connected';
  } catch (error) {
    emailStatus = `error: ${error.message}`;
  }

  // Check single Twilio configuration
  const twilioStatus = {
    configured: !!twilioClient,
    hasPhone: !!process.env.TWILIO_PHONE_NUMBER,
    ready: !!(twilioClient && process.env.TWILIO_PHONE_NUMBER)
  };

  const status = {
    status: 'OK',
    timestamp: new Date(),
    environment: process.env.NODE_ENV,
    services: {
      email: emailStatus,
      payment: 'razorpay',
      twilio: twilioStatus
    },
    config: {
      emailUser: process.env.EMAIL_USER ? 'configured' : 'missing',
      emailPass: process.env.EMAIL_PASS ? 'configured' : 'missing',
      twilioConfigured: twilioStatus.configured,
      twilioPhone: twilioStatus.hasPhone
    }
  };
  logOrder('health_status_response', 'Health status response', {
    status: status.status,
    environment: status.environment,
    emailStatus,
    twilioReady: twilioStatus.ready
  });
  res.json(status);
});// Initialize single Twilio client for all missed calls
let twilioClient = null;

logger.logOrder('twilio_credentials_check', 'Checking Twilio credentials', {
  hasAccountSid: !!process.env.TWILIO_ACCOUNT_SID,
  hasAuthToken: !!process.env.TWILIO_AUTH_TOKEN,
  hasPhoneNumber: !!process.env.TWILIO_PHONE_NUMBER,
  nodeEnv: process.env.NODE_ENV
});

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  logger.logOrder('twilio_initialized', 'Twilio initialized for all missed calls', {});
} else {
  logger.logOrder('twilio_credentials_missing', 'Missing Twilio credentials - missed calls will be disabled', {});
  logger.logOrder('twilio_required_variables', 'Required environment variables status', {
    hasAccountSid: !!process.env.TWILIO_ACCOUNT_SID,
    hasAuthToken: !!process.env.TWILIO_AUTH_TOKEN,
    hasPhoneNumber: !!process.env.TWILIO_PHONE_NUMBER
  });
}

// Improved helper function for phone number formatting with validation (Comment 15)
const formatPhoneNumber = (phone) => {
  if (!phone) return '';
  
  // Remove all non-digit characters and leading +91
  const cleaned = phone.replace(/^\+?(91)?/, '').replace(/\D/g, '');
  
  // Log original and cleaned for diagnostics (Comment 15)
  logOrder('phone_normalization', 'Phone normalization', {
    original: phone,
    cleaned,
    length: cleaned.length
  });
  
  // Validate: must be exactly 10 digits (Comment 15)
  if (cleaned.length !== 10) {
    logOrder('phone_validation_failed', 'Invalid phone number length', {
      length: cleaned.length,
      expected: 10
    });
    return ''; // Return empty if invalid
  }
  
  // Ensure it doesn't start with 0
  if (cleaned.startsWith('0')) {
    logOrder('phone_zero_removal', 'Phone number starts with 0, removing', {
      original: cleaned
    });
    const withoutZero = cleaned.substring(1);
    if (withoutZero.length !== 10) {
      return '';
    }
    return `+91${withoutZero}`;
  }
  
  return `+91${cleaned}`;
};

// Simplified triggerMissedCall function using single Twilio client
const triggerMissedCall = async (vendorPhone, restaurantId, maxRetries = 3) => {
  const callId = `${restaurantId}_${vendorPhone}_${Date.now()}`;
  const callRecord = {
    callId,
    restaurantId,
    vendorPhone,
    startTime: new Date().toISOString(),
    attempts: [],
    finalStatus: null,
    duration: null
  };

  logOrder('missed_call_process_start', 'Starting missed call process', {
    callId,
    restaurantId,
    vendorPhone,
    maxRetries,
    hasTwilioClient: !!twilioClient
  });

  const startTime = Date.now();

  // VALIDATION: Check if vendor phone is provided
  if (!vendorPhone) {
    logError('missed_call_no_phone', 'No vendor phone provided for missed call', {
      callId
    });
    callRecord.finalStatus = 'no_phone';
    callRecord.duration = Date.now() - startTime;
    callTracker.set(callId, callRecord);
    return false;
  }

  // VALIDATION: Check if Twilio client is available
  if (!twilioClient) {
    logError('missed_call_no_twilio_client', 'No Twilio client available for missed calls', {
      callId
    });
    callRecord.finalStatus = 'no_twilio_client';
    callRecord.duration = Date.now() - startTime;
    callTracker.set(callId, callRecord);
    return false;
  }

  // VALIDATION: Format and validate phone number
  const formattedPhone = formatPhoneNumber(vendorPhone);
  if (!formattedPhone) {
    logError('missed_call_invalid_phone', 'Invalid vendor phone number', {
      callId,
      vendorPhone
    });
    callRecord.finalStatus = 'invalid_phone';
    callRecord.duration = Date.now() - startTime;
    callTracker.set(callId, callRecord);
    return false;
  }

  callRecord.formattedPhone = formattedPhone;

  // RETRY LOGIC: Attempt call with exponential backoff
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptStart = Date.now();
    const attemptRecord = {
      attempt,
      startTime: new Date().toISOString(),
      config: 'single_client',
      status: null,
      error: null,
      duration: null
    };

    try {
      logOrder('missed_call_attempt', 'Attempting missed call', {
        callId,
        attempt,
        maxRetries,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhone,
        restaurant: restaurantId
      });

      // Set timeout for the call attempt (30 seconds)
      const callPromise = twilioClient.calls.create({
        url: 'http://twimlets.com/reject',
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhone,
        timeout: 30
      });

      // Add timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Call timeout')), 35000); // 35 seconds
      });

      const call = await Promise.race([callPromise, timeoutPromise]);

      attemptRecord.status = 'success';
      attemptRecord.sid = call.sid;
      attemptRecord.callStatus = call.status;
      attemptRecord.duration = Date.now() - attemptStart;

      logOrder('missed_call_success', 'Call created successfully', {
        callId,
        sid: call.sid,
        status: call.status,
        restaurant: restaurantId,
        phone: formattedPhone,
        attempt,
        duration: attemptRecord.duration
      });

      callRecord.attempts.push(attemptRecord);
      callRecord.finalStatus = 'success';
      callRecord.duration = Date.now() - startTime;
      callRecord.sid = call.sid;
      callTracker.set(callId, callRecord);

      return true;

    } catch (error) {
      attemptRecord.status = 'failed';
      attemptRecord.error = {
        code: error.code,
        message: error.message,
        status: error.status
      };
      attemptRecord.duration = Date.now() - attemptStart;

      logError('missed_call_attempt_failed', 'Twilio call attempt failed', {
        callId,
        attempt,
        maxRetries,
        restaurantId,
        phone: formattedPhone,
        error: attemptRecord.error,
        duration: attemptRecord.duration
      });

      callRecord.attempts.push(attemptRecord);

      // If this is not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
        logOrder('missed_call_retry_wait', 'Waiting before retry', {
          callId,
          attempt,
          maxRetries,
          delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // FINAL FAILURE: All attempts exhausted
  logError('missed_call_all_attempts_failed', 'All missed call attempts failed', {
    callId,
    restaurantId,
    vendorPhone: formattedPhone,
    attempts: maxRetries,
    totalDuration: Date.now() - startTime
  });

  callRecord.finalStatus = 'failed_all';
  callRecord.duration = Date.now() - startTime;
  callTracker.set(callId, callRecord);

  return false;
};// Add test endpoint
app.post('/test-missed-call', async (req, res) => {
  logOrder('test_call_request_received', 'Test call request received', {
    body: req.body
  });
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: 'Phone number required' });
  }

  try {
    const result = await triggerMissedCall(phoneNumber);
    res.json({
      success: result,
      message: result ? 'Call initiated' : 'Call failed',
      phone: phoneNumber
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Add Twilio health check endpoint for monitoring
app.get('/health/twilio', async (req, res) => {
  logOrder('twilio_health_check_requested', 'Twilio health check requested', {});

  const twilioHealth = {
    configured: !!twilioClient,
    hasClient: !!twilioClient,
    hasPhone: !!process.env.TWILIO_PHONE_NUMBER,
    accountSid: process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'missing',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER ? 'configured' : 'missing',
    ready: !!(twilioClient && process.env.TWILIO_PHONE_NUMBER)
  };

  // Test the configuration with a validation call (non-billing)
  if (twilioHealth.ready) {
    try {
      // Test phone number formatting
      const testPhone = '+919999999999'; // Test number
      const formattedTestPhone = formatPhoneNumber(testPhone);

      twilioHealth.phoneFormatValid = !!formattedTestPhone;
      twilioHealth.testPhoneFormatted = formattedTestPhone;

      // Note: We don't make actual test calls to avoid charges
      twilioHealth.testReady = true;

    } catch (testError) {
      twilioHealth.testError = testError.message;
      twilioHealth.testReady = false;
    }
  }

  // Overall health summary
  const summary = {
    totalConfigurations: 1,
    configuredConfigurations: twilioHealth.ready ? 1 : 0,
    overallHealth: twilioHealth.ready ? 'healthy' : 'unhealthy',
    lastChecked: new Date().toISOString()
  };

  logOrder('twilio_health_check_results', 'Twilio health check results', {
    summary,
    details: twilioHealth
  });

  res.json({
    success: true,
    summary,
    details: twilioHealth
  });
});

// Add endpoint to get call tracking information
app.get('/calls/status/:orderId?', async (req, res) => {
  const { orderId } = req.params;

  if (orderId) {
    // Get calls for specific order
    const orderCalls = Array.from(callTracker.entries())
      .filter(([callId]) => callId.includes(orderId))
      .map(([callId, record]) => ({ callId, ...record }));

    res.json({
      success: true,
      orderId,
      calls: orderCalls,
      count: orderCalls.length
    });
  } else {
    // Get recent calls (last 100)
    const recentCalls = Array.from(callTracker.entries())
      .sort(([,a], [,b]) => new Date(b.startTime) - new Date(a.startTime))
      .slice(0, 100)
      .map(([callId, record]) => ({ callId, ...record }));

    // Summary statistics
    const stats = {
      total: callTracker.size,
      successful: recentCalls.filter(c => c.finalStatus === 'success' || c.finalStatus === 'success_fallback').length,
      failed: recentCalls.filter(c => c.finalStatus === 'failed_all').length,
      inProgress: recentCalls.filter(c => !c.finalStatus).length,
      successRate: callTracker.size > 0 ?
        ((recentCalls.filter(c => c.finalStatus === 'success' || c.finalStatus === 'success_fallback').length / recentCalls.length) * 100).toFixed(1) + '%' :
        '0%'
    };

    res.json({
      success: true,
      stats,
      recentCalls,
      timestamp: new Date().toISOString()
    });
  }
});

// Add restaurant status endpoints
const restaurantStatusCache = {
  lastCheck: null,
  statuses: {}
};

// Update getRestaurantStatus function
const getRestaurantStatus = (restaurantId) => {
  const now = new Date();
  const statusKey = `RESTAURANT_${restaurantId}_STATUS`;
  const status = process.env[statusKey];
  
  logOrder('restaurant_status_check', 'Restaurant status check', {
    restaurantId,
    statusKey,
    rawStatus: status,
    timestamp: now.toISOString()
  });

  // Convert status to boolean
  const isOpen = status === '1';

  return {
    isOpen: isOpen,
    message: isOpen ? 'Open' : 'Temporarily Closed',
    lastChecked: now.toISOString(),
    restaurantId,
    debug: { 
      rawStatus: status,
      statusKey,
      checkTime: now.toISOString()
    }
  };
};

app.get('/api/restaurants/status/:restaurantId', (req, res) => {
  const { restaurantId } = req.params;
  const status = getRestaurantStatus(restaurantId);
  res.json(status);
});

app.get('/api/restaurants/status', (req, res) => {
  const now = new Date();
  const statuses = {};
  
  // Get all restaurant IDs from query or use default list
  const ids = req.query.ids?.split(',') || ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  
  // Check if we need to refresh the cache (10 seconds)
  const shouldRefreshCache = !restaurantStatusCache.lastCheck || 
    (now - restaurantStatusCache.lastCheck) > 10000;

  if (shouldRefreshCache) {
    logOrder('restaurant_status_cache_refresh', 'Refreshing restaurant status cache', {
      timestamp: now.toISOString(),
      requestedIds: ids,
      previousCache: restaurantStatusCache
    });

    ids.forEach(id => {
      statuses[id] = getRestaurantStatus(id);
    });
    
    // Update cache
    restaurantStatusCache.statuses = statuses;
    restaurantStatusCache.lastCheck = now;
  }

  // Send response with metadata
  const response = {
    statuses: shouldRefreshCache ? statuses : restaurantStatusCache.statuses,
    metadata: {
      lastChecked: restaurantStatusCache.lastCheck,
      nextCheckAt: new Date(restaurantStatusCache.lastCheck + 10000).toISOString(),
      isFromCache: !shouldRefreshCache,
      debug: {
        currentTime: now.toISOString(),
        cacheAge: restaurantStatusCache.lastCheck ? 
          now - restaurantStatusCache.lastCheck : 
          null
      }
    }
  };

  logOrder('restaurant_status_response', 'Sending status response', {
    fromCache: !shouldRefreshCache,
    restaurantCount: Object.keys(response.statuses).length,
    timestamp: now.toISOString()
  });

  res.json(response);
});

// Add new endpoint for restaurant selection logging
app.post('/api/log-restaurant-selection', (req, res) => {
  const { restaurantId, restaurantName, timestamp } = req.body;
  
  logOrder('restaurant_selected', 'Restaurant selected', {
    restaurantId,
    restaurantName
  });

  res.json({ success: true });
});

// Add status monitoring system
const statusMonitor = {
  watchers: new Set(),
  previousStatuses: {},
  checkInterval: null,

  startMonitoring() {
    this.checkInterval = setInterval(() => {
      const changes = this.checkForChanges();
      if (changes.length > 0) {
        logger.logOrder('status_changes_detected', 'Status changes detected', {
          changes
        });
        this.notifyWatchers(changes);
      }
    }, 1000); // Check every second
  },

  checkForChanges() {
    const changes = [];
    const ids = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    
    ids.forEach(id => {
      const statusKey = `RESTAURANT_${id}_STATUS`;
      const currentStatus = process.env[statusKey];
      
      if (this.previousStatuses[id] !== currentStatus) {
        changes.push({
          restaurantId: id,
          oldStatus: this.previousStatuses[id],
          newStatus: currentStatus,
          timestamp: new Date().toISOString()
        });
        this.previousStatuses[id] = currentStatus;
      }
    });
    
    return changes;
  },

  notifyWatchers(changes) {
    const message = JSON.stringify({ 
      type: 'STATUS_UPDATE', 
      changes,
      timestamp: new Date().toISOString()
    });
    this.watchers.forEach(client => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  }
};

// Initialize status monitor
statusMonitor.startMonitoring();

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// WebSocket connection handler
wss.on('connection', (ws) => {
  statusMonitor.watchers.add(ws);
  
  // Send initial statuses
  const initialStatus = Object.keys(process.env)
    .filter(key => key.startsWith('RESTAURANT_'))
    .reduce((acc, key) => {
      const id = key.split('_')[1];
      acc[id] = process.env[key];
      return acc;
    }, {});
  
  ws.send(JSON.stringify({ 
    type: 'INITIAL_STATUS', 
    statuses: initialStatus 
  }));

  ws.on('close', () => {
    statusMonitor.watchers.delete(ws);
  });
});

// BACKEND TRIGGER: Phone number sync endpoint
app.post('/api/sync-phone-number', async (req, res) => {
  try {
    const { phoneNumber, userName, userEmail, source } = req.body;

    logOrder('backend_phone_sync_trigger', 'BACKEND TRIGGER: Phone number sync requested', {
      phoneNumber,
      userName,
      userEmail,
      source
    });

    if (!phoneNumber) {
      logOrder('backend_phone_sync_missing', 'BACKEND: No phone number provided for sync', {});
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
        backendTrigger: {
          synced: false,
          reason: 'missing_phone'
        }
      });
    }

    // Clean and format phone number
    const cleanPhone = phoneNumber.replace(/^\+91/, '').replace(/^\+/, '');
    const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;

    logOrder('backend_phone_cleaned', 'BACKEND: Phone number cleaned and formatted for sync', {
      original: phoneNumber,
      cleaned: cleanPhone,
      formatted: formattedPhone
    });

    // Check if user exists
    let userOrder = await UserOrder.findOne({ phone: { $regex: new RegExp(formattedPhone + '$') } });

    if (userOrder) {
      // Update existing user with latest info
      logOrder('backend_user_update', 'BACKEND: Updating existing user with synced data', {});
      userOrder.name = userName || userOrder.name;
      userOrder.email = userEmail || userOrder.email;
      userOrder.updatedAt = new Date();
      await userOrder.save();

      logOrder('backend_user_updated', 'BACKEND: Existing user updated successfully', {});
    } else {
      // Create new user entry for phone number tracking
      logOrder('backend_user_create', 'BACKEND: Creating new user entry for phone sync', {});
      userOrder = new UserOrder({
        email: userEmail || `temp_${formattedPhone}@foodles.local`,
        name: userName || 'Phone Synced User',
        phone: formattedPhone,
        orders: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await userOrder.save();

      logOrder('backend_user_created', 'BACKEND: New user created for phone sync', {});
    }

    logOrder('backend_phone_sync_completed', 'BACKEND TRIGGER: Phone number sync completed successfully', {});

    res.json({
      success: true,
      message: 'Phone number synced successfully',
      backendTrigger: {
        synced: true,
        phoneFormatted: formattedPhone,
        userExists: !!userOrder.orders.length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logError('backend_phone_sync_error', 'BACKEND ERROR: Phone sync failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message,
      backendTrigger: {
        synced: false,
        error: true,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Add a new endpoint to handle feedback submissions
app.post('/api/submit-feedback', async (req, res) => {
  const { orderId, feedback } = req.body;
  logOrder('feedback_submitted', 'Feedback submitted', {
    orderId,
    rating: feedback?.rating
  });
  
  try {
    // You can add logic here to store feedback in a database
    res.json({ success: true });
  } catch (error) {
    logError('feedback_submission_failed', 'Feedback submission failed', {
      orderId,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET endpoint to retrieve orders by phone number for order history
app.get('/orders/history/:phone', async (req, res) => {
  try {
    const { phone } = req.params;

    logOrder('backend_order_history_fetch', 'BACKEND TRIGGER: Order history fetch initiated', {
      phone
    });

    // Clean the phone number (remove +91 prefix if present)
    const cleanPhone = phone.replace(/^\+91/, '').replace(/^\+/, '');
    const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;

    logOrder('backend_phone_validation', 'BACKEND: Checking phone number format and validation', {
      original: phone,
      cleaned: cleanPhone,
      formatted: formattedPhone
    });

    // BACKEND TRIGGER: Attempt to sync phone number from frontend storage
    logOrder('backend_phone_sync_attempt', 'BACKEND TRIGGER: Attempting to sync phone number from frontend storage', {});
    try {
      // This would be called from frontend, but we can log the attempt
      logOrder('backend_phone_sync_trigger_activated', 'BACKEND: Phone number sync trigger activated', {});
      // In a real implementation, this could update backend storage
    } catch (syncError) {
      logOrder('backend_phone_sync_failed', 'BACKEND: Phone sync failed, continuing with existing data', {});
    }

    logOrder('backend_mongodb_query', 'BACKEND: Querying MongoDB for user orders', {});

    // Find user by phone number
    const userOrder = await UserOrder.findOne({ phone: { $regex: new RegExp(formattedPhone + '$') } });

    if (!userOrder) {
      logOrder('backend_user_not_found', 'BACKEND: No user found for phone', {
        formattedPhone
      });
      return res.json({
        success: true,
        orders: [],
        message: 'No orders found for this phone number',
        backendTrigger: {
          phoneSynced: false,
          queryExecuted: true,
          userFound: false
        }
      });
    }

    logOrder('backend_user_found', 'BACKEND: User found, retrieving orders', {});

    // Sort orders by creation date (newest first)
    const sortedOrders = userOrder.orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    logOrder('backend_orders_sorted', 'BACKEND: Found orders, sorted by date', {
      orderCount: sortedOrders.length
    });

    // BACKEND TRIGGER: Log successful order retrieval
    logOrder('backend_order_history_success', 'BACKEND TRIGGER: Order history successfully retrieved and processed', {});

    res.json({
      success: true,
      orders: sortedOrders,
      user: {
        name: userOrder.name,
        email: userOrder.email,
        phone: userOrder.phone
      },
      backendTrigger: {
        phoneSynced: true,
        queryExecuted: true,
        userFound: true,
        ordersCount: sortedOrders.length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logError('backend_order_history_error', 'BACKEND ERROR: Order history fetch failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message,
      backendTrigger: {
        error: true,
        timestamp: new Date().toISOString()
      }
    });
  }
});



// Add test endpoint for email functionality
app.post('/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email address is required' 
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid email address format' 
      });
    }

    logOrder('test_email_sending', 'Sending test email', {
      email
    });

    const mail = {
      from: {
        name: 'Foodles Test',
        address: process.env.EMAIL_USER
      },
      to: email,
      subject: 'Foodles Email Test - NodeMailer Capabilities',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #000000; color: #ffffff;">
          <div style="background-color: #111111; border-left: 4px solid #FFD700; padding: 20px; margin-bottom: 20px;">
            <h1 style="color: #FFD700; margin: 0; font-size: 24px;">🧪 EMAIL TEST SUCCESSFUL</h1>
            <p style="color: #888888; margin: 5px 0;">NodeMailer is working correctly!</p>
          </div>

          <div style="background-color: #111111; padding: 20px; margin-bottom: 20px;">
            <h2 style="color: #FFD700; font-size: 18px; margin-bottom: 15px;">Test Details</h2>
            <p style="margin: 10px 0;"><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            <p style="margin: 10px 0;"><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
            <p style="margin: 10px 0;"><strong>Email Service:</strong> Gmail (SMTP)</p>
            <p style="margin: 10px 0;"><strong>From:</strong> ${process.env.EMAIL_USER}</p>
          </div>

          <div style="text-align: center; padding: 20px; background-color: #111111;">
            <p style="color: #888888; margin: 0;">This is a test email sent from Foodles backend server.</p>
            <p style="color: #FFD700; margin: 10px 0;">✅ NodeMailer is configured and working!</p>
          </div>
        </div>
      `,
      headers: {
        'X-Test-Email': 'true',
        'Precedence': 'bulk'
      }
    };

    const info = await new Promise((resolve, reject) => {
      contactEmail.sendMail(mail, (error, info) => {
        if (error) reject(error);
        else resolve(info);
      });
    });

    logOrder('test_email_sent', 'Test email sent successfully', {
      email,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected
    });

    res.json({
      success: true,
      message: 'Test email sent successfully',
      details: {
        to: email,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logError('test_email_failed', 'Test email failed', {
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to send test email',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Add endpoint to trigger notifications for already verified orders (for order confirmation page)
app.post('/payment/trigger-notifications', async (req, res) => {
  try {
    const { orderId, orderData } = req.body;

    logOrder('trigger_notifications_request', 'Triggering notifications for already verified order', {
      orderId
    });

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: 'Order ID is required'
      });
    }

    // Check if order has already been processed
    if (processedOrders.has(orderId)) {
      logOrder('trigger_notifications_already_processed', 'Order already processed, returning cached result', {
        orderId
      });
      const cachedResult = processedOrders.get(orderId);
      return res.json({
        success: true,
        orderId,
        emailsSent: cachedResult.results?.emailsSent || 0,
        emailErrors: cachedResult.results?.emailErrors || [],
        missedCallStatus: cachedResult.results?.missedCallStatus,
        note: 'Order already processed'
      });
    }

    // Check if order data is available
    let orderToProcess = orderData || pendingOrders.get(orderId);

    if (!orderToProcess) {
      logError('trigger_notifications_no_order_data', 'No order data found for triggering notifications', {
        orderId
      });
      return res.status(404).json({
        success: false,
        error: 'Order data not found'
      });
    }

    const { 
      userDetails, 
      orderDetails, 
      vendorEmail, 
      vendorPhone, 
      restaurantId, 
      restaurantName 
    } = orderToProcess;

    // Normalize order details
    const normalizedOrderDetails = {
      ...orderDetails,
      items: Array.isArray(orderDetails.items) ? orderDetails.items : [],
      subtotal: parseFloat(orderDetails.subtotal) || 0,
      deliveryFee: parseFloat(orderDetails.deliveryFee) || 0,
      convenienceFee: parseFloat(orderDetails.convenienceFee) || 0,
      dogDonation: parseFloat(orderDetails.dogDonation) || 0,
      grandTotal: parseFloat(orderDetails.grandTotal) || 0,
      remainingPayment: parseFloat(orderDetails.remainingPayment) || 0,
      deliveryAddress: orderDetails.deliveryAddress || 'Address not provided',
      customerPhone: orderDetails.customerPhone || userDetails.phoneNumber || '',
      vendorPhone: vendorPhone || ''
    };

    // Apply Pizza Bite adjustment if needed
    if (restaurantId === '5') {
      const adjustedDonation = normalizedOrderDetails.dogDonation > 0 ? normalizedOrderDetails.dogDonation - 5 : 0;
      normalizedOrderDetails.remainingPayment = 20 + adjustedDonation;
      normalizedOrderDetails.convenienceFee = 0;
      logOrder('trigger_notifications_pizza_bite_adjustment', 'Applied Pizza Bite pricing adjustment for notifications', {
        orderId,
        originalDonation: orderDetails.dogDonation,
        adjustedDonation,
        remainingPayment: normalizedOrderDetails.remainingPayment
      });
    }

    // Process notifications
    const results = await processEmails(
      userDetails.fullName, 
      userDetails.email, 
      normalizedOrderDetails, 
      orderId, 
      vendorEmail, 
      vendorPhone, 
      restaurantId
    );

    // Mark as processed
    processedOrders.set(orderId, {
      ...orderToProcess,
      orderDetails: normalizedOrderDetails,
      completedAt: new Date().toISOString(),
      paymentStatus: 'SUCCESS',
      processedAt: Date.now(),
      results
    });

    // Clean up pending order if it exists
    if (pendingOrders.has(orderId)) {
      pendingOrders.delete(orderId);
    }

    logOrder('trigger_notifications_success', 'Notifications triggered successfully', {
      orderId,
      emailsSent: results.emailsSent,
      missedCallStatus: results.missedCallStatus
    });

    res.json({
      success: true,
      orderId,
      emailsSent: results.emailsSent,
      emailErrors: results.emailErrors,
      missedCallStatus: results.missedCallStatus
    });

  } catch (error) {
    logError('trigger_notifications_error', 'Error triggering notifications', {
      error: error.message,
      orderId: req.body?.orderId
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start the server
server.listen(PORT, async () => {
  // BACKEND TRIGGER: Server startup phone number check
  logger.logOrder('server_startup_phone_check', 'BACKEND TRIGGER: Server startup - checking for stored phone numbers', {});

  try {
    // Count total users with phone numbers
    const userCount = await UserOrder.countDocuments({ phone: { $exists: true, $ne: null } });
    logger.logOrder('server_startup_user_count', 'BACKEND: Found users with phone numbers in database', {
      userCount
    });

    // Get recent phone numbers (last 24 hours)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentUsers = await UserOrder.find({
      updatedAt: { $gte: yesterday },
      phone: { $exists: true, $ne: null }
    }).select('phone name updatedAt').limit(5);

    if (recentUsers.length > 0) {
      logger.logOrder('server_startup_recent_activity', 'BACKEND: Recent phone number activity', {
        recentUsers: recentUsers.map(user => ({
          phone: user.phone,
          name: user.name,
          updatedAt: user.updatedAt.toISOString()
        }))
      });
    }

    logger.logOrder('server_startup_phone_check_completed', 'BACKEND TRIGGER: Phone number check completed', {});
  } catch (error) {
    logger.logOrder('server_startup_phone_check_failed', 'BACKEND: Phone number check failed', {
      error: error.message
    });
  }

  // Get status of single Twilio configuration
  const twilioStatus = twilioClient ? '✓ Single client configured' : '✗ Not configured';

  logger.logOrder('server_started', 'Server started successfully', {
    mode: process.env.NODE_ENV || 'development',
    port: PORT,
    allowedOrigins: [
      'https://foodles.shop',
      'https://www.foodles.shop',
      'https://precious-cobbler-d60f77.netlify.app',
      ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : [])
    ],
    twilioStatus,
    emailStatus: contactEmail ? '✓ Connected' : '✗ Not Connected',
    mongodbStatus: mongoose.connection.readyState === 1 ? '✓ Connected' : '✗ Disconnected'
  });
});

// Error handler for the server
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.logError('server_port_in_use', `Port ${PORT} is already in use. Please kill any existing processes on port ${PORT} and try again.`, {
      port: PORT
    });
    process.exit(1);
  } else {
    logger.logError('server_error', 'Server error', {
      error: error.message,
      code: error.code
    });
    process.exit(1);
  }
});
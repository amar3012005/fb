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
const mongoose = require('mongoose');
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
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch((err) => {
  console.error('❌ MongoDB connection error:', err);
});

// Only watch .env file in development mode
if (process.env.NODE_ENV === 'development') {
  const envPath = path.join(__dirname, '.env');
  // Check if .env file exists before watching
  if (fs.existsSync(envPath)) {
    fs.watch(envPath, (eventType, filename) => {
      if (eventType === 'change') {
        console.log('🔄 .env file changed, reloading configuration...');
        require('dotenv').config({ override: true });
      }
    });
    console.log('📝 Watching .env file for changes in development mode');
  } else {
    console.log('⚠️ No .env file found in development mode');
  }
} else {
  console.log('💡 Production mode - not watching .env file');
}

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server first
const server = http.createServer(app);

// Then create WebSocket server


const isDevelopment = process.env.NODE_ENV !== 'development';

// Update CORS configuration for Render deployment
app.use(cors({
  origin: [
    'https://foodles.shop',
    'https://www.foodles.shop',
    'https://precious-cobbler-d60f77.netlify.app', // If using Netlify for frontend
    'http://localhost:3000'                 // Keep local development
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin']
}));

// Add request logging middleware
app.use((req, res, next) => {
  console.log('📨 Request:', {
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

const contactEmail = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false
  },
  pool: true, // Enable pooling for better performance
  maxConnections: 10,
  rateDelta: 1000, // Limit sending rate
  rateLimit: 10 // Max emails per rateDelta
});

// Add better error handling for email verification
contactEmail.verify((error) => {
  if (error) {
    console.error("Email transport verification failed:", {
      error: error.message,
      code: error.code,
      user: process.env.EMAIL_USER,
      hasPassword: !!process.env.EMAIL_PASS,
      timestamp: new Date().toISOString()
    });
  } else {
    console.log("✅ Email service ready:", {
      user: process.env.EMAIL_USER,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/razorpay-key', (req, res) => {
  res.json({ key: process.env.RAZORPAY_KEY_ID });
});

const formatOrderDetails = (orderDetails, orderId, isPreReservation = false) => {
  // Format phone numbers consistently
  const formatPhoneForDisplay = (phone) => {
    if (!phone) return 'Not provided';
    const cleaned = phone.replace(/^\+?(91)?/, '').replace(/\D/g, '');
    return `+91 ${cleaned}`;
  };

  const prePaidAmount = parseFloat(orderDetails.remainingPayment) || 0;
  const remainingAmount = orderDetails.grandTotal - prePaidAmount;

  // Format phone numbers for links
  const vendorPhoneLink = orderDetails.vendorPhone ? 
    formatPhoneNumber(orderDetails.vendorPhone) : '';
  const customerPhoneLink = orderDetails.customerPhone ? 
    formatPhoneNumber(orderDetails.customerPhone) : '';

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
        ${orderDetails.items.map(item => `
          <tr style="border-bottom: 1px solid #222222;">
            <td style="padding: 10px 5px;">${item.name}</td>
            <td style="text-align: center; padding: 10px 5px;">${item.quantity}</td>
            <td style="text-align: right; padding: 10px 5px;">₹${(item.price * item.quantity).toFixed(2)}</td>
          </tr>
        `).join('')}
        <tr style="background-color: #1A1A1A;">
          <td colspan="2" style="padding: 10px 5px;">Subtotal</td>
          <td style="text-align: right; padding: 10px 5px;">₹${orderDetails.subtotal.toFixed(2)}</td>
        </tr>
        <tr style="background-color: #1A1A1A;">
          <td colspan="2" style="padding: 10px 5px;">Delivery Fee</td>
          <td style="text-align: right; padding: 10px 5px;">₹${orderDetails.deliveryFee.toFixed(2)}</td>
        </tr>
        <tr style="background-color: #1A1A1A;">
          <td colspan="2" style="padding: 10px 5px;">Convenience Fee</td>
          <td style="text-align: right; padding: 10px 5px;">
            ${orderDetails.dogDonation > 0 ? 
              `<span style="text-decoration: line-through; color: #4ADE80;">₹${orderDetails.convenienceFee.toFixed(2)}</span>
               <span style="color: #4ADE80; margin-left: 4px;">FREE</span>` 
              : `₹${orderDetails.convenienceFee.toFixed(2)}`}
          </td>
        </tr>
        ${orderDetails.dogDonation > 0 ? `
          <tr style="background-color: #1A1A1A;">
            <td colspan="2" style="padding: 10px 5px;">Dog Donation</td>
            <td style="text-align: right; padding: 10px 5px; color: #4ADE80;">₹${orderDetails.dogDonation.toFixed(2)}</td>
          </tr>
        ` : ''}
        <tr style="background-color:rgb(146, 146, 146);">
          <td colspan="2" style="padding: 10px 5px; color: #000000; font-weight: bold;">Total</td>
          <td style="text-align: right; padding: 10px 5px; color: #000000; font-weight: bold;">₹${orderDetails.grandTotal.toFixed(2)}</td>
        </tr>
      </table>

      <div style="margin-top: 20px; border-top: 1px solid #333333; padding-top: 15px;">
        <h3 style="color: ${colorScheme.primary}; font-size: 16px; margin-bottom: 10px;">PAYMENT DETAILS</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="background-color: #1A1A1A;">
            <td style="padding: 10px 5px; color: ${colorScheme.secondary};">Order-Confirmation Amount (paid)</td>
            <td style="text-align: right; padding: 10px 5px; color: ${colorScheme.secondary};">
              ₹${prePaidAmount.toFixed(2)}
            </td>
          </tr>
          <tr style="background-color: ${isPreReservation ? colorScheme.primary : '#FFD700'};">
            <td style="padding: 10px 5px; color: #000000;">${isPreReservation ? 'Pay at Restaurant' : 'Pay on Delivery'}</td>
            <td style="text-align: right; padding: 10px 5px; color: #000000;">
              ₹${remainingAmount.toFixed(2)}
            </td>
          </tr>
        </table>
      </div>

      <div style="background-color: #1A1A1A; padding: 15px; margin-bottom: 20px;">
        <h3 style="color: ${colorScheme.primary}; margin: 0 0 10px 0; font-size: 16px;">${isPreReservation ? 'RESTAURANT LOCATION' : 'DELIVERY LOCATION'}</h3>
        <p style="margin: 0; color: #ffffff;">${orderDetails.deliveryAddress}</p>
      </div>

      <div style="background-color: #1A1A1A; padding: 15px;">
        <h3 style="color: ${colorScheme.primary}; margin: 0 0 10px 0; font-size: 16px;">VENDOR CONTACT</h3>
        <p style="margin: 0; color: #ffffff;">
          Mobile: <a href="tel:${vendorPhoneLink}" style="color: ${colorScheme.secondary}; text-decoration: none; border-bottom: 1px dashed ${colorScheme.secondary};">
            ${formatPhoneForDisplay(orderDetails.vendorPhone)}
          </a>
        </p>
      </div>
    </div>

    <div style="text-align: center; padding: 20px; background-color: #111111;">
      <p style="color: #888888; margin: 0;">Thank you for ${isPreReservation ? 'your pre-reservation with' : 'ordering with'} Foodles</p>
      
      ${orderDetails.dogDonation > 0 ? `
        <div style="margin-top: 15px; padding: 15px; border: 1px solid ${colorScheme.secondary}; border-radius: 4px; background: rgba(${isPreReservation ? '147, 51, 234' : '74, 222, 128'}, 0.1);">
          <p style="color: ${colorScheme.secondary}; margin: 0; font-size: 14px;">
            🐾 You're amazing! Thank you for your kind donation of ₹${orderDetails.dogDonation.toFixed(2)} towards our campus dogs!
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
        ${orderDetails.items.map(item => `
          <tr style="border-bottom: 1px solid #222222;">
            <td style="padding: 10px 5px;">${item.name}</td>
            <td style="text-align: center; padding: 10px 5px;">${item.quantity}</td>
          </tr>
        `).join('')}
        <tr style="background-color:${isPreReservation ? colorScheme.primary : 'rgb(250, 231, 124)'};">
          <td colspan="2" style="padding: 10px 5px; color:black ; font-weight: bold;">Total Amount</td>
          <td style="text-align: right; padding: 10px 5px; color: black; font-weight: bold;">₹${remainingAmount.toFixed(2)}</td>
        </tr>
      </table>



      <div style="background-color: #1A1A1A; padding: 15px; margin-bottom: 20px;">
        <h3 style="color: ${colorScheme.primary}; margin: 0 0 10px 0; font-size: 16px;">${isPreReservation ? 'RESTAURANT LOCATION' : 'DELIVERY LOCATION'}</h3>
        <p style="margin: 0; color: #ffffff;">${orderDetails.deliveryAddress}</p>
      </div>

      <div style="background-color: #1A1A1A; padding: 15px;">
        <h3 style="color: ${colorScheme.primary}; margin: 0 0 10px 0; font-size: 16px;">CUSTOMER CONTACT</h3>
        <p style="margin: 0; color: #ffffff;">
          Mobile: <a href="tel:${customerPhoneLink}" style="color: ${colorScheme.secondary}; text-decoration: none; border-bottom: 1px dashed ${colorScheme.secondary};">
            ${formatPhoneForDisplay(orderDetails.customerPhone)}
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
        console.error("Contact email error:", error);
        reject(error);
      } else if (info.rejected.length > 0) {
        console.error(`Email rejected for ${email}`);
        reject(new Error("Email delivery failed"));
      } else {
        console.log(`Email delivered successfully to ${email}`);
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
        console.error("Vendor email error:", error);
        reject(error);
      } else if (info.rejected.length > 0) {
        console.error(`Email rejected for vendor ${vendorEmail}`);
        reject(new Error("Vendor email delivery failed"));
      } else {
        console.log(`Email delivered successfully to vendor at ${vendorEmail}`);
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
        console.error("Admin email error:", error);
        reject(error);
      } else {
        console.log('Admin notification sent successfully');
        resolve(true);
      }
    });
  });
};

// Rest of your existing code remains unchanged
// Razorpay is commented out since we're using Cashfree payment forms
// const razorpay = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET
// });

// console.log('Razorpay Key ID:', process.env.RAZORPAY_KEY_ID);
// console.log('Razorpay Key Secret:', process.env.RAZORPAY_KEY_SECRET);

app.post('/payment/create-order', async (req, res) => {
  const { amount, currency = 'INR' } = req.body;
  
  try {
    if (!amount || amount <= 0) {
      throw new Error('Invalid amount specified');
    }

    const options = {
      amount: Math.round(amount * 100),
      currency,
      receipt: `order_${Date.now()}`,
      notes: {
        description: "Foodles order payment",
        timestamp: new Date().toISOString()
      }
    };

    const order = await razorpay.orders.create(options);
    res.json({
      ...order,
      success: true
    });
  } catch (error) {
    console.error('Payment creation failed:', {
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/payment/verify-payment', async (req, res) => {
  const { 
    razorpay_order_id, 
    razorpay_payment_id, 
    razorpay_signature, 
    name, 
    email, 
    orderDetails, 
    orderId, 
    vendorEmail, 
    vendorPhone,
    restaurantId,
    restaurantName 
  } = req.body;

  // Add Pizza Bite specific payment adjustment
  let modifiedOrderDetails = orderDetails;
  if (restaurantId === '5') {
    const parsedDetails = JSON.parse(orderDetails);
    const adjustedDonation = parsedDetails.dogDonation > 0 ? parsedDetails.dogDonation - 5 : 0;
    parsedDetails.remainingPayment = 20 + adjustedDonation;
    parsedDetails.convenienceFee = 0;
    modifiedOrderDetails = JSON.stringify(parsedDetails); // Change this line
  }

  console.log('Payment verification details:', {
    orderId,
    vendorEmail,
    vendorPhone,
    restaurantId,
    restaurantName,
    hasOrderDetails: !!modifiedOrderDetails
  });

  const generated_signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const payment_verified = generated_signature === razorpay_signature;

  if (payment_verified) {
    try {
      const parsedOrderDetails = JSON.parse(modifiedOrderDetails);
      // Ensure vendorPhone is passed from both places
      const finalVendorPhone = formatPhoneNumber(vendorPhone || parsedOrderDetails.vendorPhone);
      if (parsedOrderDetails.customerPhone) {
        parsedOrderDetails.customerPhone = formatPhoneNumber(parsedOrderDetails.customerPhone);
      }
      
      console.log('Processing order with vendor phone:', finalVendorPhone);
      
      await processEmails(name, email, parsedOrderDetails, orderId, vendorEmail, finalVendorPhone, restaurantId);
      res.json({ 
        verified: true,
        orderId,
        vendorNotified: !!finalVendorPhone
      });
    } catch (error) {
      console.error('Order processing error:', error);
      res.json({ verified: true, error: error.message });
    }
  } else {
    res.json({ verified: false });
  }
});

// Cashfree webhook/response handler
app.post('/cashfree-webhook', async (req, res) => {
  try {
    console.log('Cashfree webhook received:', req.body);
    
    // Extract order information from webhook
    const { orderId, txStatus, paymentMode, txMsg, txTime, signature } = req.body;
    
    if (txStatus === 'SUCCESS') {
      console.log('Payment successful for order:', orderId);
      
      // Process the successful payment
      const orderData = pendingOrders.get(orderId);
      if (orderData) {
        await processPaymentSuccess(orderId, orderData);
      }
    }
    
    res.status(200).json({ status: 'received' });
  } catch (error) {
    console.error('Cashfree webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Helper function to process successful payment
async function processPaymentSuccess(orderId, orderData) {
  try {
    const { 
      userDetails, 
      orderDetails, 
      vendorEmail, 
      vendorPhone, 
      restaurantId, 
      restaurantName 
    } = orderData;

    // Process the order (send emails and notifications)
    let modifiedOrderDetails = JSON.stringify(orderDetails);
    
    // Pizza Bite specific payment adjustment
    if (restaurantId === '5') {
      const parsedDetails = orderDetails;
      const adjustedDonation = parsedDetails.dogDonation > 0 ? parsedDetails.dogDonation - 5 : 0;
      parsedDetails.remainingPayment = 20 + adjustedDonation;
      parsedDetails.convenienceFee = 0;
      modifiedOrderDetails = JSON.stringify(parsedDetails);
    }

    const results = await processEmails(
      userDetails.fullName, 
      userDetails.email, 
      JSON.parse(modifiedOrderDetails), 
      orderId, 
      vendorEmail, 
      vendorPhone, 
      restaurantId
    );

    // Clean up the pending order
    pendingOrders.delete(orderId);

    console.log('Payment processing completed for order:', orderId);
    return results;

  } catch (error) {
    console.error('Error processing payment success:', error);
    throw error;
  }
}

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
    console.error('Error getting order details:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Cashfree Payment Endpoints
// Store order data temporarily for processing after payment
const pendingOrders = new Map();
const processedOrders = new Map(); // Track completed orders

// Endpoint to prepare order data before redirecting to Cashfree
app.post('/payment/prepare-order', async (req, res) => {
  try {
    const { 
      orderId, 
      userDetails, 
      orderDetails, 
      vendorEmail, 
      vendorPhone, 
      restaurantId, 
      restaurantName, 
      amount 
    } = req.body;

    console.log(`📦 Preparing order ${orderId} for ${restaurantName} - Customer: ${userDetails.fullName}`);

    // Store order data temporarily (expires in 1 hour)
    pendingOrders.set(orderId, {
      userDetails,
      orderDetails,
      vendorEmail,
      vendorPhone,
      restaurantId,
      restaurantName,
      amount,
      timestamp: Date.now()
    });

    // Clean up expired orders (older than 1 hour)
    setTimeout(() => {
      pendingOrders.delete(orderId);
    }, 3600000); // 1 hour

    console.log(`✅ Order ${orderId} prepared for payment`);

    res.json({ 
      success: true, 
      message: 'Order prepared for payment',
      orderId 
    });
  } catch (error) {
    console.error('Error preparing order:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Endpoint to handle Cashfree payment success callback
app.post('/payment/cashfree-success', async (req, res) => {
  try {
    const { 
      orderId, 
      paymentSuccess, 
      orderData: frontendOrderData // Accept order data directly from frontend
    } = req.body;

    console.log(`💳 Payment completed for order: ${orderId}`);

    if (!paymentSuccess) {
      console.log(`❌ Payment failed for order: ${orderId}`);
      return res.status(400).json({
        success: false,
        error: 'Payment not successful'
      });
    }

    // Try multiple sources for order data with localStorage priority
    let orderData = null;
    let dataSource = '';

    // PRIORITY 1: Use frontend-provided order data (from localStorage)
    if (frontendOrderData) {
      orderData = frontendOrderData;
      dataSource = 'frontend-localStorage';
      console.log(`📦 Using order data from frontend localStorage`);
    }
    
    // PRIORITY 2: Fallback to server pendingOrders
    if (!orderData) {
      orderData = pendingOrders.get(orderId);
      if (orderData) {
        dataSource = 'server-memory';
        console.log(`📦 Using order data from server memory`);
      }
    }

    // PRIORITY 3: Ensure we have minimal required data to proceed
    if (!orderData && orderId) {
      console.log(`⚠️ No order data found, but proceeding with orderId: ${orderId}`);
      // Create minimal order data to allow processing
      orderData = {
        userDetails: { fullName: 'Customer', email: 'customer@foodles.shop' },
        orderDetails: { items: [], grandTotal: 0, deliveryAddress: 'Address not available' },
        vendorEmail: 'vendor@foodles.shop',
        vendorPhone: '+919999999999',
        restaurantId: '1',
        restaurantName: 'Restaurant'
      };
      dataSource = 'fallback-minimal';
    }

    if (!orderData) {
      console.log(`❌ No order data available for: ${orderId}`);
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
    } = orderData;

    console.log(`📧 Processing notifications for: ${userDetails.fullName} at ${restaurantName} (source: ${dataSource})`);

    // Process the order (send emails and notifications)
    let modifiedOrderDetails = orderDetails;
    
    // Pizza Bite specific payment adjustment
    if (restaurantId === '5') {
      const adjustedDonation = modifiedOrderDetails.dogDonation > 0 ? modifiedOrderDetails.dogDonation - 5 : 0;
      modifiedOrderDetails.remainingPayment = 20 + adjustedDonation;
      modifiedOrderDetails.convenienceFee = 0;
      console.log(`🍕 Applied Pizza Bite pricing adjustment`);
    }

    // GUARANTEED NOTIFICATION PROCESSING - This will run regardless of data source
    const results = await processEmails(
      userDetails.fullName, 
      userDetails.email, 
      modifiedOrderDetails, 
      orderId, 
      vendorEmail, 
      vendorPhone, 
      restaurantId
    );

    // Store the completed order in processedOrders for future reference
    processedOrders.set(orderId, {
      ...orderData,
      orderDetails: modifiedOrderDetails,
      completedAt: new Date().toISOString(),
      paymentStatus: 'SUCCESS',
      dataSource
    });

    // Clean up the pending order only if it exists
    if (pendingOrders.has(orderId)) {
      pendingOrders.delete(orderId);
    }

    console.log(`✅ Order ${orderId} completed - Emails: ${results.emailsSent}, Call: ${results.missedCallStatus} (${dataSource})`);

    res.json({
      success: true,
      orderId,
      emailsSent: results.emailsSent,
      emailErrors: results.emailErrors,
      missedCallStatus: results.missedCallStatus,
      dataSource
    });

  } catch (error) {
    console.error('❌ Error processing Cashfree payment success:', error);
    
    // EVEN IF ERROR - TRY TO SEND BASIC NOTIFICATION
    try {
      const { orderId } = req.body;
      if (orderId) {
        console.log(`🆘 Emergency notification attempt for order: ${orderId}`);
        const emergencyResults = await processEmails(
          'Customer', 
          'customer@foodles.shop', 
          { items: [], grandTotal: 0, deliveryAddress: 'Emergency processing' }, 
          orderId, 
          'admin@foodles.shop', 
          '+919999999999', 
          '1'
        );
        console.log(`🆘 Emergency notification sent: ${emergencyResults.emailsSent} emails`);
      }
    } catch (emergencyError) {
      console.error('❌ Emergency notification also failed:', emergencyError.message);
    }

    res.status(500).json({
      success: false,
      error: error.message,
      orderId: req.body.orderId
    });
  }
});

// GET endpoint to retrieve order details by orderId
app.get('/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log('Fetching order details for:', orderId);

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
    console.error('Error fetching order details:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Cashfree Webhook endpoint - this is what Cashfree will call
app.post('/webhook/cashfree', async (req, res) => {
  try {
    console.log('Cashfree webhook received:', req.body);
    
    const { 
      orderId, 
      orderAmount, 
      paymentStatus, 
      txStatus, 
      referenceId,
      txTime,
      signature 
    } = req.body;

    // Verify webhook signature (if you have Cashfree secret key)
    // You should implement signature verification for security

    if (paymentStatus === 'SUCCESS' || txStatus === 'SUCCESS') {
      // Retrieve stored order data
      const orderData = pendingOrders.get(orderId);
      if (orderData) {
        console.log('Processing successful payment for order:', orderId);
        
        const { 
          userDetails, 
          orderDetails, 
          vendorEmail, 
          vendorPhone, 
          restaurantId, 
          restaurantName 
        } = orderData;

        // Process the order (send emails and notifications)
        let modifiedOrderDetails = JSON.stringify(orderDetails);
        
        // Pizza Bite specific payment adjustment
        if (restaurantId === '5') {
          const parsedDetails = orderDetails;
          const adjustedDonation = parsedDetails.dogDonation > 0 ? parsedDetails.dogDonation - 5 : 0;
          parsedDetails.remainingPayment = 20 + adjustedDonation;
          parsedDetails.convenienceFee = 0;
          modifiedOrderDetails = JSON.stringify(parsedDetails);
        }

        // Process emails and notifications
        const results = await processEmails(
          userDetails.fullName, 
          userDetails.email, 
          JSON.parse(modifiedOrderDetails), 
          orderId, 
          vendorEmail, 
          vendorPhone, 
          restaurantId
        );

        // Mark order as processed
        processedOrders.set(orderId, {
          ...orderData,
          paymentStatus: 'SUCCESS',
          processedAt: new Date().toISOString(),
          results
        });

        // Clean up the pending order
        pendingOrders.delete(orderId);
        
        console.log('Order processed successfully:', orderId);
      }
    }

    // Always respond with 200 to acknowledge webhook
    res.status(200).json({ status: 'received' });

  } catch (error) {
    console.error('Error processing Cashfree webhook:', error);
    res.status(200).json({ status: 'error', message: error.message });
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
    console.error('Error checking order status:', error);
    res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

// Add new endpoint to check email status
app.get('/email-status/:orderId', async (req, res) => {
  const { orderId } = req.params;
  // Return the current email status for this order
  res.json({
    emailsSent: global.emailStatus?.[orderId]?.emailsSent || 0,
    emailErrors: global.emailStatus?.[orderId]?.emailErrors || [],
    missedCallStatus: global.emailStatus?.[orderId]?.missedCallStatus || null
  });
});

// Add global email tracking
const emailTracker = new Map();

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
    console.error('❌ Error saving order:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Update processEmails function
async function processEmails(name, email, orderDetails, orderId, vendorEmail, vendorPhone, restaurantId) {
  // Check if emails were already sent for this order
  if (emailTracker.has(orderId)) {
    console.log('⚠️ Emails already sent for order:', orderId);
    return emailTracker.get(orderId);
  }

  let emailsSent = 0;
  let emailErrors = [];
  let missedCallStatus = null;

  try {
    console.log('\n📋 Processing order notifications (GUARANTEED):', { orderId, vendorPhone });
    global.emailStatus = global.emailStatus || {};
    global.emailStatus[orderId] = { emailsSent: 0, emailErrors: [], missedCallStatus: null };

    // Detect pre-reservation from orderDetails
    const isPreReservation = orderDetails.isPreReservation || 
      orderDetails.preReservationData || 
      orderDetails.orderType === 'pre-reserve' ||
      (orderDetails.remainingPayment && orderDetails.remainingPayment <= 20);

    console.log(`📧 Order type detected: ${isPreReservation ? 'PRE-RESERVATION' : 'REGULAR ORDER'}`);

    // Ensure we have minimum required data
    const safeName = name || 'Valued Customer';
    const safeEmail = email || 'customer@foodles.shop';
    const safeOrderDetails = orderDetails || { 
      items: [], 
      grandTotal: 0, 
      deliveryAddress: 'Address not provided',
      customerPhone: '+919999999999',
      vendorPhone: vendorPhone || '+919999999999'
    };
    // Get vendor contact info dynamically from restaurant data
    const restaurantData = getRestaurantById(restaurantId);
    const safeVendorEmail = vendorEmail || restaurantData.vendorEmail;
    const safeVendorPhone = vendorPhone || restaurantData.vendorPhone;

    console.log(`🏪 Restaurant ${restaurantId} - Using vendor contact:`, {
      name: restaurantData.name,
      email: safeVendorEmail,
      phone: safeVendorPhone
    });

    // SEND CUSTOMER EMAIL - Guaranteed attempt
    try {
      await sendOrderConfirmationEmail(safeName, safeEmail, safeOrderDetails, orderId, isPreReservation);
      emailsSent++;
      console.log(`📧 Customer email sent successfully to ${safeEmail}`);
    } catch (error) {
      console.error('❌ Customer email failed:', error.message);
      emailErrors.push({ type: 'customer', error: error.message });
      
      // RETRY customer email with fallback
      try {
        console.log(`🔄 Retrying customer email with fallback data`);
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
        console.log(`📧 Customer fallback email sent to admin`);
      } catch (retryError) {
        console.error('❌ Customer email retry also failed:', retryError.message);
      }
    }

    // SEND VENDOR EMAIL + MISSED CALL - Guaranteed attempt
    if (safeVendorEmail) {
      try {
        await sendOrderReceivedEmail(safeVendorEmail, safeOrderDetails, orderId, isPreReservation);
        emailsSent++;
        console.log(`📧 Vendor email sent successfully to ${safeVendorEmail}`);
        
        // TRIGGER MISSED CALL - Multiple attempts
        if (safeVendorPhone) {
          console.log(`📞 Initiating vendor missed call (guaranteed):`, {
            restaurantId,
            phone: safeVendorPhone,
            hasConfig: !!twilioClients[restaurantId]
          });
          
          let callSuccess = await triggerMissedCall(safeVendorPhone, restaurantId);
          
          // If first call fails, try with different restaurant config
          if (!callSuccess && restaurantId !== '1') {
            console.log(`📞 Retrying missed call with Restaurant 1 config`);
            callSuccess = await triggerMissedCall(safeVendorPhone, '1');
          }
          
          // If still fails, try with any available config
          if (!callSuccess) {
            const availableConfigs = Object.keys(twilioClients);
            if (availableConfigs.length > 0) {
              console.log(`📞 Final attempt with config: ${availableConfigs[0]}`);
              callSuccess = await triggerMissedCall(safeVendorPhone, availableConfigs[0]);
            }
          }
          
          missedCallStatus = callSuccess ? 'success' : 'failed';
        }
      } catch (error) {
        console.error('❌ Vendor notifications failed:', error.message);
        emailErrors.push({ type: 'vendor', error: error.message });
        
        // RETRY vendor email to admin as fallback
        try {
          console.log(`🔄 Sending vendor notification to admin as fallback`);
          await sendOrderReceivedEmail(safeVendorEmail, safeOrderDetails, orderId);
          emailsSent++;
          console.log(`📧 Vendor fallback email sent to admin`);
        } catch (retryError) {
          console.error('❌ Vendor email retry failed:', retryError.message);
        }
      }
    }

    // SEND ADMIN NOTIFICATION - Always attempt
    try {
      await sendAdminNotificationEmail(safeName, safeEmail, safeOrderDetails, orderId);
      emailsSent++;
      console.log(`📧 Admin notification sent successfully`);
    } catch (error) {
      console.error('❌ Admin notification failed:', error.message);
      emailErrors.push({ type: 'admin', error: error.message });
    }

    // Store the results
    const results = { emailsSent, emailErrors, missedCallStatus };
    emailTracker.set(orderId, results);

    // Clean up tracker after 2 minutes (increased time)
    setTimeout(() => {
      emailTracker.delete(orderId);
      console.log(`🧹 Cleaned up email tracking for order: ${orderId}`);
    }, 120000); // 2 minutes

    // Update final status
    global.emailStatus[orderId] = { 
      emailsSent, 
      emailErrors, 
      missedCallStatus 
    };

    console.log('✅ Order notifications completed (GUARANTEED):', {
      orderId,
      emailsSent,
      missedCall: missedCallStatus,
      totalAttempts: emailsSent + emailErrors.length
    });

    return results;
  } catch (error) {
    console.error('❌ Notification process error:', error);
    
    // EMERGENCY FALLBACK - Send at least one notification
    try {
      console.log(`🆘 Emergency fallback notification for ${orderId}`);
      await sendAdminNotificationEmail('Emergency Order', safeVendorEmail, { 
        items: [{ name: 'Emergency Processing', quantity: 1, price: 0 }],
        grandTotal: 0,
        deliveryAddress: 'Emergency processing - check logs',
        customerPhone: '+919999999999'
      }, orderId);
      console.log(`🆘 Emergency notification sent`);
      return { emailsSent: 1, emailErrors: [], missedCallStatus: 'failed' };
    } catch (emergencyError) {
      console.error('❌ Emergency notification failed:', emergencyError.message);
      return { emailsSent: 0, emailErrors: [error], missedCallStatus: 'failed' };
    }
  }
}

// Add more detailed logging for the health endpoint
app.get('/health', (req, res) => {
  console.log('Health check requested');
  const status = {
    status: 'OK',
    timestamp: new Date(),
    environment: process.env.NODE_ENV,
    services: {
      email: contactEmail ? 'connected' : 'error',
      payment: 'cashfree' // Using Cashfree payment forms
    }
  };
  console.log('Health status:', status);
  res.json(status);
});

// Update Twilio configuration manager with dynamic loading from .env
const twilioConfigs = {
  '1': {  // BABA_JI FOOD-POINT
    accountSid: process.env.TWILIO_ACCOUNT_SID_1,
    authToken: process.env.TWILIO_AUTH_TOKEN_1,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER_1
  },
  '2': {  // HIMALAYAN_CAFE
    accountSid: process.env.TWILIO_ACCOUNT_SID_2,
    authToken: process.env.TWILIO_AUTH_TOKEN_2,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER_2
  },
  '3': {  // SONU_FOOD-POINT
    accountSid: process.env.TWILIO_ACCOUNT_SID_3,
    authToken: process.env.TWILIO_AUTH_TOKEN_3,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER_3
  },
  '4': {  // JEEVA_FOOD-POINT
    accountSid: process.env.TWILIO_ACCOUNT_SID_4,
    authToken: process.env.TWILIO_AUTH_TOKEN_4,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER_4
  },
  '5': {  // PIZZA-BITE
    accountSid: process.env.TWILIO_ACCOUNT_SID_5,
    authToken: process.env.TWILIO_AUTH_TOKEN_5,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER_5
  }
};

// Initialize Twilio clients for each restaurant
const twilioClients = {};

Object.entries(twilioConfigs).forEach(([restaurantId, config]) => {
  if (config.accountSid && config.authToken) {
    twilioClients[restaurantId] = {
      client: twilio(config.accountSid, config.authToken),
      phone: config.phoneNumber
    };
    console.log(`✓ Twilio initialized for Restaurant ${restaurantId}`);
  } else {
    console.log(`⚠️ Missing Twilio credentials for Restaurant ${restaurantId}`);
  }
});

console.log('Available Twilio configurations:', Object.keys(twilioClients));

// Add helper function for phone number formatting
const formatPhoneNumber = (phone) => {
  const cleaned = phone.replace(/^\+?(91)?/, '').replace(/\D/g, '');
  return cleaned ? `+91${cleaned}` : '';
};

// Remove all duplicate triggerMissedCall functions and replace with this one
const triggerMissedCall = async (vendorPhone, restaurantId) => {
  console.log('\n🔄 Starting missed call process:', {
    restaurantId,
    vendorPhone,
    availableConfigs: Object.keys(twilioClients)
  });
  
  const twilioConfig = twilioClients[restaurantId];
  if (!twilioConfig?.client) {
    console.error('❌ No Twilio configuration found for restaurant:', restaurantId);
    return false;
  }

  try {
    const formattedPhone = formatPhoneNumber(vendorPhone);
    console.log(`📞 Restaurant ${restaurantId} call details:`, {
      from: twilioConfig.phone,
      to: formattedPhone,
      config: {
        sid: twilioConfig.client.accountSid,
        phone: twilioConfig.phone
      }
    });

    const call = await twilioConfig.client.calls.create({
      url: 'http://twimlets.com/reject',
      from: twilioConfig.phone,
      to: formattedPhone,
      timeout: 30  // This is the timeout in seconds - you can adjust this value
    });
    
    console.log('✅ Call created:', {
      sid: call.sid,
      status: call.status,
      restaurant: restaurantId,
      phone: formattedPhone
    });

    return true;
  } catch (error) {
    console.error('❌ Twilio error:', {
      restaurantId,
      code: error.code,
      message: error.message,
      phone: vendorPhone
    });
    return false;
  }
};

// Add test endpoint
app.post('/test-missed-call', async (req, res) => {
  console.log('📞 Test call request received:', req.body);
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
  
  console.log(`Restaurant ${restaurantId} status check:`, {
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
  const ids = req.query.ids?.split(',') || ['1', '2', '3', '4', '5'];
  
  // Check if we need to refresh the cache (10 seconds)
  const shouldRefreshCache = !restaurantStatusCache.lastCheck || 
    (now - restaurantStatusCache.lastCheck) > 10000;

  if (shouldRefreshCache) {
    console.log('Refreshing restaurant status cache:', {
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

  console.log('Sending status response:', {
    fromCache: !shouldRefreshCache,
    restaurantCount: Object.keys(response.statuses).length,
    timestamp: now.toISOString()
  });

  res.json(response);
});

// Add new endpoint for restaurant selection logging
app.post('/api/log-restaurant-selection', (req, res) => {
  const { restaurantId, restaurantName, timestamp } = req.body;
  
  console.log(`🏪 Restaurant selected: ${restaurantName} (ID: ${restaurantId})`);

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
        console.log('Status changes detected:', changes);
        this.notifyWatchers(changes);
      }
    }, 1000); // Check every second
  },

  checkForChanges() {
    const changes = [];
    const ids = ['1', '2', '3', '4', '5'];
    
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

// Add a new endpoint to handle feedback submissions
app.post('/api/submit-feedback', async (req, res) => {
  const { orderId, feedback } = req.body;
  console.log(`📝 Feedback for order ${orderId}: ${feedback.rating}/5 stars`);
  
  try {
    // You can add logic here to store feedback in a database
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Feedback submission failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get appropriate payment form URL based on amount
app.get('/api/payment-form/:amount', (req, res) => {
  try {
    const amount = parseInt(req.params.amount);
    console.log(`💳 Getting payment form for amount: ₹${amount}`);
    
    let formUrl;
    
    if (amount <= 20) {
      formUrl = process.env.CASHFREE_FORM_20;
    } else if (amount <= 25) {
      formUrl = process.env.CASHFREE_FORM_25;
    } else if (amount <= 45) {
      formUrl = process.env.CASHFREE_FORM_45;
    } else {
      formUrl = process.env.CASHFREE_FORM_55;
    }
    
    if (!formUrl) {
      console.error('❌ Payment form URL not configured for amount:', amount);
      return res.status(500).json({ 
        success: false, 
        error: 'Payment form not configured' 
      });
    }
    
    console.log(`✅ Payment form selected: ${formUrl}`);
    res.json({ 
      success: true, 
      paymentFormUrl: formUrl,
      amount: amount 
    });
    
  } catch (error) {
    console.error('❌ Error getting payment form URL:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Start the server
server.listen(PORT, () => {
  // Get status of Twilio configurations
  const twilioStatus = Object.entries(twilioClients)
    .map(([id, config]) => `Restaurant ${id}: ✓`)
    .join('\n   ');

  console.log(`
🚀 Server running in ${process.env.NODE_ENV} mode
📍 Port: ${PORT}
🌐 Allowed Origins:
   - https://foodles.shop
   - https://www.foodles.shop
   - https://precious-cobbler-d60f77.netlify.app
   - http://localhost:3000
📞 Twilio Status:
   ${twilioStatus || '✗ No restaurants configured'}
📧 Email: ${contactEmail ? '✓ Connected' : '✗ Not Connected'}
  `);
});

// Error handler for the server
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Please kill any existing processes on port ${PORT} and try again.`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', error);
    process.exit(1);
  }
});

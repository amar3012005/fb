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

const formatOrderDetails = (orderDetails, orderId) => {
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

  const userEmailTemplate = `
  <div style="background-color: #000000; color: #ffffff; font-family: 'Arial', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #111111; border-left: 4px solid #FFD700; padding: 20px; margin-bottom: 20px;">
      <h1 style="color: #FFD700; margin: 0; font-size: 24px;">ORDER CONFIRMED</h1>
      <p style="color: #888888; margin: 5px 0;">Order ID: #${orderId}</p>
    </div>

    <div style="background-color: #111111; padding: 20px; margin-bottom: 20px;">
      <div style="border-bottom: 1px solid #333333; padding-bottom: 10px; margin-bottom: 15px;">
        <h2 style="color: #FFD700; font-size: 18px; margin: 0;">ORDER DETAILS</h2>
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
        <h3 style="color: #FFD700; font-size: 16px; margin-bottom: 10px;">PAYMENT DETAILS</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="background-color: #1A1A1A;">
            <td style="padding: 10px 5px; color: #4ADE80;">Order-Confirmation Amount (paid)</td>
            <td style="text-align: right; padding: 10px 5px; color: #4ADE80;">
              ₹${prePaidAmount.toFixed(2)}
            </td>
          </tr>
          <tr style="background-color: #FFD700;">
            <td style="padding: 10px 5px; color: #000000;">Pay on Delivery</td>
            <td style="text-align: right; padding: 10px 5px; color: #000000;">
              ₹${remainingAmount.toFixed(2)}
            </td>
          </tr>
        </table>
      </div>

      <div style="background-color: #1A1A1A; padding: 15px; margin-bottom: 20px;">
        <h3 style="color: #FFD700; margin: 0 0 10px 0; font-size: 16px;">DELIVERY LOCATION</h3>
        <p style="margin: 0; color: #ffffff;">${orderDetails.deliveryAddress}</p>
      </div>

      <div style="background-color: #1A1A1A; padding: 15px;">
        <h3 style="color: #FFD700; margin: 0 0 10px 0; font-size: 16px;">VENDOR CONTACT</h3>
        <p style="margin: 0; color: #ffffff;">
          Mobile: <a href="tel:${vendorPhoneLink}" style="color: #4ADE80; text-decoration: none; border-bottom: 1px dashed #4ADE80;">
            ${formatPhoneForDisplay(orderDetails.vendorPhone)}
          </a>
        </p>
      </div>
    </div>

    <div style="text-align: center; padding: 20px; background-color: #111111;">
      <p style="color: #888888; margin: 0;">Thank you for ordering with Foodles</p>
      
      ${orderDetails.dogDonation > 0 ? `
        <div style="margin-top: 15px; padding: 15px; border: 1px solid #4ADE80; border-radius: 4px; background: rgba(74, 222, 128, 0.1);">
          <p style="color: #4ADE80; margin: 0; font-size: 14px;">
            🐾 You're amazing! Thank you for your kind donation of ₹${orderDetails.dogDonation.toFixed(2)} towards our campus dogs!
            <span style="display: block; margin-top: 5px; font-size: 12px; opacity: 0.8;">
              Your generosity helps us provide better care for our furry friends. We'll keep you updated on how your contribution makes a difference.
            </span>
          </p>
        </div>
      ` : ''}
      
      <!-- Share Your Thoughts Button -->
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #333;">
        <p style="color: #FFD700; font-size: 14px; margin-bottom: 15px;">Your feedback helps us improve!</p>
        <a href="https://docs.google.com/forms/d/e/1FAIpQLScXZaSqfIz6wFzA_-KtJ5bxM65E_wfJArZyMb_NOYNoaT1I5w/viewform?usp=sharing" 
           style="display: inline-block;
                  background: #FFD700;
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
    <div style="background-color: #111111; border-left: 4px solid #FFD700; padding: 20px; margin-bottom: 20px;">
      <h1 style="color: #FFD700; margin: 0; font-size: 24px;">NEW ORDER_${orderId} RECEIVED</h1>
      <p style="color: #888888; margin: 5px 0;">Order ID: #${orderId}</p>
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
        <tr style="background-color:rgb(250, 231, 124);">
          <td colspan="2" style="padding: 10px 5px; color:black ; font-weight: bold;">Total Amount</td>
          <td style="text-align: right; padding: 10px 5px; color: black; font-weight: bold;">₹${remainingAmount.toFixed(2)}</td>
        </tr>
      </table>



      <div style="background-color: #1A1A1A; padding: 15px; margin-bottom: 20px;">
        <h3 style="color: #FFD700; margin: 0 0 10px 0; font-size: 16px;">DELIVERY LOCATION</h3>
        <p style="margin: 0; color: #ffffff;">${orderDetails.deliveryAddress}</p>
      </div>

      <div style="background-color: #1A1A1A; padding: 15px;">
        <h3 style="color: #FFD700; margin: 0 0 10px 0; font-size: 16px;">CUSTOMER CONTACT</h3>
        <p style="margin: 0; color: #ffffff;">
          Mobile: <a href="tel:${customerPhoneLink}" style="color: #4ADE80; text-decoration: none; border-bottom: 1px dashed #4ADE80;">
            ${formatPhoneForDisplay(orderDetails.customerPhone)}
          </a>
        </p>
      </div>
    </div>

    <div style="text-align: center; padding: 20px; background-color: #111111;">
      <p style="color: #888888; margin: 0;">Please prepare the order for delivery</p>
    </div>
  </div>
  `;

  return { userEmailTemplate, vendorEmailTemplate };
};

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const sendOrderConfirmationEmail = (name, email, orderDetails, orderId) => {
  return new Promise((resolve, reject) => {
    if (!isValidEmail(email)) {
      reject(new Error("Invalid customer email address"));
      return;
    }

    const { userEmailTemplate } = formatOrderDetails(orderDetails, orderId);

    const mail = {
      from: {
        name: 'Foodles Orders',
        address: process.env.EMAIL_USER
      },
      to: email,
      subject: `Order Confirmed: #${orderId} - Foodles`,
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

const sendOrderReceivedEmail = (vendorEmail, orderDetails, orderId) => {
  return new Promise((resolve, reject) => {
    if (!isValidEmail(vendorEmail)) {
      reject(new Error("Invalid vendor email address"));
      return;
    }

    const { vendorEmailTemplate } = formatOrderDetails(orderDetails, orderId);

    const mail = {
      from: {
        name: 'Foodles Vendor Orders',
        address: process.env.EMAIL_USER
      },
      to: vendorEmail,
      subject: `New Order: #${orderId} - Action Required`,
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

    console.log('Preparing order for Cashfree payment:', {
      orderId,
      amount,
      restaurantId,
      restaurantName
    });

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
    const { orderId, paymentSuccess } = req.body;

    console.log('Processing Cashfree payment success:', {
      orderId,
      paymentSuccess
    });

    if (!paymentSuccess) {
      return res.status(400).json({
        success: false,
        error: 'Payment not successful'
      });
    }

    // Retrieve stored order data
    const orderData = pendingOrders.get(orderId);
    if (!orderData) {
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

    res.json({
      success: true,
      orderId,
      emailsSent: results.emailsSent,
      emailErrors: results.emailErrors,
      missedCallStatus: results.missedCallStatus
    });

  } catch (error) {
    console.error('Error processing Cashfree payment success:', error);
    res.status(500).json({
      success: false,
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
    console.log('\n📋 Processing order notifications:', { orderId, vendorPhone });
    global.emailStatus = global.emailStatus || {};
    global.emailStatus[orderId] = { emailsSent: 0, emailErrors: [], missedCallStatus: null };

    // Send customer email
    try {
      await sendOrderConfirmationEmail(name, email, orderDetails, orderId);
      emailsSent++;
      console.log(`📧 Customer email sent successfully to ${email}`);
    } catch (error) {
      console.error('❌ Customer email failed:', error.message);
      emailErrors.push({ type: 'customer', error: error.message });
    }

    // Send vendor notifications
    if (vendorEmail) {
      try {
        await sendOrderReceivedEmail(vendorEmail, orderDetails, orderId);
        emailsSent++;
        console.log(`📧 Vendor email sent successfully to ${vendorEmail}`);
        
        // Trigger missed call after vendor email success
        if (vendorPhone) {
          console.log(`📞 Initiating vendor missed call:`, {
            restaurantId,
            phone: vendorPhone,
            hasConfig: !!twilioClients[restaurantId]
          });
          
          const callSuccess = await triggerMissedCall(vendorPhone, restaurantId);
          missedCallStatus = callSuccess ? 'success' : 'failed';
        }
      } catch (error) {
        console.error('❌ Vendor notifications failed:', error.message);
        emailErrors.push({ type: 'vendor', error: error.message });
      }
    }

    // Send admin notification
    try {
      await sendAdminNotificationEmail(name, email, orderDetails, orderId);
      emailsSent++;
      console.log(`📧 Admin notification sent successfully`);
    } catch (error) {
      console.error('❌ Admin notification failed:', error.message);
      emailErrors.push({ type: 'admin', error: error.message });
    }

    // Store the results
    const results = { emailsSent, emailErrors, missedCallStatus };
    emailTracker.set(orderId, results);

    // Clean up tracker after 1 minute
    setTimeout(() => {
      emailTracker.delete(orderId);
      console.log(`🧹 Cleaned up email tracking for order: ${orderId}`);
    }, 60000); // 60 seconds

    // Update final status
    global.emailStatus[orderId] = { 
      emailsSent, 
      emailErrors, 
      missedCallStatus 
    };

    console.log('✅ Order notifications completed:', {
      orderId,
      emailsSent,
      missedCall: missedCallStatus
    });

    return results;
  } catch (error) {
    console.error('❌ Notification process error:', error);
    return { emailsSent: 0, emailErrors: [error], missedCallStatus: 'failed' };
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
  
  console.log('\n🏪 Restaurant Selected:', {
    restaurantId,
    restaurantName,
    timestamp
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
  console.log('📝 Feedback received:', { orderId, feedback });
  
  try {
    // You can add logic here to store feedback in a database
    res.json({ success: true });
  } catch (error) {
    console.error('Feedback submission failed:', error);
    res.status(500).json({ success: false, error: error.message });
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
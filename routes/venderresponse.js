// vendorresponse.js
const express = require('express');
const twilio = require('twilio');
const router = express.Router();

// Load environment variables (if using dotenv)
require('dotenv').config();

// Twilio credentials
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// Initialize Twilio client
const client = new twilio(twilioAccountSid, twilioAuthToken);

// Route to send SMS to the vendor
router.post('/send-sms', (req, res) => {
  const { vendorPhoneNumber, orderId } = req.body; // Vendor's phone number and order ID

  // Send SMS to the vendor
  client.messages
    .create({
      body: `You have a new order! Order ID: ${orderId}. Reply 'ACCEPT' to confirm or 'DECLINE' to reject.`,
      from: twilioPhoneNumber,
      to: +916301805656,
    })
    .then(message => {
      console.log(`SMS sent to ${vendorPhoneNumber}: ${message.sid}`);
      res.status(200).json({ message: 'SMS sent successfully' });
    })
    .catch(error => {
      console.error('Error sending SMS:', error);
      res.status(500).json({ error: 'Failed to send SMS' });
    });
});

module.exports = router;

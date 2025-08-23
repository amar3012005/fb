require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const contactEmail = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

contactEmail.verify((error) => {
  if (error) {
    console.error("Email transport verification failed:", error);
  } else {
    console.log("Email service ready");
  }
});

router.post("/contact", (req, res) => {
  const { name, receiverEmail, orderDetails } = req.body;

  // Validate required fields
  if (!receiverEmail || !name || !orderDetails) {
    return res.status(400).json({ 
      status: "ERROR", 
      message: "Missing required fields" 
    });
  }

  const mail = {
    from: process.env.EMAIL_USER,
    to: receiverEmail,
    subject: "Order Confirmation",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #333;">Order Confirmation</h2>
        <p style="color: #555;">Dear ${name},</p>
        <p style="color: #555;">Thank you for your order! Here are your order details:</p>
        <div style="background-color: #f9f9f9; padding: 10px; border-radius: 5px; margin-bottom: 20px;">
          <pre style="white-space: pre-wrap; color: #555;">${orderDetails}</pre>
        </div>
        <p style="color: #555;">We appreciate your business and hope you enjoy your meal!</p>
        <p style="color: #555;">Best regards,</p>
        <p style="color: #555;">Foodles Team</p>
      </div>
    `,
  };

  contactEmail.sendMail(mail, (error) => {
    if (error) {
      console.error("Email sending failed:", error);
      res.status(500).json({ 
        status: "ERROR", 
        message: error.message 
      });
    } else {
      console.log(`Email sent successfully to ${receiverEmail}`);
      res.json({ status: "Message Sent" });
    }
  });
});

module.exports = router;

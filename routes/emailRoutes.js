const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

const contactEmail = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

contactEmail.verify((error) => {
  if (error) {
    console.log("Email verification error:", error);
  } else {
    console.log("Ready to Send");
  }
});

function generateOrderConfirmationEmail(name, orderDetails) {
  const cssUrl = `${process.env.REACT_APP_BACKEND_URL}/static/email-template.css`;

  const itemsList = Array.isArray(orderDetails.items) ? orderDetails.items.map(item => `
    <tr>
      <td>${item.name}</td>
      <td>${item.quantity}</td>
      <td>₹${(item.price * item.quantity).toFixed(2)}</td>
    </tr>`).join('') : '';

  const formattedOrderDetails = Array.isArray(orderDetails.items) ? orderDetails.items.map(item => `
    - ${item.name} x ${item.quantity}`).join(', ') : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Order Confirmation Preview</title>
    <link rel="stylesheet" href="${cssUrl}">
</head>
<body>
    <div class="email-container">
        <div class="background-pattern"></div>
        
        <div class="header">
            <div class="pulse-dot"></div>
            <h1 style="margin: 0; font-size: 24px;">ORDER CONFIRMATION</h1>
        </div>

        <p style="color: rgba(255,255,255,0.7);">Dear ${name},</p>

        <div style="background-color: rgba(25,25,25,0.8); border: 1px solid rgba(64,64,64,0.5); border-radius: 8px; padding: 25px; margin-bottom: 20px;">
            <h2 style="margin-bottom: 20px; font-size: 18px;">ORDER SUMMARY</h2>
            
            <table class="details-table">
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Quantity</th>
                        <th>Price</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsList}
                </tbody>
            </table>

            <table class="details-table">
                <tbody>
                    <tr>
                        <td>Subtotal</td>
                        <td>₹${orderDetails.subtotal.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td>Delivery Fee</td>
                        <td>₹${orderDetails.deliveryFee.toFixed(2)}</td>
                    </tr>
                    ${orderDetails.dogDonation > 0 ? `
                    <tr style="color: #4ade80; font-style: italic;">
                        <td>Dog Donation</td>
                        <td>₹${orderDetails.dogDonation.toFixed(2)}</td>
                    </tr>
                    ` : `
                    <tr>
                        <td>Convenience Fee</td>
                        <td>₹${orderDetails.convenienceFee.toFixed(2)}</td>
                    </tr>
                    `}
                </tbody>
            </table>

            <div class="total">
                <span>GRAND TOTAL</span>
                <span>₹${orderDetails.grandTotal.toFixed(2)}</span>
            </div>
        </div>

        <p style="color: rgba(255,255,255,0.7);">
          Order Details:
          ${formattedOrderDetails}
          - Total: ₹${orderDetails.grandTotal.toFixed(2)}
        </p>

        <div class="footer">
            <p>© 2025 Foodles | Order Tracking Available</p>
        </div>
    </div>
</body>
</html>`;
}

router.post("/contact", (req, res) => {
  const { name, email, message, receiverEmail, orderDetails } = req.body;

  // Use the structure from the frontend Checkout component
  const parsedOrderDetails = {
    items: orderDetails.items,
    subtotal: orderDetails.subtotal,
    deliveryFee: orderDetails.deliveryFee,
    convenienceFee: orderDetails.convenienceFee,
    dogDonation: orderDetails.dogDonation,
    grandTotal: orderDetails.grandTotal
  };

  const mail = {
    from: process.env.EMAIL_USER,
    to: receiverEmail,
    subject: "Order Confirmation",
    html: generateOrderConfirmationEmail(name, parsedOrderDetails),
  };

  // Save order details to a JSON file
  const orderDetailsPath = path.join(__dirname, "../order-details.json");
  fs.writeFileSync(orderDetailsPath, JSON.stringify(parsedOrderDetails, null, 2));

  contactEmail.sendMail(mail, (error, info) => {
    if (error) {
      console.error("Contact email error:", error);
      res.status(500).json({ status: "ERROR", message: error.message });
    } else {
      console.log("Email sent:", info.response);
      res.json({ status: "Message Sent" });
    }
  });
});

module.exports = router;

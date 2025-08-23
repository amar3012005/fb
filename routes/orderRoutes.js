const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// Fetch order details from JSON file
router.get('/order-details', (req, res) => {
  const orderDetailsPath = path.join(__dirname, "../order-details.json");
  if (fs.existsSync(orderDetailsPath)) {
    const orderDetails = JSON.parse(fs.readFileSync(orderDetailsPath, "utf8"));
    res.json(orderDetails);
  } else {
    res.status(404).json({ status: "ERROR", message: "Order details not found" });
  }
});

module.exports = router;

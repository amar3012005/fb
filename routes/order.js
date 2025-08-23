const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  const { name, phoneNumber, address, items, totalAmount, paymentStatus } = req.body;

  try {
    // Simulate order saving (e.g., save to a database)
    console.log('Saving order:', { name, phoneNumber, address, items, totalAmount, paymentStatus });
    
    // Simulate success
    res.send('Order details saved successfully!');
  } catch (error) {
    console.error('Error saving order:', error);
    res.status(500).send('Error saving order.');
  }
});

module.exports = router;

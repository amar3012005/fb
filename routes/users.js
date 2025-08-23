const express = require('express');
const router = express.Router();
const { User } = require('../models'); // Import the User model

// POST route to save user information
router.post('/', async (req, res) => {
  try {
    const { fullName, rollNumber, email, phoneNumber, address } = req.body;

    // Validate the input
    if (!fullName || !rollNumber || !email || !phoneNumber || !address) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Create a new user
    const newUser = await User.create({
      fullName,
      rollNumber,
      email,
      phoneNumber,
      address,
    });

    res.status(201).json({ message: 'User information saved successfully', user: newUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save user information' });
  }
});

module.exports = router;

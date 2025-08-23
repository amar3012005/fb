const { User } = require('../models'); // Import the User model

// Create a new user
const createUser = async (req, res) => {
  try {
    const { fullName, rollNumber, email, phoneNumber, address } = req.body;

    // Create a new user record in the database
    const user = await User.create({
      fullName,
      rollNumber,
      email,
      phoneNumber,
      address,
    });

    return res.status(201).json({
      message: 'User created successfully',
      user,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Error creating user',
      error: error.message,
    });
  }
};

module.exports = { createUser };

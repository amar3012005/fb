const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  restaurantId: String,
  restaurantName: String,
  orderType: String,
  userDetails: {
    fullName: String,
    email: String,
    phone: String
  },
  orderDetails: {
    items: [
      {
        name: String,
        quantity: Number,
        price: Number
      }
    ],
    subtotal: Number,
    deliveryFee: Number,
    convenienceFee: Number,
    dogDonation: Number,
    grandTotal: Number,
    remainingPayment: Number,
    deliveryAddress: String,
    specialInstructions: String,
    isPreReservation: Boolean,
    deliveryTime: String
  },
  paymentStatus: { type: String, default: 'PENDING' },
  paymentId: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  amount: Number,
  totalOrderValue: Number,
  createdAt: { type: Date, default: Date.now },
  completedAt: Date
});

const userOrderSchema = new mongoose.Schema({
  email: { type: String, required: true },
  name: String,
  hostel: String,
  phone: { type: String, required: true },
  orders: [orderSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Create compound index for efficient querying by phone
userOrderSchema.index({ phone: 1, 'orders.createdAt': -1 });

module.exports = mongoose.model('UserOrder', userOrderSchema);

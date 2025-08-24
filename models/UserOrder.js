const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: String,
  restaurantId: String,
  restaurantName: String,
  orderType: String,
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
  isOfferZoneOrder: Boolean,
  preReserve: {
    active: Boolean,
    slotTime: Date,
    partySize: Number
  },
  grandTotal: Number,
  createdAt: { type: Date, default: Date.now }
});

const userOrderSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: String,
  hostel: String,
  phone: String,
  orders: [orderSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UserOrder', userOrderSchema);

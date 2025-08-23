const express = require('express');
const Razorpay = require('razorpay');
const router = express.Router();

// Initialize Razorpay with your credentials
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Payment verification route
router.get('/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;

        // Fetch payment details from Razorpay
        const payment = await razorpay.payments.fetch(paymentId);

        // Check payment status
        if (payment.status === 'captured' || payment.status === 'authorized') {
            res.json({
                status: 'captured',
                paymentDetails: {
                    id: payment.id,
                    amount: payment.amount / 100, // Convert from paise to rupees
                    currency: payment.currency,
                    method: payment.method,
                    captured_at: payment.captured_at
                }
            });
        } else {
            res.json({
                status: 'failed',
                message: 'Payment not captured'
            });
        }
    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

module.exports = router;
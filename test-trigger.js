const axios = require('axios');

// Test the trigger-notifications endpoint
async function testTriggerNotifications() {
  try {
    console.log('🧪 Testing /payment/trigger-notifications endpoint...');

    const testOrderData = {
      orderId: 'test_order_123',
      orderData: {
        userDetails: {
          fullName: 'Test Customer',
          email: 'test@example.com',
          phoneNumber: '+919999999999'
        },
        orderDetails: {
          items: [{ name: 'Test Item', quantity: 1, price: 100 }],
          subtotal: 100,
          deliveryFee: 20,
          convenienceFee: 10,
          dogDonation: 0,
          grandTotal: 130,
          remainingPayment: 20,
          deliveryAddress: 'Test Address',
          customerPhone: '+919999999999'
        },
        vendorEmail: 'vendor@example.com',
        vendorPhone: '+919999999998',
        restaurantId: '1',
        restaurantName: 'Test Restaurant'
      }
    };

    const response = await axios.post('http://localhost:5000/payment/trigger-notifications', testOrderData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Test successful:', response.data);

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testTriggerNotifications();
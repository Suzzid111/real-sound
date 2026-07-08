// api/cancel-payment.js
// Cancels a previously authorized PaymentIntent (releases the hold, never charges it).
// Call this when a healer clicks "Decline" on a booking request.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Missing paymentIntentId' });
    }

    const cancelled = await stripe.paymentIntents.cancel(paymentIntentId);

    return res.status(200).json({ status: cancelled.status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

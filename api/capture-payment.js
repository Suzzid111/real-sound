// api/capture-payment.js
// Captures (actually charges) a previously authorized PaymentIntent.
// Call this ONLY when a healer clicks "Accept" on a booking request.

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

    const captured = await stripe.paymentIntents.capture(paymentIntentId);

    return res.status(200).json({ status: captured.status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// api/create-payment-intent.js
// Creates a Stripe PaymentIntent with manual capture.
// This AUTHORIZES the card (holds the funds) but does NOT charge it yet.
// The charge only happens later when capture-payment.js runs (healer accepts).

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { amount, email, metadata } = req.body;

    if (!amount || amount < 50) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      capture_method: 'manual',
      receipt_email: email || undefined,
      metadata: metadata || {}
    });

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

import express from 'express'
import crypto from 'crypto'
import fetch from 'node-fetch'

const router = express.Router()


router.post('/init', async (req, res) => {
  try {
    const { amount } = req.body

    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' })
    }

    const payload = {
      RequestHeader: {
        SpecVersion: '1.31',
        CustomerId: process.env.SAFERPAY_CUSTOMER_ID,
        RequestId: crypto.randomUUID(),
        RetryIndicator: 0
      },
      TerminalId: process.env.SAFERPAY_TERMINAL_ID,
      Payment: {
        Amount: {
          Value: amount,
          CurrencyCode: 'EUR'
        },
        OrderId: `ORDER-${Date.now()}`,
        Description: 'EUR Payment'
      },
      // ✅ FIXED: Correct ReturnUrls structure
      ReturnUrls: {
        Success: `${SERVER_URL}/api/payments/return/success`,
        Fail: `${SERVER_URL}/api/payments/return/fail`,
        Abort: `${SERVER_URL}/api/payments/return/abort`
      }
    }

    const authHeader =
      'Basic ' +
      Buffer.from(
        `${process.env.SAFERPAY_USERNAME}:${process.env.SAFERPAY_PASSWORD}`
      ).toString('base64')

    const response = await fetch(
      `${process.env.SAFERPAY_BASE_URL}/Payment/v1/PaymentPage/Initialize`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      }
    )

    const text = await response.text()
    let data

    try {
      data = JSON.parse(text)
    } catch {
      console.error('Invalid Saferpay response:', text)
      return res.status(500).json({ error: 'Invalid response from Saferpay' })
    }

    if (!response.ok || !data.RedirectUrl) {
      console.error('Saferpay error:', data)
      return res.status(500).json(data)
    }

    res.json({ redirectUrl: data.RedirectUrl })

  } catch (err) {
    console.error('Server error:', err)
    res.status(500).json({ error: 'Payment initialization failed' })
  }
})

router.post('/assert', async (req, res) => {
  try {
    const { token } = req.body

    if (!token) {
      return res.status(400).json({ error: 'Token is required' })
    }

    const payload = {
      RequestHeader: {
        SpecVersion: '1.31',
        CustomerId: process.env.SAFERPAY_CUSTOMER_ID,
        RequestId: crypto.randomUUID(),
        RetryIndicator: 0  // ✅ ADDED
      },
      Token: token
    }

    const authHeader =
      'Basic ' +
      Buffer.from(
        `${process.env.SAFERPAY_USERNAME}:${process.env.SAFERPAY_PASSWORD}`
      ).toString('base64')

    const response = await fetch(
      `${process.env.SAFERPAY_BASE_URL}/Payment/v1/PaymentPage/Assert`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      }
    )

    const data = await response.json()

    console.log('SAFERPAY ASSERT RESPONSE:')
    console.dir(data, { depth: null })

    if (!response.ok) {
      return res.status(500).json({
        success: false,
        error: data
      })
    }

    const status = data.Transaction?.Status

    if (status === 'AUTHORIZED') {
      return res.json({
        success: true,
        status: 'AUTHORIZED',
        message: 'Payment authorized',
        transaction: data.Transaction
      })
    }

    if (status === 'PENDING') {
      return res.json({
        success: true,
        status: 'PENDING',
        message: 'Waiting for bank transfer',
        transaction: data.Transaction
      })
    }

    return res.json({
      success: false,
      status,
      message: 'Payment not successful',
      transaction: data.Transaction
    })

  } catch (err) {
    console.error('Assert error:', err)
    res.status(500).json({ error: 'Payment verification failed' })
  }
})

router.post('/capture', async (req, res) => {
  try {
    const { transactionId, amount } = req.body

    if (!transactionId) {
      return res.status(400).json({ error: 'TransactionId is required' })
    }

    const payload = {
      RequestHeader: {
        SpecVersion: '1.31',
        CustomerId: process.env.SAFERPAY_CUSTOMER_ID,
        RequestId: crypto.randomUUID(),
        RetryIndicator: 0
      },
      TransactionReference: {
        TransactionId: transactionId
      },
      Amount: {
        Value: amount,
        CurrencyCode: 'EUR'
      }
    }

    const authHeader =
      'Basic ' +
      Buffer.from(
        `${process.env.SAFERPAY_USERNAME}:${process.env.SAFERPAY_PASSWORD}`
      ).toString('base64')

    const response = await fetch(
      `${process.env.SAFERPAY_BASE_URL}/Payment/v1/Transaction/Capture`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('Capture error:', data)
      return res.status(500).json(data)
    }

    return res.json({
      success: true,
      redirectUrl: `/receipt.html?transactionId=${data.Transaction.Id}`
    })

  } catch (err) {
    console.error('Capture server error:', err)
    res.status(500).json({ error: 'Capture failed' })
  }
})

// ====================
// RETURN URL HANDLERS
// ====================

router.get('/return/success', (req, res) => {
  console.log('=== SAFERPAY SUCCESS RETURN ===');
  console.log('Full URL:', req.protocol + '://' + req.get('host') + req.originalUrl);
  console.log('Query params:', req.query);
  console.log('All headers:', req.headers);
  console.log('=======================');

  const { token, result, success, ...otherParams } = req.query;

  if (!token) {
    console.log('❌ NO TOKEN FOUND! Available params:', Object.keys(req.query));

    // Show ALL parameters for debugging
    let debugInfo = 'No token provided. Available parameters: ';
    for (const [key, value] of Object.entries(req.query)) {
      debugInfo += `${key}=${value}, `;
    }

    return res.redirect(`/error.html?message=${encodeURIComponent(debugInfo)}`);
  }

  console.log('✅ Token received:', token.substring(0, 20) + '...');
  res.redirect(`/payment-success.html?token=${token}`);
});

router.get('/return/fail', (req, res) => {
  const { token } = req.query
  res.redirect(`/payment-fail.html${token ? `?token=${token}` : ''}`)
})

router.get('/return/abort', (req, res) => {
  const { token } = req.query
  res.redirect(`/payment-abort.html${token ? `?token=${token}` : ''}`)
})

router.post('/notification', (req, res) => {
  try {
    const data = req.body
    console.log('Saferpay webhook received:', data)
    res.status(200).send('OK')
  } catch (error) {
    console.error('Webhook error:', error)
    res.status(500).send('Error')
  }
})

export default router
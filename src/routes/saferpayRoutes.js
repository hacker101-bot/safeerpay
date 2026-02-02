import express from 'express'
import crypto from 'crypto'

const router = express.Router()
const tokenStore = new Map()
const receiptStore = new Map()


router.post('/init', async (req, res) => {
  try {
    const { amount } = req.body

    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' })
    }

    const baseUrl =
      process.env.APP_BASE_URL ||
      `http://localhost:${process.env.PORT || 5000}`

    const orderId = `ORDER-${Date.now()}`

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
        OrderId: orderId,
        Description: 'EUR Payment'
      },
      ReturnUrls: {
        Success: `${baseUrl}/api/payments/return/success?orderId=${orderId}`,
        Fail: `${baseUrl}/api/payments/return/fail?orderId=${orderId}`,
        Abort: `${baseUrl}/api/payments/return/abort?orderId=${orderId}`
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
    console.log('📡 Saferpay RAW response:', text)  // Log the actual response
    
    let data
    try {
      data = JSON.parse(text)
    } catch {
      console.error('Invalid Saferpay response:', text)
      return res.status(500).json({ error: 'Invalid response from Saferpay' })
    }

    // ⭐⭐⭐ FIX: Check for correct response structure ⭐⭐⭐
    if (!response.ok) {
      console.error('Saferpay API error:', data)
      return res.status(500).json({ 
        error: 'Saferpay API error',
        details: data 
      })
    }

    const redirectUrl = data.RedirectUrl || data.Redirect?.RedirectUrl

    // Check if we got the expected response
    if (!data.Token || !redirectUrl) {
      console.error('Unexpected Saferpay response structure:', data)
      return res.status(500).json({ 
        error: 'Invalid response structure from Saferpay',
        received: data 
      })
    }

    tokenStore.set(orderId, {
      token: data.Token,
      expiration: data.Expiration
    })

    // CORRECT RESPONSE FORMAT
    res.json({ 
      success: true,
      token: data.Token,           // Token from response
      redirectUrl: redirectUrl, // RedirectUrl (capital R!)
      expiration: data.Expiration
    })

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

    const resolvedTransactionId =
      data.Transaction?.Id ||
      data.Capture?.TransactionId ||
      transactionId

    if (resolvedTransactionId) {
      receiptStore.set(resolvedTransactionId, {
        status: data.Transaction?.Status || 'CAPTURED',
        amount: amount,
        currency: 'EUR',
        method: data.PaymentMeans?.Brand?.Name || 'Card',
        date: data.Transaction?.Date || new Date().toISOString()
      })
    }

    return res.json({
      success: true,
      transactionId: resolvedTransactionId,
      capture: data,
      redirectUrl: resolvedTransactionId
        ? `/receipt.html?transactionId=${resolvedTransactionId}`
        : undefined
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
  console.log('=== SAFERPAY SUCCESS RETURN ===')
  console.log('Full URL:', req.protocol + '://' + req.get('host') + req.originalUrl)
  console.log('Query params:', req.query)
  console.log('All headers:', req.headers)
  console.log('=======================')

  const { token, orderId, result, success, ...otherParams } = req.query

  let resolvedToken = token

  if (!resolvedToken && orderId) {
    const entry = tokenStore.get(orderId)
    resolvedToken = entry?.token
    if (resolvedToken) {
      tokenStore.delete(orderId)
    }
  }

  if (!resolvedToken) {
    console.log('NO TOKEN FOUND! Available params:', Object.keys(req.query))

    // Show ALL parameters for debugging
    let debugInfo = 'No token available. Available parameters: '
    for (const [key, value] of Object.entries(req.query)) {
      debugInfo += `${key}=${value}, `
    }

    return res.redirect(`/error.html?message=${encodeURIComponent(debugInfo)}`)
  }

  console.log('Token received:', resolvedToken.substring(0, 20) + '...')
  res.redirect(`/success.html?token=${resolvedToken}`)
})

router.get('/return/fail', (req, res) => {
  const { token, orderId } = req.query
  const resolvedToken = token || tokenStore.get(orderId)?.token
  if (orderId) {
    tokenStore.delete(orderId)
  }
  res.redirect(`/fail.html${resolvedToken ? `?token=${resolvedToken}` : ''}`)
})

router.get('/return/abort', (req, res) => {
  const { token, orderId } = req.query
  const resolvedToken = token || tokenStore.get(orderId)?.token
  if (orderId) {
    tokenStore.delete(orderId)
  }
  res.redirect(`/abort.html${resolvedToken ? `?token=${resolvedToken}` : ''}`)
})

router.post('/notification', (req, res) => {
  try {
    const data = req.body
    console.log('Saferpay webhook received:', data)

    const transaction = data?.Transaction
    if (transaction?.Id) {
      receiptStore.set(transaction.Id, {
        status: transaction.Status,
        amount: transaction.Amount?.Value,
        currency: transaction.Amount?.CurrencyCode,
        method: data?.PaymentMeans?.Brand?.Name || 'Card',
        date: transaction.Date || new Date().toISOString()
      })
    }

    res.status(200).send('OK')
  } catch (error) {
    console.error('Webhook error:', error)
    res.status(500).send('Error')
  }
})

router.get('/transaction/:id', (req, res) => {
  const { id } = req.params
  const receipt = receiptStore.get(id)
  if (!receipt) {
    return res.status(404).json({ error: 'Transaction not found' })
  }
  return res.json(receipt)
})

export default router


import 'dotenv/config'
import express from 'express'
import path from 'path'
import saferpayRoutes from './src/routes/saferpayRoutes.js'

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(express.static(path.join(process.cwd(), 'public')))

app.use('/api/payments', saferpayRoutes)
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'))
})

const PORT = process.env.PORT || 5000

/* app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
}) */

export default app
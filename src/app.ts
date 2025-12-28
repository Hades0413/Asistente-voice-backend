// app.ts
import cors from 'cors'
import express from 'express'
import routes from './api/routes'

const app = express()

app.use(
  cors({
    origin: ['http://localhost:5173', 'https://ww44nc9f-5173.brs.devtunnels.ms'],
    credentials: true,
  })
)

app.use(express.json())

// ✅ Registrar routes normalmente
app.use('/api', routes)

// ⚡ Para preflight (OPTIONS) de todos los endpoints:
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return res.sendStatus(200)
  }
  next()
})

export default app

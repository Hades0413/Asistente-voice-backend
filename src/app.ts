import cors from 'cors'
import express from 'express'
import routes from './api/routes'

const app = express()

app.use(
  cors({
    origin: [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'https://acoustic-locator-league-attempting.trycloudflare.com',
    ],
    credentials: true,
  })
)

app.use(express.json())

app.use('/api', routes)

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

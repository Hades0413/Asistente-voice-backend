import dotenv from 'dotenv'

dotenv.config()

export function validateEnv() {
  const required = [
    'PUBLIC_URL',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'DEEPGRAM_API_KEY',
    'OPENAI_API_KEY',
  ]

  for (const key of required) {
    if (!process.env[key]) {
      console.warn(`[ENV] Missing ${key}`)
    }
  }
}

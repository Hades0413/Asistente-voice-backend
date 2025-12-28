//PRIMERA LÍNEA SIEMPRE
import './config/env'

import { container } from './container'
import { createHttpServer } from './infra/http/http.server'
import { startWebSocketServer } from './infra/websocket/ws.server'
import logger from './shared/logger'

const PORT = process.env.PORT || 3000

const server = createHttpServer()

const wsGateway = startWebSocketServer(server, {
  sessions: container.sessions,
  stt: container.stt,
  logger,
})

//Conecta WS → Processor → StreamingService
container.initStreaming(wsGateway)

server.listen(PORT, () => {
  logger.info(`HTTP server running on port ${PORT}`)
})

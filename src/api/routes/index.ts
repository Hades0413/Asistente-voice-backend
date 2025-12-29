import { Router } from 'express'
import { healthCheck } from '../controllers/health.controller'

import { AuthController } from '../../modules/auth/controllers/auth.controller'
import { UserRoleController } from '../../modules/user-role/controllers/user-role.controller'
import { UserController } from '../../modules/user/controllers/user.controller'

import { RoleController } from '../../modules/role/controllers/role.controller'
import { StreamingController } from '../../modules/streaming/controllers/streaming.controller'
import { TwilioController } from '../../modules/streaming/controllers/twilio.controller'
import { AuthMiddleware } from '../../shared/middlewares/auth/auth.middleware'

import { container } from '../../container'

const router = Router()

const authController = new AuthController()
const userController = new UserController()
const roleController = new RoleController()
const userRoleController = new UserRoleController()

const streamingController = new StreamingController(() => container.streamingService)
const twilioController = new TwilioController()

router.get('/health', healthCheck)
router.post('/auth/login', authController.login)

router.post('/twilio/voice', twilioController.voiceWebhook)

// -------------------------
// Protegidos
// Lo que venga aquí abajo requiere token
// -------------------------
router.use(AuthMiddleware.requireAuth)

// -------------------------
// Auth (requiere sesión válida)
// -------------------------
router.post('/auth/logout', authController.logout)
router.post('/auth/logout-global', authController.logoutGlobal)

// -------------------------
// Users
// -------------------------
router.post('/users', userController.create)

// -------------------------
// Roles
// -------------------------
router.post('/roles', roleController.create)
router.get('/roles', roleController.list)
router.get('/roles/:id', roleController.getById)
router.patch('/roles/:id', roleController.update)
router.patch('/roles/:id/state', roleController.setState)
router.delete('/roles/:id', roleController.delete)

// -------------------------
// User Roles
// -------------------------
router.post('/user-roles', userRoleController.create)
router.get('/user-roles', userRoleController.list)
router.get('/user-roles/:userId/:roleId', userRoleController.getByIds)
router.patch('/user-roles/:userId/:roleId/state', userRoleController.setState)
router.delete('/user-roles/:userId/:roleId', userRoleController.delete)

// -------------------------
// Streaming / Llamadas IA (requiere token)
// -------------------------
router.post('/streaming/start-call', streamingController.startCall)
router.post('/streaming/end-call', streamingController.endCall)

export default router

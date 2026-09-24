import { Router } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../config/db.js';
import { asyncHandler, ApiError } from '../../utils/errors.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import * as auth from './auth.service.js';

const router = Router();

const cookieOpts = (expires) => ({
  httpOnly: true,
  secure: env.isProd,
  sameSite: 'lax',
  path: '/api/v1/auth',
  expires,
});

function sendSession(res, session, status = 200) {
  res.cookie(auth.REFRESH_COOKIE, session.refresh.token, cookieOpts(session.refresh.expiresAt));
  res.status(status).json({ accessToken: session.accessToken, user: session.user });
}

if (env.googleEnabled) {
  passport.use(
    new GoogleStrategy(
      { clientID: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, callbackURL: env.GOOGLE_CALLBACK_URL },
      (_at, _rt, profile, done) => auth.upsertGoogleUser(profile).then((u) => done(null, u), done),
    ),
  );
}

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().min(1).max(80),
  password: z.string().min(8).max(128),
});
const loginSchema = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) });

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RegisterInput' }
 *     responses:
 *       201: { description: Session created, content: { application/json: { schema: { $ref: '#/components/schemas/Session' } } } }
 *       409: { description: Email already registered }
 */
router.post('/register', authLimiter, validate({ body: registerSchema }), asyncHandler(async (req, res) => {
  sendSession(res, await auth.register(req.body), 201);
}));

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/LoginInput' }
 *     responses:
 *       200: { description: Session created, content: { application/json: { schema: { $ref: '#/components/schemas/Session' } } } }
 *       401: { description: Invalid credentials }
 */
router.post('/login', authLimiter, validate({ body: loginSchema }), asyncHandler(async (req, res) => {
  sendSession(res, await auth.login(req.body));
}));

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange the httpOnly refresh cookie for a new access token (rotates the refresh token)
 *     responses:
 *       200: { description: New session }
 *       401: { description: Missing, invalid, or reused refresh token }
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  try {
    sendSession(res, await auth.rotateRefreshToken(req.cookies[auth.REFRESH_COOKIE]));
  } catch (err) {
    res.clearCookie(auth.REFRESH_COOKIE, cookieOpts());
    throw err;
  }
}));

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke the current refresh token
 *     responses:
 *       204: { description: Logged out }
 */
router.post('/logout', asyncHandler(async (req, res) => {
  await auth.revokeRefreshToken(req.cookies[auth.REFRESH_COOKIE]);
  res.clearCookie(auth.REFRESH_COOKIE, cookieOpts());
  res.status(204).end();
}));

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Current user
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The authenticated user, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw ApiError.notFound('User not found');
  res.json(auth.publicUser(user));
}));

router.get('/providers', (_req, res) => res.json({ google: env.googleEnabled }));

/**
 * @openapi
 * /auth/google:
 *   get:
 *     tags: [Auth]
 *     summary: Start Google OAuth sign-in (browser redirect)
 *     responses:
 *       302: { description: Redirect to Google }
 */
router.get('/google', (req, res, next) => {
  if (!env.googleEnabled) return next(ApiError.notFound('Google sign-in is not configured'));
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

// On success we set the refresh cookie and bounce back to the SPA, which calls /refresh to get
// an access token. Tokens never travel in the URL.
router.get('/google/callback', (req, res, next) => {
  if (!env.googleEnabled) return next(ApiError.notFound('Google sign-in is not configured'));
  passport.authenticate('google', { session: false }, async (err, user) => {
    if (err || !user) return res.redirect(`${env.CLIENT_URL}/login?error=oauth`);
    try {
      const session = await auth.issueSession(user);
      res.cookie(auth.REFRESH_COOKIE, session.refresh.token, cookieOpts(session.refresh.expiresAt));
      res.redirect(`${env.CLIENT_URL}/auth/callback`);
    } catch (e) {
      next(e);
    }
  })(req, res, next);
});

export default router;

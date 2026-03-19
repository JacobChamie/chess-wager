import { Router } from 'express';
import { authMiddleware, adminMiddleware } from '../auth/middleware.js';

export default function createFairplayRoutes(fairPlayService) {
  const router = Router();

  // --- Player-facing ---

  // Submit a report
  router.post('/report', authMiddleware, async (req, res) => {
    try {
      const { reportedId, gameId, reason, details } = req.body;
      const result = await fairPlayService.submitReport(
        req.user.id, reportedId, gameId, reason, details
      );
      res.json(result);
    } catch (err) {
      const status = err.message.includes('limit') ? 429 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  // --- Admin endpoints ---

  // List reports
  router.get('/admin/reports', adminMiddleware, async (req, res) => {
    try {
      const { status, page, limit } = req.query;
      const result = await fairPlayService.getReports(
        status, parseInt(page) || 1, Math.min(parseInt(limit) || 20, 100)
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update report
  router.put('/admin/reports/:id', adminMiddleware, async (req, res) => {
    try {
      const { status, note } = req.body;
      const result = await fairPlayService.resolveReport(
        req.params.id, req.user.id, status, note
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Flagged users
  router.get('/admin/flagged', adminMiddleware, async (req, res) => {
    try {
      const users = await fairPlayService.getFlaggedUsers();
      res.json({ users });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // User fair-play profile
  router.get('/admin/user/:id', adminMiddleware, async (req, res) => {
    try {
      const profile = await fairPlayService.getUserProfile(req.params.id);
      res.json(profile);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // Game analysis detail
  router.get('/admin/game/:id', adminMiddleware, async (req, res) => {
    try {
      const analysis = await fairPlayService.getGameAnalysis(req.params.id);
      res.json(analysis);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // Admin action (warn, ban, clear flag)
  router.post('/admin/action', adminMiddleware, async (req, res) => {
    try {
      const { userId, action, note } = req.body;
      const result = await fairPlayService.takeAction(req.user.id, userId, action, note);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

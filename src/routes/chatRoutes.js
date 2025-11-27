const express = require('express');
const chatController = require('../controllers/chatController');
const authenticate = require('../middleware/auth');

const router = express.Router();

router.use(authenticate); // All routes require authentication

router.post('/send', chatController.sendMessage);
router.get('/history/:userId', chatController.getChatHistory);
router.get('/conversations', chatController.getConversations);
router.put('/read', chatController.markAsRead);

module.exports = router;

const express = require('express');
const chatController = require('../controllers/chatController');
const authenticate = require('../middleware/auth');
const { upload, processAndUploadImage, processAndUploadVoice } = require('../middleware/upload');

const router = express.Router();

router.use(authenticate); // All routes require authentication

router.post('/send', chatController.sendMessage);
router.get('/history/:userId', chatController.getChatHistory);
router.get('/conversations', chatController.getConversations);
router.put('/read', chatController.markAsRead);
router.post('/upload/image', upload.single('image'), processAndUploadImage, chatController.uploadImage);
router.post('/upload/voice', upload.single('voice'), processAndUploadVoice, chatController.uploadVoice);

module.exports = router;

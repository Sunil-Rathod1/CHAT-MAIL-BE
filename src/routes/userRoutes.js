const express = require('express');
const userController = require('../controllers/userController');
const authenticate = require('../middleware/auth');

const router = express.Router();

router.use(authenticate); // All routes require authentication

router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.get('/search', userController.searchUsers);
router.get('/:id', userController.getUserById);
router.put('/status', userController.updateStatus);

module.exports = router;

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const callController = require('../controllers/callController');

// Get call history
router.get('/history', auth, callController.getCallHistory);

// Get call by ID
router.get('/:callId', auth, callController.getCallById);

// Get missed calls count
router.get('/missed/count', auth, callController.getMissedCallsCount);

module.exports = router;

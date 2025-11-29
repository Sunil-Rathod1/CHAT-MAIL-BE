const express = require('express');
const groupController = require('../controllers/groupController');
const authenticate = require('../middleware/auth');

const router = express.Router();

router.use(authenticate); // All routes require authentication

router.post('/create', groupController.createGroup);
router.get('/my-groups', groupController.getUserGroups);
router.get('/:id', groupController.getGroupById);
router.post('/:id/members/add', groupController.addMembers);
router.delete('/:id/members/:memberId', groupController.removeMember);
router.put('/:id', groupController.updateGroup);
router.get('/:id/messages', groupController.getGroupMessages);

module.exports = router;

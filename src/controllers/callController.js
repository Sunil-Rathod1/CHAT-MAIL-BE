const Call = require('../models/Call');
const User = require('../models/User');

// Get call history for a user
exports.getCallHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;

    const calls = await Call.find({
      $or: [{ caller: userId }, { receiver: userId }]
    })
      .populate('caller', 'name email avatar')
      .populate('receiver', 'name email avatar')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Call.countDocuments({
      $or: [{ caller: userId }, { receiver: userId }]
    });

    res.json({
      success: true,
      data: calls,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get call details
exports.getCallById = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const call = await Call.findById(callId)
      .populate('caller', 'name email avatar')
      .populate('receiver', 'name email avatar');

    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found' });
    }

    // Check if user is part of this call
    if (call.caller._id.toString() !== userId && call.receiver._id.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    res.json({ success: true, data: call });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get missed calls count
exports.getMissedCallsCount = async (req, res) => {
  try {
    const userId = req.user.userId;

    const count = await Call.countDocuments({
      receiver: userId,
      status: 'missed'
    });

    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

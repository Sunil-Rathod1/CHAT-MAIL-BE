const multer = require('multer');
const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure multer for memory storage
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Accept images only
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  }
});

// Helper function to upload buffer to Cloudinary
const uploadToCloudinary = (buffer, folder = 'chatmail') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        transformation: [
          { quality: 'auto:good' },
          { fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    Readable.from(buffer).pipe(stream);
  });
};

// Middleware to process and upload image
const processAndUploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Compress image with sharp
    const compressedBuffer = await sharp(req.file.buffer)
      .resize(1920, 1080, { 
        fit: 'inside', 
        withoutEnlargement: true 
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    // Generate thumbnail
    const thumbnailBuffer = await sharp(req.file.buffer)
      .resize(300, 300, { 
        fit: 'cover' 
      })
      .jpeg({ quality: 70 })
      .toBuffer();

    // Upload both to Cloudinary
    const [imageResult, thumbnailResult] = await Promise.all([
      uploadToCloudinary(compressedBuffer, 'chatmail/images'),
      uploadToCloudinary(thumbnailBuffer, 'chatmail/thumbnails')
    ]);

    // Attach URLs to request object
    req.uploadedImage = {
      url: imageResult.secure_url,
      publicId: imageResult.public_id,
      thumbnail: thumbnailResult.secure_url,
      thumbnailPublicId: thumbnailResult.public_id,
      width: imageResult.width,
      height: imageResult.height,
      size: imageResult.bytes,
      format: imageResult.format
    };

    next();
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading image',
      error: error.message
    });
  }
};

// Delete image from Cloudinary
const deleteFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
  }
};

module.exports = {
  upload,
  processAndUploadImage,
  deleteFromCloudinary
};

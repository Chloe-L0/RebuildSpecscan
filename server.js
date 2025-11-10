// ========================================
// FULL-STACK AIRPLANE INSPECTION APP
// Backend Server - Node.js/Express
// ========================================

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

// Load .env exclusively from backend/.env
const ENV_PATH = path.join(__dirname, 'backend', '.env');
require('dotenv').config({ path: ENV_PATH });

const ALLOWED_AREAS = new Set([
    'fuselage',
    'left-wing',
    'right-wing',
    'wings',
    'tail',
    'engine',
    'landing-gear'
]);

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// MIDDLEWARE SETUP
// ========================================

// Enable CORS for mobile and browser access
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve uiImage directory for plane illustration
app.use('/uiImage', express.static(path.join(__dirname, '../uiImage')));

// Serve aircraft assets
app.use('/assets', express.static(path.join(__dirname, 'Assets')));

const sendPublicFile = (res, fileName) =>
    res.sendFile(path.join(__dirname, 'public', fileName));

app.get(['/', '/start'], (req, res) => sendPublicFile(res, 'index.html'));
app.get('/3dplane', (req, res) => sendPublicFile(res, '3Dplane.html'));
app.get('/capture', (req, res) => sendPublicFile(res, 'capture.html'));
app.get('/tag', (req, res) => sendPublicFile(res, 'tag.html'));
app.get('/results', (req, res) => sendPublicFile(res, 'results.html'));
app.get('/report', (req, res) => sendPublicFile(res, 'report.html'));
app.get('/success', (req, res) => sendPublicFile(res, 'success.html'));

// Configure multer for file uploads (in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Only accept image files
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// ========================================
// ROBOFLOW API CONFIGURATION
// ========================================
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY || 'YOUR_KEY_HERE';
const rawModelId = process.env.ROBOFLOW_MODEL_ID || 'YOUR_MODEL_ID_HERE';
const modelHasVersion = rawModelId.includes('/');
const modelVersion = process.env.ROBOFLOW_MODEL_VERSION;
const resolvedModelId = modelHasVersion
    ? rawModelId
    : (modelVersion ? `${rawModelId}/${modelVersion}` : rawModelId);
const ROBOFLOW_MODEL_ID = resolvedModelId;
const ROBOFLOW_MODEL_VERSION = resolvedModelId.split('/')[1] || 'UNSPECIFIED';
const ROBOFLOW_API_URL = `https://detect.roboflow.com/${ROBOFLOW_MODEL_ID}`;

// Debug: Log configuration on startup
console.log('\n🔧 Configuration Check:');
console.log(`   PORT: ${PORT}`);
console.log(`   API_KEY loaded: ${ROBOFLOW_API_KEY !== 'YOUR_KEY_HERE' ? '✅ Yes' : '❌ No (using placeholder)'}`);
console.log(`   MODEL_ID loaded: ${ROBOFLOW_MODEL_ID !== 'YOUR_MODEL_ID_HERE' ? '✅ Yes' : '❌ No (using placeholder)'}`);
console.log(`   MODEL_VERSION: ${ROBOFLOW_MODEL_VERSION}`);
console.log(`   .env path: ${ENV_PATH}\n`);

// ========================================
// API ENDPOINTS
// ========================================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Airplane Inspection API is running',
        timestamp: new Date().toISOString(),
        port: PORT,
        apiConfigured: ROBOFLOW_API_KEY !== 'YOUR_KEY_HERE' && ROBOFLOW_MODEL_ID !== 'YOUR_MODEL_ID_HERE'
    });
});

// Analyze image endpoint with error handling wrapper (supports single or multiple images)
app.post('/api/analyze', (req, res, next) => {
    upload.any()(req, res, (err) => {
        // Handle multer errors
        if (err) {
            // File type validation error
            if (err.message === 'Only image files are allowed') {
                return res.status(400).json({
                    error: 'Invalid file type',
                    message: 'Only image files are allowed'
                });
            }
            // Other multer errors
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({
                        error: 'File too large',
                        message: 'Image must be less than 10MB'
                    });
                }
                return res.status(400).json({
                    error: 'Upload error',
                    message: err.message
                });
            }
            // Pass other errors to error handler
            return next(err);
        }
        // No error, proceed to handler
        next();
    });
}, async (req, res) => {
    try {
        // Check if files were uploaded FIRST (before API config check for proper error codes)
        const files = req.files || (req.file ? [req.file] : []);
        if (!files || files.length === 0) {
            return res.status(400).json({
                error: 'No images provided',
                message: 'Please upload at least one image file'
            });
        }

        // Validate inspection area
        const rawArea = typeof req.body.area === 'string' ? req.body.area.trim().toLowerCase() : '';
        if (!rawArea) {
            return res.status(400).json({
                success: false,
                error: 'Invalid inspection area',
                message: 'Inspection area is required'
            });
        }

        if (!ALLOWED_AREAS.has(rawArea)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid inspection area',
                message: `Inspection area must be one of: ${Array.from(ALLOWED_AREAS).join(', ')}`
            });
        }
        const selectedArea = rawArea;

        // Check if API is configured (using placeholder check)
        if (
            ROBOFLOW_API_KEY === 'YOUR_KEY_HERE' ||
            ROBOFLOW_MODEL_ID === 'YOUR_MODEL_ID_HERE' ||
            !ROBOFLOW_API_KEY ||
            !ROBOFLOW_MODEL_ID ||
            ROBOFLOW_MODEL_VERSION === 'UNSPECIFIED'
        ) {
            return res.status(500).json({
                error: 'API not configured',
                message: 'Please set ROBOFLOW_API_KEY, ROBOFLOW_MODEL_ID, and optionally ROBOFLOW_MODEL_VERSION in your backend .env file (MODEL_ID may also include version as "model/1").'
            });
        }

        // Process all images
        const results = [];
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            try {
                // Convert image buffer to base64 string (without data URL prefix)
                let base64Image = file.buffer.toString('base64');
                if (base64Image.includes(',')) {
                    base64Image = base64Image.split(',').pop();
                }

                const requestConfig = {
                    params: {
                        api_key: ROBOFLOW_API_KEY,
                        confidence: req.body.confidence ?? 60,
                        overlap: req.body.overlap ?? 30
                    },
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                };

                // Call Roboflow API (Hosted Inference expects raw base64 body)
                const response = await axios.post(
                    ROBOFLOW_API_URL,
                    base64Image,
                    requestConfig
                );

                // Store results with image index
                results.push({
                    imageIndex: i,
                    imageName: file.originalname || `image_${i + 1}.jpg`,
                    predictions: (response.data.predictions || []).map(p => ({
                        ...p,
                        imageIndex: i,
                        imageName: file.originalname || `image_${i + 1}.jpg`
                    })),
                    image_width: response.data.image?.width || null,
                    image_height: response.data.image?.height || null
                });
            } catch (error) {
                console.error(`Error processing image ${i + 1}:`, error.message);
                if (error.response) {
                    console.error('Roboflow response status:', error.response.status);
                    console.error('Roboflow response data:', error.response.data);
                }
                // Continue with other images even if one fails
                results.push({
                    imageIndex: i,
                    imageName: file.originalname || `image_${i + 1}.jpg`,
                    error: error.response?.data?.message || error.message || 'Failed to process image',
                    predictions: []
                });
            }
        }

        // Aggregate all predictions
        const allPredictions = results.flatMap(r => r.predictions || []);
        
        const primaryResult = results[0] || {};

        // Return aggregated results
        res.json({
            success: true,
            area: selectedArea,
            results: results, // Individual image results
            predictions: allPredictions, // All predictions flattened
            imageSize: {
                w: primaryResult.image_width ?? null,
                h: primaryResult.image_height ?? null
            },
            image_count: results.length,
            total_defects: allPredictions.length
        });

    } catch (error) {
        console.error('Error analyzing image:', error);
        
        // Handle specific error cases
        if (error.response) {
            const status = error.response.status || 500;
            const statusText = error.response.statusText || 'Unknown error';
            const errorMessage = error.response.data?.message || error.response.data?.error || error.message;
            
            // Provide helpful error messages based on status code
            let userMessage = errorMessage;
            
            if (status === 403) {
                userMessage = 'Access forbidden. Possible issues:\n' +
                    '1. Invalid API key - Check your Roboflow API key in .env file\n' +
                    '2. API key doesn\'t have permission for this model\n' +
                    '3. Model ID might be incorrect - Format should be: project-name/version-number\n' +
                    '4. Model might not be deployed or public\n\n' +
                    `Error details: ${errorMessage}`;
            } else if (status === 401) {
                userMessage = 'Unauthorized. Check your Roboflow API key in .env file.';
            } else if (status === 404) {
                userMessage = 'Model not found. Check your MODEL_ID in .env file. Format: project-name/version-number';
            }
            
            // Roboflow API error
            res.status(status).json({
                error: 'Roboflow API error',
                message: userMessage,
                status: status,
                statusText: statusText,
                roboflowError: errorMessage
            });
        } else if (error.code === 'LIMIT_FILE_SIZE') {
            // File too large
            res.status(400).json({
                error: 'File too large',
                message: 'Image must be less than 10MB'
            });
        } else {
            // Generic error
            res.status(500).json({
                error: 'Internal server error',
                message: error.message || 'Failed to analyze image'
            });
        }
    }
});

// Serve the main app (fallback to index.html for SPA routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// ERROR HANDLING MIDDLEWARE
// ========================================
app.use((error, req, res, next) => {
    // Generic error handler for unhandled errors
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message || 'An unexpected error occurred'
    });
});

// ========================================
// START SERVER
// ========================================
// Only start listening if not in test mode
if (process.env.NODE_ENV !== 'test') {
    const server = app.listen(PORT, () => {
        console.log(`
╔═══════════════════════════════════════╗
║   Airplane Inspection App - Server    ║
╚═══════════════════════════════════════╝
    
🚀 Server running on: http://localhost:${PORT}
📱 Mobile access: http://[YOUR_IP]:${PORT}
🌐 Browser access: http://localhost:${PORT}

⚠️  Configuration Status:
   ${ROBOFLOW_API_KEY !== 'YOUR_KEY_HERE' ? '✅' : '❌'} ROBOFLOW_API_KEY ${ROBOFLOW_API_KEY !== 'YOUR_KEY_HERE' ? 'configured' : 'NOT configured'}
   ${ROBOFLOW_MODEL_ID !== 'YOUR_MODEL_ID_HERE' ? '✅' : '❌'} ROBOFLOW_MODEL_ID ${ROBOFLOW_MODEL_ID !== 'YOUR_MODEL_ID_HERE' ? 'configured' : 'NOT configured'}
   
${ROBOFLOW_API_KEY === 'YOUR_KEY_HERE' || ROBOFLOW_MODEL_ID === 'YOUR_MODEL_ID_HERE' ? '⚠️  Create .env file in backend/ folder with your Roboflow credentials!' : ''}
        `);
    });
}

module.exports = app;
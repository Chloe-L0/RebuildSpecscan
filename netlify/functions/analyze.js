// Netlify Function for /api/analyze endpoint
const axios = require('axios');
const Busboy = require('busboy');

const ALLOWED_AREAS = new Set([
  'fwd-fuselage',
  'mid-fuselage',
  'wings',
  'aft-fuselage',
  'engine',
  'vertical-stabilizer',
  'horizontal-stabilizer'
]);

// Helper to parse multipart form data using busboy
const parseMultipart = (event) => {
  return new Promise((resolve, reject) => {
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    
    if (!contentType.includes('multipart/form-data')) {
      // Not multipart, try to parse as JSON
      try {
        const body = JSON.parse(event.body || '{}');
        resolve({ files: [], body });
      } catch (e) {
        resolve({ files: [], body: {} });
      }
      return;
    }

    const busboy = Busboy({ headers: event.headers });
    const files = [];
    const body = {};

    busboy.on('file', (fieldname, file, info) => {
      const { filename, encoding, mimeType } = info;
      const chunks = [];
      
      file.on('data', (data) => {
        chunks.push(data);
      });
      
      file.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // Check file size (10MB limit)
        if (buffer.length > 10 * 1024 * 1024) {
          reject(new Error('File too large. Maximum size is 10MB.'));
          return;
        }
        // Check file type
        if (!mimeType.startsWith('image/')) {
          reject(new Error('Only image files are allowed'));
          return;
        }
        files.push({
          fieldname,
          originalname: filename,
          mimetype: mimeType,
          encoding,
          buffer
        });
      });
    });

    busboy.on('field', (fieldname, value) => {
      body[fieldname] = value;
    });

    busboy.on('finish', () => {
      resolve({ files, body });
    });

    busboy.on('error', (err) => {
      reject(err);
    });

    // Convert base64 body to buffer if needed and create a readable stream
    const { Readable } = require('stream');
    let bodyBuffer;
    if (event.isBase64Encoded) {
      bodyBuffer = Buffer.from(event.body, 'base64');
    } else {
      bodyBuffer = Buffer.from(event.body || '', 'binary');
    }

    // Create a readable stream from the buffer for busboy
    const stream = Readable.from(bodyBuffer);
    stream.pipe(busboy);
  });
};

exports.handler = async (event, context) => {
  const tFunctionStart = Date.now();

  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get environment variables from Netlify (same as server.js)
    const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
    const rawModelId = process.env.ROBOFLOW_MODEL_ID;
    const modelVersion = process.env.ROBOFLOW_MODEL_VERSION;

    const modelHasVersion = rawModelId && rawModelId.includes('/');
    const resolvedModelId = modelHasVersion
      ? rawModelId
      : (modelVersion ? `${rawModelId}/${modelVersion}` : rawModelId);
    const ROBOFLOW_MODEL_ID = resolvedModelId;
    // Same endpoint as server.js: Hosted Inference API
    const ROBOFLOW_DETECT_URL = `https://detect.roboflow.com/${ROBOFLOW_MODEL_ID}`;

    // Check API configuration
    if (!ROBOFLOW_API_KEY || !ROBOFLOW_MODEL_ID || ROBOFLOW_API_KEY === 'YOUR_KEY_HERE' || ROBOFLOW_MODEL_ID === 'YOUR_MODEL_ID_HERE') {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'API not configured',
          message: 'Please set ROBOFLOW_API_KEY and ROBOFLOW_MODEL_ID in Netlify environment variables.'
        })
      };
    }

    // Parse request body
    let files = [];
    let body = {};

    if (event.headers['content-type'] && event.headers['content-type'].includes('multipart/form-data')) {
      const parsed = await parseMultipart(event);
      files = parsed.files;
      body = parsed.body;
    } else {
      // JSON body
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        body = {};
      }
    }

    // Check if files were uploaded
    if (!files || files.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'No images provided',
          message: 'Please upload at least one image file'
        })
      };
    }

    // Validate inspection area
    const rawArea = (body.area || '').trim().toLowerCase();
    if (!rawArea) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid inspection area',
          message: 'Inspection area is required'
        })
      };
    }

    if (!ALLOWED_AREAS.has(rawArea)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid inspection area',
          message: `Inspection area must be one of: ${Array.from(ALLOWED_AREAS).join(', ')}`
        })
      };
    }

    const tBeforeApiCalls = Date.now();
    console.log(`[analyze] Function start → ready for API: ${tBeforeApiCalls - tFunctionStart} ms`);

    // Process all images (same endpoint, format, and headers as server.js)
    const results = [];

    const confidencePct = body.confidence != null ? Number(body.confidence) : 60;
    const overlapPct = body.overlap != null ? Number(body.overlap) : 30;
    const confidence = (typeof confidencePct === 'number' && !isNaN(confidencePct)) ? confidencePct : 60;
    const overlap = (typeof overlapPct === 'number' && !isNaN(overlapPct)) ? overlapPct : 30;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        // Convert image buffer to base64 string (without data URL prefix) - same as server.js
        let base64Image = file.buffer.toString('base64');
        if (base64Image.includes(',')) {
          base64Image = base64Image.split(',').pop();
        }

        const requestConfig = {
          params: {
            api_key: ROBOFLOW_API_KEY,
            confidence,
            overlap
          },
          headers: { 'Content-Type': 'application/json' },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        };

        const tBeforeRoboflow = Date.now();
        const response = await axios.post(
          ROBOFLOW_DETECT_URL,
          base64Image,
          requestConfig
        );
        const roboflowMs = Date.now() - tBeforeRoboflow;
        console.log(`[analyze] Roboflow API call (image ${i + 1}): ${roboflowMs} ms`);

        const data = response.data || {};
        const rawPredictions = data.predictions || [];
        const imageMeta = data.image || {};

        results.push({
          imageIndex: i,
          imageName: file.originalname || `image_${i + 1}.jpg`,
          predictions: rawPredictions.map(p => ({
            ...p,
            imageIndex: i,
            imageName: file.originalname || `image_${i + 1}.jpg`
          })),
          image_width: imageMeta.width ?? null,
          image_height: imageMeta.height ?? null
        });
      } catch (error) {
        console.error(`Error processing image ${i + 1}:`, error.message);
        results.push({
          imageIndex: i,
          imageName: file.originalname || `image_${i + 1}.jpg`,
          error: error.response?.data?.message || error.message || 'Failed to process image',
          predictions: []
        });
      }
    }

    const tTotal = Date.now() - tFunctionStart;
    console.log(`[analyze] Total execution time: ${tTotal} ms`);

    // Aggregate all predictions
    const allPredictions = results.flatMap(r => r.predictions || []);
    const primaryResult = results[0] || {};

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        area: rawArea,
        results: results,
        predictions: allPredictions,
        imageSize: {
          w: primaryResult.image_width ?? null,
          h: primaryResult.image_height ?? null
        },
        image_count: results.length,
        total_defects: allPredictions.length
      })
    };

  } catch (error) {
    console.error('Error analyzing image:', error);
    
    return {
      statusCode: 500,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message || 'Failed to analyze image'
      })
    };
  }
};

// Netlify Function for /api/health endpoint

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Get environment variables from Netlify
  const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
  const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID;
  const PORT = process.env.PORT || 'N/A';

  const response = {
    status: 'ok',
    message: 'Airplane Inspection API is running',
    timestamp: new Date().toISOString(),
    port: PORT,
    apiConfigured: !!(ROBOFLOW_API_KEY && ROBOFLOW_MODEL_ID && 
                     ROBOFLOW_API_KEY !== 'YOUR_KEY_HERE' && 
                     ROBOFLOW_MODEL_ID !== 'YOUR_MODEL_ID_HERE')
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(response)
  };
};

# Netlify Deployment Guide

This guide explains how to deploy your SpecScan application to Netlify.

## Changes Made for Netlify

The following changes were made to support Netlify deployment:

1. **Netlify Functions**: Created serverless functions in `netlify/functions/` to replace the Express server endpoints:
   - `analyze.js` - Handles `/api/analyze` endpoint for image analysis
   - `health.js` - Handles `/api/health` endpoint for health checks

2. **Updated `netlify.toml`**: Configured to:
   - Serve static files from `public/` directory
   - Route `/api/*` requests to Netlify Functions
   - Handle SPA routing with redirects

3. **Dependencies**: Added `busboy` package for multipart form data parsing in Netlify Functions

## Environment Variables Setup

You need to add the following environment variables in your Netlify dashboard:

1. Go to your Netlify site dashboard
2. Navigate to **Site settings** → **Environment variables**
3. Add the following variables:

### Required Variables:
- `ROBOFLOW_API_KEY` - Your Roboflow API key
- `ROBOFLOW_MODEL_ID` - Your Roboflow model ID (format: `project-name/version` or just `project-name`)

### Optional Variables:
- `ROBOFLOW_MODEL_VERSION` - Model version (if not included in MODEL_ID)
- `VITE_GEMINI_API_KEY` - Gemini API key (if using Gemini AI features)

### Example:
```
ROBOFLOW_API_KEY=your_roboflow_api_key_here
ROBOFLOW_MODEL_ID=airplane-inspection/1
ROBOFLOW_MODEL_VERSION=1
```

## Assets Folder

The `Assets/` folder needs to be accessible at `/assets/` in the deployed site. The build command in `netlify.toml` will attempt to copy assets to `public/assets/`. 

**Important**: Before deploying, ensure your `Assets/` folder structure is:
- `Assets/plane.glb` - 3D model file
- `Assets/Mask/` - Directory containing mask PNG files

Or manually copy the `Assets/` folder to `public/assets/` before deploying.

## Deployment Steps

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Ensure Assets are accessible**:
   - Option A: Copy `Assets/` folder to `public/assets/`
   - Option B: The build command will attempt to copy them automatically

3. **Deploy to Netlify**:
   - **Via Git**: Connect your repository to Netlify and push changes
   - **Via Netlify CLI**: Run `netlify deploy --prod`
   - **Via Drag & Drop**: Use Netlify's drag-and-drop interface

4. **Set Environment Variables**:
   - Go to Netlify dashboard → Site settings → Environment variables
   - Add all required variables listed above

5. **Verify Deployment**:
   - Visit your deployed site
   - Check `/api/health` endpoint to verify API configuration
   - Test the image analysis functionality

## API Endpoints

After deployment, your API endpoints will be available at:
- `https://your-site.netlify.app/api/health` - Health check
- `https://your-site.netlify.app/api/analyze` - Image analysis

## Troubleshooting

### API Not Configured Error
- Ensure environment variables are set in Netlify dashboard
- Check that variable names match exactly (case-sensitive)
- Redeploy after adding environment variables

### Assets Not Loading
- Verify `Assets/` folder is copied to `public/assets/`
- Check file paths in browser console
- Ensure file names match exactly (case-sensitive)

### Function Errors
- Check Netlify Function logs in the dashboard
- Verify `busboy` package is installed
- Check that environment variables are accessible in functions

## Local Development

For local development, you can still use the Express server:
```bash
npm run dev
```

The Express server (`server.js`) will continue to work locally with `backend/.env` file.

## Notes

- The `server.js` file is kept for local development but is not used in Netlify deployment
- Netlify Functions automatically have access to environment variables via `process.env`
- The frontend code doesn't need changes - it will work with the Netlify Functions automatically
- All API keys are stored securely in Netlify's environment variables and are never exposed to the client

## Code Changes Summary

**No frontend code changes needed!** The existing code already works with Netlify Functions because:
- API calls use relative paths (`/api/analyze`, `/api/health`)
- The `netlify.toml` redirects `/api/*` to Netlify Functions automatically
- Environment variables are accessed server-side only (in Netlify Functions)

The only changes made were:
1. Created `netlify/functions/` directory with serverless function handlers
2. Updated `netlify.toml` for proper routing
3. Added `busboy` dependency for multipart form parsing

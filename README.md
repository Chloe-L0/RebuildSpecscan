# Airplane Inspection App

Predictive maintenance inspections made simple with SpecScan — a mobile-first web application that guides technicians through a three-step workflow and leverages Roboflow’s hosted inference API for defect detection.

---

## Features

- **3-Step Inspection Flow**
  1. Select airplane area (Fuselage, Wings, Tail, Landing Gear, Engine)
  2. Capture or upload an inspection image (camera-friendly on mobile)
  3. Run AI-powered analysis and visualize detections on an overlay canvas
- **Mobile-First UX** with large touch targets, responsive layout, and camera capture support.
- **Secure Backend Pipeline**
  - Roboflow credentials loaded via `dotenv` and never exposed to the client.
  - Multer in-memory uploads with file-type & size validation (images ≤ 10 MB).
  - Centralized logging, structured error handling, and normalized responses.
- **Roboflow Integration** handled entirely on the server through Bearer-authenticated requests.
- **Testing Coverage** using Jest and Supertest for health and inference endpoints.

---

## Project Structure

```
SpecScan_v1/
├── backend/
│   └── .env               # Environment variables (create this here)
├── server.js              # Express server with Roboflow integration
├── package.json           # Dependencies and scripts
├── .gitignore             # Git ignore rules
├── jest.config.js         # Jest test configuration
├── README.md              # Project documentation
├── public/
│   └── index.html         # Frontend application
└── tests/
    └── server.test.js     # API integration tests
```

> ⚠️ The `.env` file is ignored by Git. Create it manually inside the `backend/` directory using the template below before running the app.

---

## Environment Variables

Create `backend/.env`:

```env
ROBOFLOW_API_KEY=your_roboflow_api_key_here
ROBOFLOW_MODEL_ID=your-project-name/1
PORT=3000
```

- `ROBOFLOW_MODEL_ID` format: `project-name/version`
- Example: `airplane-inspection/1`
- Roboflow dashboard: [https://app.roboflow.com/](https://app.roboflow.com/)

---

## Installation & Setup

```bash
npm install
# configure backend/.env (see above)
npm run dev
```

- Development server: [http://localhost:3000](http://localhost:3000)
- Production mode: `npm start`

### Mobile Access

1. Ensure your mobile device is on the same network as your computer.
2. Get your LAN IP:
   - **Windows:** `ipconfig`
   - **macOS/Linux:** `ifconfig` or `ip addr show`
3. Open `http://<YOUR_IP>:3000` in the mobile browser.

---

## Testing

```bash
npm test
```

- `/api/health` returns `{ status: "ok", message, timestamp }`
- `/api/analyze` is covered with mocked Roboflow responses.

> Manual QA checklist is mirrored in the original specification and includes both desktop and mobile verification, plus API health checks.

---

## Implementation Notes

- **Server (`server.js`)**
  - Express app with CORS, body parsing, static asset serving, and `morgan` request logging.
  - `multer` memory storage validates uploads and enforces size limits.
  - `POST /api/analyze` forwards images to Roboflow via `axios` + `form-data`, returning normalized prediction payloads:
    ```json
    {
      "success": true,
      "area": "fuselage",
      "predictions": [
        { "class": "crack", "confidence": 0.92, "x": 100, "y": 200, "width": 50, "height": 60 }
      ],
      "imageSize": { "w": 1280, "h": 720 }
    }
    ```
  - Graceful error handling surfaces actionable messages without leaking secrets.

- **Frontend (`public/index.html`)**
  - 3-step guided UI with large buttons, camera capture input, and analysis CTA.
  - Canvas overlay renders bounding boxes and labels filtered by a confidence threshold slider.
  - Responsive layout optimized for touch devices while remaining desktop-friendly.

- **Testing (`tests/server.test.js`)**
  - Health endpoint integration test.
  - Roboflow inference mocked via Jest to validate normalized response schema and error branch.

---

## Troubleshooting

- **Missing credentials:** Ensure `backend/.env` is present and restart the server after changes.
- **Port 3000 busy:** Update `PORT` in `backend/.env`.
- **Module not found:** Delete `node_modules`, reinstall with `npm install`.
- **Mobile connection issues:** Check firewall rules and verify devices share the same network; access via LAN IP rather than `localhost`.

---

## License

MIT License — adapt for your own predictive maintenance workflows.

---




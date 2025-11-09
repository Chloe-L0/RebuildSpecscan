const request = require("supertest");
const axios = require("axios");

process.env.ROBOFLOW_API_KEY = "test-key";
process.env.ROBOFLOW_MODEL_ID = "test-model/1";

jest.mock("axios");

const app = require("../server");

describe("SpecScan API", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("GET /api/health returns ok status", async () => {
    const res = await request(app).get("/api/health");

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body).toHaveProperty("timestamp");
  });

  it("POST /api/analyze returns normalized predictions", async () => {
    axios.post.mockResolvedValue({
      data: {
        predictions: [
          {
            class: "crack",
            confidence: 0.92,
            x: 100,
            y: 200,
            width: 50,
            height: 60
          }
        ],
        image: {
          width: 1280,
          height: 720
        }
      }
    });

    const res = await request(app)
      .post("/api/analyze")
      .field("area", "fuselage")
      .attach("image", Buffer.from("fake-image"), "test.jpg");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.area).toBe("fuselage");
    expect(Array.isArray(res.body.predictions)).toBe(true);
    expect(res.body.predictions[0]).toMatchObject({
      class: "crack",
      confidence: 0.92,
      x: 100,
      y: 200,
      width: 50,
      height: 60,
      imageIndex: 0
    });
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      imageIndex: 0,
      image_width: 1280,
      image_height: 720
    });
    expect(res.body.results[0].predictions[0]).toMatchObject({
      class: "crack",
      confidence: 0.92,
      imageIndex: 0
    });
    expect(res.body.imageSize).toEqual({ w: 1280, h: 720 });
    expect(res.body.image_count).toBe(1);
    expect(res.body.total_defects).toBe(1);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("POST /api/analyze rejects invalid area", async () => {
    const res = await request(app)
      .post("/api/analyze")
      .field("area", "invalid-area")
      .attach("image", Buffer.from("fake-image"), "test.jpg");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/invalid inspection area/i);
    expect(axios.post).not.toHaveBeenCalled();
  });
});


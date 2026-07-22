import { getOptimizedVideoUrl } from "./videoUrl";

describe("getOptimizedVideoUrl", () => {
  const OLD = process.env.CLOUDFLARE_WORKER_URL;
  afterEach(() => {
    process.env.CLOUDFLARE_WORKER_URL = OLD;
  });

  it("joins base, bucket and file normalizing slashes", () => {
    process.env.CLOUDFLARE_WORKER_URL = "https://worker.dev/";
    expect(getOptimizedVideoUrl("/my-bucket/", "/videos/clip.mp4")).toBe(
      "https://worker.dev/my-bucket/videos/clip.mp4"
    );
  });

  it("throws when the worker url is missing", () => {
    process.env.CLOUDFLARE_WORKER_URL = "";
    expect(() => getOptimizedVideoUrl("b", "f.mp4")).toThrow(/CLOUDFLARE_WORKER_URL/);
  });
});

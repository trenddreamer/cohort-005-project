import { describe, it, expect, afterEach } from "vitest";
import { isVideoPlaying, setVideoPlaying } from "./video-playing";

afterEach(() => setVideoPlaying(false));

describe("video playing flag", () => {
  it("is off until a video reports it is playing", () => {
    expect(isVideoPlaying()).toBe(false);
    setVideoPlaying(true);
    expect(isVideoPlaying()).toBe(true);
    setVideoPlaying(false);
    expect(isVideoPlaying()).toBe(false);
  });
});

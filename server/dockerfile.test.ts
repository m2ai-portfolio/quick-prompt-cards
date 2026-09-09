// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression test for the P2 "container runs as root" finding. The image is
 * built with `docker build -f server/Dockerfile .`, which no vitest/CI config
 * can execute cheaply, so the guard asserts the Dockerfile text itself: the
 * last USER directive before CMD must drop to the image's `node` user, and no
 * later directive (COPY, RUN, ENV, EXPOSE, CMD) may follow a second `USER
 * root` reset. If someone reorders the file and root slips back in, this
 * fails instead of the first deploy.
 */
const DOCKERFILE = join(dirname(fileURLToPath(import.meta.url)), "Dockerfile");

describe("server/Dockerfile", () => {
  it("runs the container as the non-root `node` user", () => {
    const lines = readFileSync(DOCKERFILE, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const userDirectives = lines.filter((line) =>
      line.toLowerCase().startsWith("user "),
    );
    expect(userDirectives.length).toBeGreaterThan(0);

    const lastUser = userDirectives[userDirectives.length - 1];
    expect(lastUser).toBe("USER node");

    // No directive after the final USER may run as root again: root must
    // never be re-declared anywhere in the file.
    expect(lines.some((line) => /^user\s+root$/i.test(line))).toBe(false);
  });
});

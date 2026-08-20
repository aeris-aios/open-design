import { describe, expect, it, vi } from "vitest";

import { writeJsonFileWithOperations } from "../src/json-file.js";

function fileError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("atomic JSON replacement", () => {
  it("replaces an existing descriptor after Windows rename rejects overwrite", async () => {
    const rename = vi.fn()
      .mockRejectedValueOnce(fileError("EPERM"))
      .mockResolvedValueOnce(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await writeJsonFileWithOperations("C:\\runtime\\peer.json", { pid: 42 }, {
      delay: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      remove,
      rename,
      writeFile,
    });

    const tmpPath = writeFile.mock.calls[0]![0] as string;
    expect(rename.mock.calls).toEqual([
      [tmpPath, "C:\\runtime\\peer.json"],
      [tmpPath, "C:\\runtime\\peer.json"],
    ]);
    expect(remove).toHaveBeenCalledWith("C:\\runtime\\peer.json", { force: true });
    expect(remove).toHaveBeenLastCalledWith(tmpPath, { force: true });
  });

  it("removes its temp descriptor when Windows replacement never succeeds", async () => {
    const rename = vi.fn().mockRejectedValue(fileError("EPERM"));
    const remove = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await expect(writeJsonFileWithOperations("C:\\runtime\\peer.json", { pid: 42 }, {
      delay: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      remove,
      rename,
      writeFile,
    })).rejects.toMatchObject({ code: "EPERM" });

    const tmpPath = writeFile.mock.calls[0]![0] as string;
    expect(remove).toHaveBeenLastCalledWith(tmpPath, { force: true });
  });
});

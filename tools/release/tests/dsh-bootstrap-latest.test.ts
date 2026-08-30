import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getStorageObject: vi.fn(),
  putStorageObjectWithStatus: vi.fn(),
}));

vi.mock("../src/storage/s3-upload.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/storage/s3-upload.ts")>()),
  getStorageObject: storageMocks.getStorageObject,
  putStorageObjectWithStatus: storageMocks.putStorageObjectWithStatus,
}));

import {
  updateDshBootstrapLatestPointer,
  type DshBootstrapLatestPointer,
} from "../src/storage/dsh-bootstrap-latest.ts";
import type { StorageConfig } from "../src/storage/s3-upload.ts";

const storage: StorageConfig = {
  accessKeyId: "ak",
  bucket: "releases",
  endpointUrl: "https://storage.example.test",
  region: "auto",
  secretAccessKey: "sk",
};

function pointer(version: string): DshBootstrapLatestPointer {
  return {
    files: { "install-dsh.sh": `${version}-sha256` },
    github: { commit: `${version}-commit` },
    publishedAt: "2026-08-31T00:00:00.000Z",
    version,
  };
}

function storedPointer(version: string, etag = `etag-${version}`) {
  const text = `${JSON.stringify(pointer(version), null, 2)}\n`;
  return { bytes: Buffer.from(text), etag, text };
}

describe("DeepSeek Harness bootstrap latest pointer", () => {
  beforeEach(() => {
    storageMocks.getStorageObject.mockReset();
    storageMocks.putStorageObjectWithStatus.mockReset();
  });

  it("does not let a stale publisher rewind latest", async () => {
    storageMocks.getStorageObject.mockResolvedValue(storedPointer("v2"));

    await expect(updateDshBootstrapLatestPointer(storage, pointer("v1"))).resolves.toBe(false);
    expect(storageMocks.putStorageObjectWithStatus).not.toHaveBeenCalled();
  });

  it("advances latest with an ETag conditional write", async () => {
    storageMocks.getStorageObject.mockResolvedValue(storedPointer("v1", "current-etag"));
    storageMocks.putStorageObjectWithStatus.mockResolvedValue({
      body: "ok",
      ok: true,
      status: 200,
      url: "https://storage.example.test/releases/bootstrap/dsh/latest.json",
    });

    await expect(updateDshBootstrapLatestPointer(storage, pointer("v2"))).resolves.toBe(true);
    expect(storageMocks.putStorageObjectWithStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "if-match": "current-etag" },
        objectKey: "bootstrap/dsh/latest.json",
      }),
    );
  });

  it("rechecks the version after a concurrent update wins", async () => {
    storageMocks.getStorageObject
      .mockResolvedValueOnce(storedPointer("v1"))
      .mockResolvedValueOnce(storedPointer("v3"));
    storageMocks.putStorageObjectWithStatus.mockResolvedValue({
      body: "precondition failed",
      ok: false,
      status: 412,
      url: "https://storage.example.test/releases/bootstrap/dsh/latest.json",
    });

    await expect(updateDshBootstrapLatestPointer(storage, pointer("v2"))).resolves.toBe(false);
    expect(storageMocks.putStorageObjectWithStatus).toHaveBeenCalledTimes(1);
  });
});

// Unit tests for the Y3 binary-file helpers (lib/files.ts): binary detection,
// content-type by extension, the executable-name heuristic, and decoding a
// PackageFile's content back to real bytes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contentTypeFor,
  decodeContent,
  isExecutableName,
  isImageContentType,
  isProbablyBinary,
  MAX_BINARY_BYTES,
} from "../files";

test("MAX_BINARY_BYTES is 2 MB", () => {
  assert.equal(MAX_BINARY_BYTES, 2 * 1024 * 1024);
});

test("isProbablyBinary: plain UTF-8 text is not binary", () => {
  assert.equal(isProbablyBinary(Buffer.from("# Hello\n\nJust some markdown.\n", "utf8")), false);
});

test("isProbablyBinary: UTF-8 text with multi-byte characters is not binary", () => {
  assert.equal(isProbablyBinary(Buffer.from("café — naïve — 日本語", "utf8")), false);
});

test("isProbablyBinary: a NUL byte anywhere in the first 8KB is binary", () => {
  const buf = Buffer.concat([Buffer.from("hello"), Buffer.from([0x00]), Buffer.from("world")]);
  assert.equal(isProbablyBinary(buf), true);
});

test("isProbablyBinary: invalid UTF-8 byte sequences are binary even without a NUL byte", () => {
  // 0xff is never valid as a UTF-8 leading or continuation byte.
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x0d, 0x0a]);
  assert.equal(isProbablyBinary(buf), true);
});

test("isProbablyBinary: an empty buffer is not binary", () => {
  assert.equal(isProbablyBinary(Buffer.alloc(0)), false);
});

test("contentTypeFor: known text extensions", () => {
  assert.equal(contentTypeFor("README.md"), "text/markdown");
  assert.equal(contentTypeFor("openagent.yaml"), "application/yaml");
  assert.equal(contentTypeFor("config.yml"), "application/yaml");
  assert.equal(contentTypeFor("notes.txt"), "text/plain");
  assert.equal(contentTypeFor("data.json"), "application/json");
  assert.equal(contentTypeFor("index.js"), "text/plain");
  assert.equal(contentTypeFor("index.ts"), "text/plain");
  assert.equal(contentTypeFor("script.py"), "text/plain");
  assert.equal(contentTypeFor("run.sh"), "text/plain");
});

test("contentTypeFor: known binary/image extensions", () => {
  assert.equal(contentTypeFor("logo.png"), "image/png");
  assert.equal(contentTypeFor("photo.jpg"), "image/jpeg");
  assert.equal(contentTypeFor("photo.jpeg"), "image/jpeg");
  assert.equal(contentTypeFor("anim.gif"), "image/gif");
  assert.equal(contentTypeFor("icon.svg"), "image/svg+xml");
  assert.equal(contentTypeFor("banner.webp"), "image/webp");
  assert.equal(contentTypeFor("doc.pdf"), "application/pdf");
  assert.equal(contentTypeFor("archive.zip"), "application/zip");
  assert.equal(contentTypeFor("archive.tgz"), "application/gzip");
  assert.equal(contentTypeFor("module.wasm"), "application/wasm");
});

test("contentTypeFor: unrecognized or missing extension defaults to octet-stream", () => {
  assert.equal(contentTypeFor("weird.xyz"), "application/octet-stream");
  assert.equal(contentTypeFor("no-extension"), "application/octet-stream");
});

test("contentTypeFor: case-insensitive and uses the last extension in a nested path", () => {
  assert.equal(contentTypeFor("assets/LOGO.PNG"), "image/png");
  assert.equal(contentTypeFor("a/b/c/file.tar.gz"), "application/gzip");
});

test("isImageContentType", () => {
  assert.equal(isImageContentType("image/png"), true);
  assert.equal(isImageContentType("image/svg+xml"), true);
  assert.equal(isImageContentType("application/pdf"), false);
  assert.equal(isImageContentType("text/plain"), false);
});

test("isExecutableName: .sh files anywhere are executable", () => {
  assert.equal(isExecutableName("run.sh"), true);
  assert.equal(isExecutableName("lib/deploy.sh"), true);
  assert.equal(isExecutableName("RUN.SH"), true); // case-insensitive
});

test("isExecutableName: extensionless files under bin/ or scripts/ are executable", () => {
  assert.equal(isExecutableName("bin/run"), true);
  assert.equal(isExecutableName("scripts/deploy"), true);
  assert.equal(isExecutableName("tool/bin/run"), true); // any depth
});

test("isExecutableName: extensionless files outside bin/ or scripts/ are not executable", () => {
  assert.equal(isExecutableName("run"), false);
  assert.equal(isExecutableName("lib/run"), false);
});

test("isExecutableName: a file with a non-.sh extension is never executable, even under bin/", () => {
  assert.equal(isExecutableName("bin/run.js"), false);
  assert.equal(isExecutableName("bin/README.md"), false);
});

test("decodeContent: utf8 (default/absent encoding) round-trips as text", () => {
  assert.equal(decodeContent({ content: "hello world" }).toString("utf8"), "hello world");
  assert.equal(decodeContent({ content: "hello", encoding: "utf8" }).toString("utf8"), "hello");
});

test("decodeContent: base64 decodes to the original bytes", () => {
  const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
  const decoded = decodeContent({ content: original.toString("base64"), encoding: "base64" });
  assert.ok(decoded.equals(original));
});

test("decodeContent: missing content decodes to an empty buffer", () => {
  assert.equal(decodeContent({}).length, 0);
});

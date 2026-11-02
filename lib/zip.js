'use strict';
// Minimal ZIP reader (stored + deflate entries) using only node:zlib. Enough for state results archives.
const zlib = require('zlib');

function unzip(buf) {
  // Find End Of Central Directory record (scan back from end; comment can be up to 64KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.slice(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    if (!name.endsWith('/')) {
      if (method === 0) files[name] = data;
      else if (method === 8) files[name] = zlib.inflateRawSync(data);
      else throw new Error(`Unsupported zip compression method ${method} for ${name}`);
    }
    p += 46 + nameLen + extraLen + commLen;
  }
  return files;
}

module.exports = { unzip };

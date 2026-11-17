// Switches a PE executable's subsystem from console (3) to GUI (2), so no console window appears.
// Usage: node patch-subsystem.cjs <file.exe>
const fs = require("fs");
const f = process.argv[2];
const b = fs.readFileSync(f);
const pe = b.readUInt32LE(0x3c);
if (b.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("not a PE file");
const off = pe + 24 + 68;
const sub = b.readUInt16LE(off);
if (sub === 2) { console.log("already GUI subsystem"); process.exit(0); }
if (sub !== 3) throw new Error("unexpected subsystem " + sub);
b.writeUInt16LE(2, off);
fs.writeFileSync(f, b);
console.log("subsystem: console -> GUI");

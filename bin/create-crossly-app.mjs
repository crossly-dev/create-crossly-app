#!/usr/bin/env node
import { run } from '../src/cli.mjs';

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`create-crossly-app needs Node.js 20 or newer (this is ${process.version}).`);
  process.exit(1);
}

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err);
    process.exitCode = 1;
  },
);
